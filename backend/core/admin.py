"""后台（规格 v2.0 §2.1 `/admin/*`）的**隐私边界**。

后台只服务内容运营——动作库、科普文章、社区审核队列、必要的配置项——**不是**
用户数据的查看器。这个文件因此做两件事：

1. 把不属于内容运营的模型**从后台摘掉或拒绝注册**，并且是**导入期就报错**，
   而不是靠"记得别注册"这种约定。以后有人顺手 `admin.site.register(Visit, ...)`
   会直接让 `manage.py` 起不来，而不是悄悄把用户病历暴露给后台账号。
2. 把 `Token` 从后台摘掉。DRF 的 `authtoken` 默认会把令牌列表注册进 admin——
   那一页等于全站账号接管面板：谁有后台权限，谁就能拿别人的令牌冒充别人。
   令牌是登录凭证，不是运营数据，不该出现在任何网页后台里。

阶段二要加动作库、阶段四要加科普与审核队列时，把对应模型加进
`CONTENT_OPERATION_MODELS` 并在这里注册即可；用户私域模型一律不进这个白名单。
"""

from django.contrib import admin
from django.contrib.admin.exceptions import NotRegistered
from django.core.exceptions import ImproperlyConfigured
from rest_framework.authtoken.models import Token

from braces.models import Brace, ComfortEntry, ComfortFollowUp, WearRevision, WearSession
from core.models import Attachment, IdempotencyKey, WechatAccount
from medical.models import CurveMeasurement, MedicalAttachment, Visit
from profiles.models import BodyMeasurement, Profile
from exercises.models import Exercise, ExerciseVersion, Goal, Muscle, Region
from training.models import (BraceTrainingPrompt, PersonalActionCard, PersonalActionCardRevision,
                             PlanVersion, SetExecution, TrainingAttempt, TrainingPlan)
from exercises.admin import ExerciseAdmin, ExerciseVersionAdmin, GoalAdmin, MuscleAdmin, RegionAdmin

# 允许出现在后台的模型：只放"内容运营"对象。阶段一还没有内容模型落地，
# 所以这里是空的——空着比先塞几个用户模型进去"看起来有个后台"要诚实。
CONTENT_OPERATION_MODELS: tuple = (Region, Muscle, Goal, Exercise, ExerciseVersion)

CONTENT_OPERATION_ADMIN = {
    Region: RegionAdmin, Muscle: MuscleAdmin, Goal: GoalAdmin,
    Exercise: ExerciseAdmin, ExerciseVersion: ExerciseVersionAdmin,
}
for model in CONTENT_OPERATION_MODELS:
    admin.site.register(model, CONTENT_OPERATION_ADMIN[model])

# 明确禁止进后台的模型：用户私域数据与登录凭证。
PRIVATE_MODELS = (
    WechatAccount, Attachment, IdempotencyKey,
    Profile, BodyMeasurement,
    Visit, MedicalAttachment, CurveMeasurement,
    Brace, WearSession, WearRevision, ComfortEntry, ComfortFollowUp,
    Token, TrainingPlan, PlanVersion, PersonalActionCard, PersonalActionCardRevision,
    TrainingAttempt, SetExecution, BraceTrainingPrompt,
)

admin.site.site_header = "SPINE 内容后台"
admin.site.site_title = "SPINE 内容后台"
admin.site.index_title = "仅内容运营：动作、科普、审核队列与必要配置"


# authtoken 的 admin 模块会自行注册 Token。这里显式摘掉；顺序由 INSTALLED_APPS
# 决定，用 try 兜底以免它没被加载时反而抛错。
try:
    admin.site.unregister(Token)
except NotRegistered:  # pragma: no cover - 取决于 authtoken 版本是否自带 admin
    pass


def enforce_privacy_boundary() -> None:
    """私域模型一旦出现在后台，立刻报错。

    注意：这个函数**不能**在本模块导入时调用。Django 的 admin autodiscover 按
    INSTALLED_APPS 顺序加载各 app 的 admin.py，而 `core` 排在 `braces`、
    `profiles`、`medical` 之前——导入期执行时后面的模块还没加载，守卫会被绕过。
    真正的调用点是 `CoreConfig.ready()`，那时所有 admin 模块都已加载完毕。
    """
    leaked = [model.__name__ for model in PRIVATE_MODELS if admin.site.is_registered(model)]
    if leaked:
        raise ImproperlyConfigured(
            "后台不允许注册用户私域模型或登录凭证，请从 admin.py 中移除："
            + "、".join(leaked)
        )
