"""停止收集性别，并把初潮保留为可删除的选填发育信息。

上线前操作（规格 §15）：

1. 先备份 profiles_profile 表，并保留备份校验结果。
2. 运行 ``python manage.py migrate --plan``，确认只执行本迁移。
3. 正向迁移开始时会输出 gender、gender_custom 的非空行数及并集行数，
   应把输出抄入验证记录；如果发现非演示数据，立即停止发布并请用户确认。

回滚说明：Django 可以反向重建 gender 与 gender_custom 空列，但被删除的历史值
无法由反向迁移恢复。若必须恢复值，应先反向迁移，再从迁移前备份按 profile id
回填。不要修改或删除任何已有迁移。
"""

from django.db import migrations, models

import profiles.models


def report_gender_counts(apps, schema_editor):
    Profile = apps.get_model("profiles", "Profile")
    gender_count = Profile.objects.exclude(gender="").count()
    custom_count = Profile.objects.exclude(gender_custom="").count()
    any_count = Profile.objects.filter(
        models.Q(gender__gt="") | models.Q(gender_custom__gt="")
    ).count()
    print(
        "[profiles.0005] pre-migration gender counts: "
        f"gender_nonempty={gender_count}, "
        f"gender_custom_nonempty={custom_count}, any_nonempty={any_count}"
    )


class Migration(migrations.Migration):
    dependencies = [("profiles", "0004_treatment_stage")]

    operations = [
        migrations.RunPython(report_gender_counts, migrations.RunPython.noop),
        migrations.RemoveField(model_name="profile", name="gender"),
        migrations.RemoveField(model_name="profile", name="gender_custom"),
        migrations.AlterField(
            model_name="profile",
            name="menarche_status",
            field=models.CharField(
                blank=True,
                choices=[
                    ("not_yet", "还没有"),
                    ("started", "已经来了"),
                    ("not_applicable", "不适用"),
                    ("prefer_not", "不想填"),
                ],
                default="",
                max_length=16,
            ),
        ),
        migrations.AddField(
            model_name="profile",
            name="menarche_month",
            field=models.CharField(
                blank=True,
                default="",
                max_length=7,
                validators=[profiles.models.MONTH_VALIDATOR],
            ),
        ),
    ]
