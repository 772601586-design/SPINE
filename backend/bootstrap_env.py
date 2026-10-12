"""Create local secrets without overwriting an existing environment file."""
from pathlib import Path
import secrets


def main():
    root = Path(__file__).resolve().parent
    target = root / ".env"
    if target.exists():
        print("Existing backend/.env preserved.")
        return
    contents = (root / ".env.example").read_text(encoding="utf-8")
    contents = contents.replace("DJANGO_SECRET_KEY=\n", f"DJANGO_SECRET_KEY={secrets.token_urlsafe(48)}\n")
    contents = contents.replace("POSTGRES_PASSWORD=\n", f"POSTGRES_PASSWORD={secrets.token_urlsafe(32)}\n")
    with target.open("x", encoding="utf-8", newline="\n") as file:
        file.write(contents)
    print("Created backend/.env with local random secrets; do not commit this file.")


if __name__ == "__main__":
    main()
