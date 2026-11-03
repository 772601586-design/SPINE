from django.contrib.auth import get_user_model
from django.test import TestCase

from .models import AuditLog


class AccountAuditTests(TestCase):
    """建号必须留下审计；`kb-demo-reviewer` 就是没留痕直接写库建的。"""

    def test_user_creation_is_audited(self):
        user = get_user_model().objects.create_user(username="kb-audit-probe", password="probe-pass-123")
        entry = AuditLog.objects.get(action="account_created", object_id=str(user.pk))
        self.assertEqual(entry.changes["username"], "kb-audit-probe")
        self.assertIsNone(entry.actor_id)
        self.assertEqual(entry.object_type, "User")

    def test_saving_existing_user_does_not_duplicate(self):
        user = get_user_model().objects.create_user(username="kb-audit-probe-2", password="probe-pass-123")
        user.first_name = "改名测试"
        user.save()
        self.assertEqual(AuditLog.objects.filter(action="account_created", object_id=str(user.pk)).count(), 1)
