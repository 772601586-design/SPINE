import json
from pathlib import Path

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from rest_framework.exceptions import APIException

from knowledge.importing import LIMIT, commit, preview, rollback


class Command(BaseCommand):
    help = 'Preview JSON/CSV/Markdown/ZIP; explicitly commit drafts or safely roll back a batch.'

    def add_arguments(self, parser):
        parser.add_argument('path', nargs='?')
        parser.add_argument('--user', required=True)
        parser.add_argument('--commit', action='store_true')
        parser.add_argument('--rollback')
        parser.add_argument('--report')

    def handle(self, *args, **options):
        user = get_user_model().objects.filter(username=options['user']).first()
        if not user:
            raise CommandError('Unknown operator account')
        try:
            if options['rollback']:
                job = rollback(user, options['rollback'])
            else:
                if not options['path']:
                    raise CommandError('An input path is required')
                path = Path(options['path'])
                with path.open('rb') as f:
                    job = preview(user, path.name, f.read(LIMIT + 1))
                if options['commit']:
                    job = commit(user, job.pk)
        except (APIException, OSError) as exc:
            raise CommandError(str(exc)) from exc
        report = {'id': str(job.pk), 'status': job.status, 'checksum': job.checksum, **job.report}
        if options['report']:
            Path(options['report']).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
        self.stdout.write(json.dumps({'job': str(job.pk), 'status': job.status, 'count': job.report['count'],
                                     'errors': len(job.report['errors']), 'warnings': len(job.report['warnings']), 'published': 0}, ensure_ascii=False))
