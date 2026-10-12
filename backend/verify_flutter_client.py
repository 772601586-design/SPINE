"""Exercise Flutter's shared Dart API against a running real backend.

Creates dedicated verification users and records, preserving existing data.
Passwords/tokens are never printed or placed in command arguments.
"""
import os
from pathlib import Path
import secrets
import subprocess
import sys
from uuid import uuid4

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
import django
django.setup()
from django.conf import settings
from django.contrib.auth import get_user_model


def main():
    if not settings.DEBUG:
        raise SystemExit("Verification fixtures require DEBUG=true.")
    root = Path(__file__).resolve().parent.parent
    dart = Path(os.getenv("SPINE_DART_EXE", r"D:\app\flutter windows\flutter_windows_3.44.1-stable\flutter\bin\cache\dart-sdk\bin\dart.exe"))
    if not dart.exists():
        raise SystemExit("Set SPINE_DART_EXE to your Flutter SDK's bin/cache/dart-sdk/bin/dart.exe.")
    suffix = uuid4().hex[:12]
    password = secrets.token_urlsafe(24)
    names = [f"verify_a_{suffix}", f"verify_b_{suffix}"]
    for name in names:
        get_user_model().objects.create_user(username=name, password=password)
    env = {**os.environ, "SPINE_VERIFY_PASSWORD": password,
           "SPINE_VERIFY_USER_A": names[0], "SPINE_VERIFY_USER_B": names[1]}
    result = subprocess.run([str(dart), "--disable-dart-dev", "--packages=.dart_tool/package_config.json",
                             "tool/verify_personal.dart", sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000"],
                            cwd=root / "flutterapp", env=env, creationflags=subprocess.CREATE_NO_WINDOW,
                            capture_output=True, text=True, encoding="utf-8", errors="replace")
    print(result.stdout)
    if result.returncode:
        print(result.stderr)
    print("Dedicated verification users retained:", ", ".join(names))
    raise SystemExit(result.returncode)


if __name__ == "__main__":
    main()
