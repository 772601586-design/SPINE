"""孤儿 pending 附件清理（规格 §15「上传卫生」）。

`upload-intent` 之后的行会以 `pending` 存在；客户端中途放弃、断网、或上传被
魔数复核拒绝后，这些行和可能已落盘的字节都不会自己消失。本命令定期兜底：

- 超过 TTL 的 `pending`：删存储对象（若有），删行——它们从未可用过，
  没有任何业务表引用，留着只占库。
- 不碰 `ready / rejected / deleted`：那些要么有归属、要么有审计意义。

用法：
    python manage.py cleanup_attachments              # 按 settings 的 TTL
    python manage.py cleanup_attachments --hours 6    # 临时改阈值
    python manage.py cleanup_attachments --dry-run    # 只报告，不删

注意：这个任务**刻意不做成后台页面**——后台能看到文件名就等于能看到
"谁上传了什么"，与 core/admin.py 的隐私边界冲突。
"""

from datetime import timedelta

from django.conf import settings
from django.core.management.base import BaseCommand
from django.utils import timezone

from core.models import Attachment
from core.storage import get_storage


class Command(BaseCommand):
    help = "删除超过 TTL 的 pending 附件（存储对象与数据库行），兜住上传中途放弃留下的孤儿。"

    def add_arguments(self, parser):
        parser.add_argument(
            "--hours",
            type=int,
            default=None,
            help="pending 超过多少小时视为孤儿；缺省读 ATTACHMENT_PENDING_TTL_HOURS（默认 24）。",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="只统计并打印将删除的内容，不真正删除。",
        )

    def handle(self, *args, **options):
        hours = options["hours"]
        if hours is None:
            hours = getattr(settings, "ATTACHMENT_PENDING_TTL_HOURS", 24)
        if hours < 0:
            self.stderr.write("--hours 不能为负数。")
            raise SystemExit(2)

        cutoff = timezone.now() - timedelta(hours=hours)
        orphans = list(
            Attachment.objects.filter(
                status=Attachment.Status.PENDING, created_at__lt=cutoff
            ).iterator()
        )
        storage = get_storage()
        removed_files = 0
        for attachment in orphans:
            if storage.exists(attachment.storage_key):
                removed_files += 1
                if not options["dry_run"]:
                    storage.delete(attachment.storage_key)
        if not options["dry_run"]:
            # 没有任何业务表引用 pending 行，直接删行；count() 放在删除后核对。
            deleted_rows, _ = Attachment.objects.filter(
                pk__in=[attachment.pk for attachment in orphans]
            ).delete()

        self.stdout.write(
            self.style.SUCCESS(
                f"TTL={hours}h 截止 {cutoff.isoformat()}：孤儿 pending {len(orphans)} 行，"
                f"其中 {removed_files} 行有落盘字节。"
                + (f"已删行 {deleted_rows}。" if not options["dry_run"] else "（dry-run，未删除）")
            )
        )
