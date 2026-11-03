"""Isolated, ephemeral test DB; production settings remain PostgreSQL."""
import os
os.environ.setdefault('DJANGO_SECRET_KEY', 'test-only-never-use-in-production')
os.environ.setdefault('POSTGRES_PASSWORD', 'test-only')
from .settings import *  # noqa
DATABASES = {'default': {'ENGINE': 'django.db.backends.sqlite3', 'NAME': ':memory:'}}
PASSWORD_HASHERS = ['django.contrib.auth.hashers.MD5PasswordHasher']
ALLOWED_HOSTS = ['testserver', 'localhost', '127.0.0.1']
CORS_ALLOWED_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://127.0.0.1:4180']
