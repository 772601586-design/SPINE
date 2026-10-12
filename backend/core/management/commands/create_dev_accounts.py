import getpass
import os

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction


class Command(BaseCommand):
    help = "Create spine_a / spine_b development users without changing existing accounts."

    def handle(self, *args, **options):
        if not settings.DEBUG:
            raise CommandError("Development accounts require DJANGO_DEBUG=true.")
        names = [name for name in ("spine_a", "spine_b") if not get_user_model().objects.filter(username=name).exists()]
        if not names:
            self.stdout.write("Existing development accounts preserved.")
            return
        password = os.getenv("SPINE_DEV_PASSWORD") or getpass.getpass("Development password (not displayed): ")
        validate_password(password)
        with transaction.atomic():
            for name in names:
                get_user_model().objects.create_user(username=name, password=password)
                self.stdout.write(f"Created {name} (personal account, not staff).")
