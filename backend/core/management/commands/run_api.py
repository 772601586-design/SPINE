from django.core.management.commands.runserver import Command as RunServer


class Command(RunServer):
    help = "Development API server; optionally start health endpoints before PostgreSQL is available."

    def add_arguments(self, parser):
        super().add_arguments(parser)
        parser.add_argument(
            "--skip-migration-check", action="store_true",
            help="Skip startup migration lookup only; PostgreSQL readiness still returns 503 if unavailable.",
        )

    def handle(self, *args, **options):
        self.skip_migration_check = options["skip_migration_check"]
        return super().handle(*args, **options)

    def check_migrations(self):
        if self.skip_migration_check:
            self.stdout.write(self.style.WARNING("Database migration check skipped for local API preview."))
            return
        return super().check_migrations()
