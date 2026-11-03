from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.management.base import BaseCommand, CommandError

from knowledge.permissions import ADMIN, EDITOR, REVIEWER
from knowledge.services import audit


class Command(BaseCommand):
    help = 'Provision KB role groups; grant a role to an existing account after offline identity/qualification checks.'

    def add_arguments(self, parser):
        parser.add_argument('--user')
        parser.add_argument('--role', choices=[ADMIN, EDITOR, REVIEWER])
        parser.add_argument('--revoke', action='store_true')

    def handle(self, *args, **options):
        for name in [ADMIN, EDITOR, REVIEWER]:
            Group.objects.get_or_create(name=name)
        if options['user']:
            if not options['role']:
                raise CommandError('--role is required')
            user = get_user_model().objects.filter(username=options['user']).first()
            if not user:
                raise CommandError('Create the account using the existing auth system first.')
            group = Group.objects.get(name=options['role'])
            user.groups.remove(group) if options['revoke'] else user.groups.add(group)
            audit(None, 'role_revoke' if options['revoke'] else 'role_grant', user, {'role': group.name, 'method': 'management_command'})
        self.stdout.write('Knowledge roles configured. Medical qualifications must be checked by the operator before granting reviewer access.')
