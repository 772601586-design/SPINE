from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import BasePermission

ADMIN = 'knowledge_admin'
EDITOR = 'knowledge_editor'
REVIEWER = 'knowledge_reviewer'


def roles(user):
    if not user or not user.is_authenticated or not user.is_active:
        return set()
    result = set(user.groups.filter(name__in=[ADMIN, EDITOR, REVIEWER]).values_list('name', flat=True))
    if user.is_superuser:
        result.add(ADMIN)  # Superuser is not a clinical credential.
    return result


def require_role(user, *allowed):
    if not roles(user).intersection(allowed):
        raise PermissionDenied('当前角色无权执行此操作。')


class EditorialPermission(BasePermission):
    def has_permission(self, request, view):
        return bool(roles(request.user))
