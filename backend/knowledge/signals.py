"""Account lifecycle auditing.

`kb-demo-reviewer` 曾绕过服务层直接写库建号，事后在 `AuditLog` 里查不到任何痕迹。
这里把「账号创建」接入审计：任何通过 Django 认证系统（createsuperuser、admin、ORM、
自定义命令）新建的用户都会留下一条 `account_created` 记录。

只在 `created=True` 时写入，避免保存用户资料时反复产生噪声；角色变更仍由
`manage.py knowledge_roles` 写入 `role_grant` / `role_revoke`。
"""
from django.conf import settings
from django.db.models.signals import post_save
from django.dispatch import receiver


@receiver(post_save, sender=settings.AUTH_USER_MODEL, dispatch_uid="knowledge_account_created")
def log_account_created(sender, instance, created, **kwargs):
    if not created:
        return
    from .models import AuditLog

    AuditLog.objects.create(
        actor=None,
        action="account_created",
        object_type="User",
        object_id=str(instance.pk),
        changes={
            "username": instance.username,
            "is_staff": instance.is_staff,
            "is_superuser": instance.is_superuser,
            "is_active": instance.is_active,
            "source": "django.auth.post_save",
        },
    )
