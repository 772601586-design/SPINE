import os
from pathlib import Path

from django.core.exceptions import ImproperlyConfigured
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env", override=False)


def required(name):
    value = os.getenv(name, "").strip()
    if not value:
        raise ImproperlyConfigured(f"Missing {name}. Run python bootstrap_env.py and configure backend/.env.")
    return value


def csv_env(name, default=""):
    return [part.strip() for part in os.getenv(name, default).split(",") if part.strip()]


def int_env(name, default):
    # `.env.example` 里是空占位，空字符串必须落回默认值而不是让 int("") 抛错。
    raw = os.getenv(name, "").strip()
    return int(raw) if raw else default


SECRET_KEY = required("DJANGO_SECRET_KEY")
DEBUG = os.getenv("DJANGO_DEBUG", "false").lower() == "true"
ALLOWED_HOSTS = csv_env("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1")
INSTALLED_APPS = [
    # 后台只服务内容运营（动作/科普/审核队列），不承载用户私人数据；
    # 谁能进后台、哪些模型可以注册，见 core/admin.py 的显式边界。
    "django.contrib.admin",
    "django.contrib.auth", "django.contrib.contenttypes",
    "django.contrib.sessions", "django.contrib.messages",
    "django.contrib.staticfiles", "rest_framework", "corsheaders",
    "drf_spectacular", "rest_framework.authtoken", "core", "braces", "profiles", "medical", "exercises", "training",
]
MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "core.middleware.RequestIDMiddleware",
]
ROOT_URLCONF = "config.urls"
TEMPLATES = [{
    "BACKEND": "django.template.backends.django.DjangoTemplates",
    "DIRS": [], "APP_DIRS": True,
    "OPTIONS": {"context_processors": [
        "django.template.context_processors.request",
        "django.contrib.auth.context_processors.auth",
        "django.contrib.messages.context_processors.messages",
    ]},
}]
WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"
DATABASES = {"default": {
    "ENGINE": "django.db.backends.postgresql",
    "NAME": os.getenv("POSTGRES_DB", "spine"),
    "USER": os.getenv("POSTGRES_USER", "spine"),
    "PASSWORD": required("POSTGRES_PASSWORD"),
    "HOST": os.getenv("POSTGRES_HOST", "127.0.0.1"),
    "PORT": os.getenv("POSTGRES_PORT", "5432"),
    "CONN_MAX_AGE": 0,
    "OPTIONS": {"connect_timeout": int(os.getenv("POSTGRES_CONNECT_TIMEOUT", "3"))},
}}
LANGUAGE_CODE = "zh-hans"
TIME_ZONE = "Asia/Shanghai"
USE_I18N = True
USE_TZ = True
STATIC_URL = "static/"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
# 微信小程序登录。AppID 可以公开，AppSecret 只存在于服务端环境变量，
# 绝不写入仓库、日志、命令行输出或小程序包。
WECHAT_APPID = os.getenv("WECHAT_APPID", "").strip()
WECHAT_APPSECRET = os.getenv("WECHAT_APPSECRET", "").strip()

CORS_ALLOWED_ORIGINS = csv_env("CORS_ALLOWED_ORIGINS")
CORS_URLS_REGEX = r"^/api/.*$"

# ---------------------------------------------------------------------------
# 私有对象存储与附件策略（规格 v2.0 §4.1、§15）
#
# 本地实现把文件写到 PRIVATE_STORAGE_ROOT（独立于 static/media，不经公开路由）。
# 生产切换到 S3/OSS 时改 STORAGE_BACKEND 并实现同名接口（core/storage.py 有说明）。
# ---------------------------------------------------------------------------
STORAGE_BACKEND = os.getenv("STORAGE_BACKEND", "local").strip() or "local"
# 空字符串要落回默认值：Path("") 会指向当前工作目录，那等于把私有文件散到仓库里。
PRIVATE_STORAGE_ROOT = os.getenv("PRIVATE_STORAGE_ROOT", "").strip() or str(BASE_DIR / ".private-storage")
# 授权访问地址的有效期（秒）。越短越安全，但要覆盖一次预览/下载的耗时。
ATTACHMENT_ACCESS_TTL_SECONDS = int_env("ATTACHMENT_ACCESS_TTL_SECONDS", 300)
_MB = 1024 * 1024
# 每用途的允许类型与体积上限。用途是隔离手段：医疗原件与社区媒体不共用策略。
ATTACHMENT_PURPOSE_POLICIES = {
    "medical": {"mime_types": ("image/jpeg", "image/png", "application/pdf"), "max_bytes": 20 * _MB},
    "private_record": {"mime_types": ("image/jpeg", "image/png"), "max_bytes": 10 * _MB},
    "community": {"mime_types": ("image/jpeg", "image/png", "image/webp"), "max_bytes": 10 * _MB},
    "exercise": {"mime_types": ("image/jpeg", "image/png", "video/mp4"), "max_bytes": 50 * _MB},
    "article": {"mime_types": ("image/jpeg", "image/png", "image/webp"), "max_bytes": 10 * _MB},
    "avatar": {"mime_types": ("image/jpeg", "image/png", "image/webp"), "max_bytes": 5 * _MB},
}
# 一次就诊最多挂多少个附件（规格 §4.1）。就诊模型在阶段一-3 落地时读取此值。
VISIT_MAX_ATTACHMENTS = int_env("VISIT_MAX_ATTACHMENTS", 20)
# 上传卫生（规格 §15）：intent 之后没有 complete 的附件是"申请了却没用"的孤儿，
# 不清理就会变成既能占磁盘又能刷行的垃圾。配额挡滥用，TTL 供定期清理兜底。
ATTACHMENT_PENDING_LIMIT = int_env("ATTACHMENT_PENDING_LIMIT", 20)
ATTACHMENT_PENDING_TTL_HOURS = int_env("ATTACHMENT_PENDING_TTL_HOURS", 24)
REST_FRAMEWORK = {
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_AUTHENTICATION_CLASSES": ["rest_framework.authentication.TokenAuthentication"],
    "DEFAULT_RENDERER_CLASSES": ["core.renderers.EnvelopeJSONRenderer"],
    "EXCEPTION_HANDLER": "core.exceptions.spine_exception_handler",
    "UNAUTHENTICATED_USER": None,
}
SPECTACULAR_SETTINGS = {
    "TITLE": "SPINE API", "VERSION": "0.1.0",
    "DESCRIPTION": "Shared API for the personal app and professional/review workspace.",
    "SERVE_INCLUDE_SCHEMA": False,
    "SERVE_PERMISSIONS": ["rest_framework.permissions.AllowAny"],
    "SERVE_AUTHENTICATION": [],
    "ENUM_NAME_OVERRIDES": {"HealthStatusEnum": ["ok"], "ReadinessStatusEnum": ["ok", "unavailable"]},
}
SECURE_CONTENT_TYPE_NOSNIFF = True
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]
