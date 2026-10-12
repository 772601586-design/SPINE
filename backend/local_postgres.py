"""Start an isolated project-local PostgreSQL; never reset an existing cluster.

Download EDB's Windows PostgreSQL 17 binaries into .tools/postgresql/pgsql first.
The ordinary application role has CREATEDB for Django's separate test database,
but is not a superuser. Passwords are read from .env and never printed.
"""
import argparse
import os
from pathlib import Path
import secrets
import socket
import subprocess
import tempfile
import time

from dotenv import load_dotenv
import psycopg
from psycopg import sql


ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / "backend/.env", override=False)
BIN = ROOT / ".tools/postgresql/pgsql/bin"
DATA = ROOT / ".tools/postgresql-data"


def run(*args):
    subprocess.run([str(arg) for arg in args], check=True, creationflags=subprocess.CREATE_NO_WINDOW)


def start_server(host, port):
    try:
        with socket.create_connection((host, int(port)), timeout=1):
            return  # Never launch another server on an occupied port.
    except OSError:
        pass
    # pg_ctl's restricted-token creation is unavailable in some Windows agent environments.
    with (ROOT / ".tools/postgresql.log").open("ab") as log:
        subprocess.Popen([str(BIN / "postgres.exe"), "-D", str(DATA)], stdout=log, stderr=log,
                         creationflags=subprocess.CREATE_NO_WINDOW)
    for _ in range(50):
        try:
            with socket.create_connection((host, int(port)), timeout=1):
                return
        except OSError:
            time.sleep(0.2)
    raise SystemExit("PostgreSQL did not start; inspect .tools/postgresql.log.")


def provision_missing_database(host, port, user, password, database):
    admin_file = ROOT / ".tools/postgresql-admin-password"
    if not admin_file.exists():
        return
    with psycopg.connect(host=host, port=port, user="spine_bootstrap", password=admin_file.read_text(encoding="utf-8"),
                         dbname="postgres", autocommit=True, connect_timeout=3) as connection:
        actual_data = Path(connection.execute("SHOW data_directory").fetchone()[0]).resolve()
        if actual_data != DATA.resolve():
            raise SystemExit("Connected server is not the project cluster; nothing was changed.")
        if not connection.execute("SELECT 1 FROM pg_roles WHERE rolname=%s", (user,)).fetchone():
            connection.execute(sql.SQL("CREATE ROLE {} LOGIN CREATEDB PASSWORD {}").format(sql.Identifier(user), sql.Literal(password)))
        if not connection.execute("SELECT 1 FROM pg_database WHERE datname=%s", (database,)).fetchone():
            connection.execute(sql.SQL("CREATE DATABASE {} OWNER {}").format(sql.Identifier(database), sql.Identifier(user)))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["start", "stop", "status"])
    args = parser.parse_args()
    if not (BIN / "pg_ctl.exe").exists():
        raise SystemExit("Missing .tools/postgresql/pgsql/bin/pg_ctl.exe; obtain PostgreSQL Windows binaries or use an existing server.")
    if args.action == "stop":
        run(BIN / "pg_ctl.exe", "-D", DATA, args.action)
        return
    host = os.getenv("POSTGRES_HOST", "127.0.0.1")
    port = os.getenv("POSTGRES_PORT", "5432")
    if host not in ("127.0.0.1", "localhost"):
        raise SystemExit("Configured database is remote; do not start a local replacement.")
    password = os.getenv("POSTGRES_PASSWORD")
    if not password:
        raise SystemExit("Missing POSTGRES_PASSWORD in backend/.env.")
    user = os.getenv("POSTGRES_USER", "spine")
    database = os.getenv("POSTGRES_DB", "spine")
    if args.action == "status":
        with psycopg.connect(host=host, port=port, user=user, password=password, dbname=database, connect_timeout=3) as connection:
            assert connection.execute("SELECT 1").fetchone() == (1,)
        print("Configured PostgreSQL is ready.")
        return
    # An existing reachable database always wins over local initialization.
    try:
        with psycopg.connect(host=host, port=port, user=user, password=password, dbname=database, connect_timeout=3) as connection:
            connection.execute("SELECT 1")
        print("Configured PostgreSQL already ready; existing database preserved.")
        return
    except psycopg.Error:
        pass
    if (DATA / "PG_VERSION").exists():
        # Start only our known cluster, never initialize or alter its roles.
        start_server(host, port)
        provision_missing_database(host, port, user, password, database)
    else:
        if DATA.exists():
            raise SystemExit("Data directory exists without PG_VERSION; inspect it manually. Nothing was reset.")
        admin_password = secrets.token_urlsafe(40)
        (ROOT / ".tools/postgresql-admin-password").write_text(admin_password, encoding="utf-8")
        (ROOT / ".tmp").mkdir(exist_ok=True)
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=ROOT / ".tmp", delete=False) as secret_file:
            secret_file.write(admin_password)
            secret_path = Path(secret_file.name)
        try:
            run(BIN / "initdb.exe", "-D", DATA, "-U", "spine_bootstrap", "--pwfile", secret_path,
                "--auth=scram-sha-256", "--encoding=UTF8", "--locale=C")
        finally:
            secret_path.unlink(missing_ok=True)
        with (DATA / "postgresql.conf").open("a", encoding="utf-8") as config:
            config.write(f"\nlisten_addresses = '127.0.0.1'\nport = {int(port)}\n")
        start_server(host, port)
        provision_missing_database(host, port, user, password, database)
    with psycopg.connect(host=host, port=port, user=user, password=password, dbname=database, connect_timeout=3) as connection:
        assert connection.execute("SELECT 1").fetchone() == (1,)
    print("Project-local PostgreSQL ready. Existing clusters and migrations were not reset.")


if __name__ == "__main__":
    main()
