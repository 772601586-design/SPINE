"""Opt-in local evaluation only. Does not change production database selection."""
import os
os.environ.setdefault('DJANGO_SECRET_KEY', 'local-knowledge-evaluation-only')
os.environ.setdefault('POSTGRES_PASSWORD', 'unused-local-evaluation')
from .settings import *  # noqa
DEBUG = True
DATABASES = {'default': {'ENGINE': 'django.db.backends.sqlite3', 'NAME': BASE_DIR / '.knowledge-local.sqlite3'}}
CORS_ALLOWED_ORIGINS = ['http://127.0.0.1:5173', 'http://127.0.0.1:4180']
