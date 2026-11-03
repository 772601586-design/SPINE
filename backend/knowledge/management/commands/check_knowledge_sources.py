from django.core.management.base import BaseCommand
from django.utils import timezone
from django.db.models import F
from knowledge.linkcheck import check_link
from knowledge.models import ArticleVersion, Source
from knowledge.services import audit


class Command(BaseCommand):
    help = 'Check candidate links and report due reviews; never marks medical evidence verified.'

    def add_arguments(self, parser):
        parser.add_argument('--limit', type=int, default=30)

    def handle(self, *args, **options):
        for source in Source.objects.order_by('link_checked_at', 'pk')[:max(0, min(options['limit'], 100))]:
            status = check_link(source.url)
            Source.objects.filter(pk=source.pk).update(link_status=status, link_checked_at=timezone.now())
            audit(None, 'link_check', source, {'network_status': status, 'medical_status_unchanged': True})
            self.stdout.write(f'{source.pk}: {status}')
        due = list(ArticleVersion.objects.filter(review_due_date__lte=timezone.localdate(), article__publication_status='published',
                                                article__published_version_id=F('id')).values_list('article_id', flat=True))
        self.stdout.write('Due for professional review: ' + ', '.join(due))
