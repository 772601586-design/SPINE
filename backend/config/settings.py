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


SECRET_KEY = required("DJANGO_SECRET_KEY")
DEBUG = os.getenv("DJANGO_DEBUG", "false").lower() == "true"
ALLOWED_HOSTS = csv_env("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1")
INSTALLED_APPS = [
    "django.contrib.auth", "django.contrib.contenttypes",
    "django.contrib.staticfiles", "rest_framework", "corsheaders",
    "drf_spectacular", "rest_framework.authtoken", "core", "braces",
]
MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
]
ROOT_URLCONF = "config.urls"
TEMPLATES = [{
    "BACKEND": "django.template.backends.django.DjangoTemplates",
    "DIRS": [], "APP_DIRS": True, "OPTIONS": {"context_processors": []},
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
CORS_ALLOWED_ORIGINS = csv_env("CORS_ALLOWED_ORIGINS")
CORS_URLS_REGEX = r"^/api/.*$"
REST_FRAMEWORK = {
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_AUTHENTICATION_CLASSES": ["rest_framework.authentication.TokenAuthentication"],
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
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
