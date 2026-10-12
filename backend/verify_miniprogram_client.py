"""Compile and exercise the Mini Program's TypeScript API/session against Django."""
import os
from pathlib import Path
import secrets
import subprocess
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
    suffix = uuid4().hex[:12]
    password = secrets.token_urlsafe(24)
    users = [f"mini_verify_a_{suffix}", f"mini_verify_b_{suffix}"]
    for name in users:
        get_user_model().objects.create_user(username=name, password=password)
    out = root / ".verification/miniprogram-js"
    out.mkdir(parents=True, exist_ok=True)
    tsc = root / "frontend/node_modules/typescript/bin/tsc"
    subprocess.run(["node", str(tsc), "--project", str(root / "miniprogram/tsconfig.json"),
                    "--noEmit", "false", "--module", "commonjs", "--moduleResolution", "node10",
                    "--ignoreDeprecations", "6.0", "--outDir", str(out)], check=True, cwd=root)
    env = {**os.environ, "SPINE_VERIFY_USER_A": users[0], "SPINE_VERIFY_USER_B": users[1],
           "SPINE_VERIFY_PASSWORD": password,
           "SPINE_VERIFY_API": os.getenv("SPINE_VERIFY_API", "http://127.0.0.1:8000")}
    result = subprocess.run(["node", str(root / "miniprogram/scripts/verify-api.cjs")],
                            cwd=root, env=env, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if result.stdout:
        print(result.stdout, end="")
    if result.returncode:
        if result.stderr:
            print(result.stderr, end="")
        raise SystemExit(result.returncode)
    print("Dedicated temporary verification users retained:", ", ".join(users))


if __name__ == "__main__":
    main()
