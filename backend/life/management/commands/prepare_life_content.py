from django.core.management.base import BaseCommand

from life.models import Article


class Command(BaseCommand):
    help = "Create the demo's guide/learning editorial drafts without publishing medical claims."

    def handle(self, *args, **options):
        titles = [
            ("guide", "刚开始", "前两周怎么熬"), ("guide", "皮肤", "压红了怎么办"),
            ("guide", "吃饭", "支具压着肚子"), ("guide", "经期", "经期更不舒服时"),
            ("guide", "学校", "体育课和同学"), ("guide", "运动", "脱支具的时间去游泳"),
            ("learning", "测量", "如何理解 Cobb 角和测量差异"),
            ("learning", "支具", "如何核对我的支具佩戴目标"),
            ("learning", "复查", "第一次复查，要问医生哪些问题"),
            ("learning", "信息辨别", "怎么分辨夸大的矫正宣传"),
        ]
        created = 0
        for category, topic, title in titles:
            _, added = Article.objects.get_or_create(title=title, category=category, defaults={"topic": topic,
                "body": "编辑草稿：请由康复师或矫形师撰写并审核正文。发布前填写审核人；涉及训练与佩戴参数时应说明以个人医嘱为准。",
                "published": False, "reviewer": ""})
            created += int(added)
        self.stdout.write(f"Created {created} unpublished editorial drafts. Existing content was preserved.")
