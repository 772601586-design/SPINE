"""把 16 篇专题稿导出为一个离线 HTML 合集，供预览/校对。

不改变任何数据库状态，不产生审核记录；文件顶部明确标注"未经医学审核"。
用法：python backend/knowledge/export_preview.py
"""
import html
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

import django

django.setup()

from knowledge.models import ArticleVersion
from knowledge.rendering import render_markdown

OUT = Path(__file__).resolve().parent.parent.parent / "ai_path" / "知识库专题文章预览.html"

TOPICS = [
    ("new-diagnosis", "新确诊指南"),
    ("imaging", "影像检查"),
    ("brace", "支具治疗"),
    ("schroth", "Schroth 训练"),
    ("daily-life", "日常生活"),
    ("mental-growth", "心理成长"),
]

IDS = [
    "TOPIC-NEWDX-01", "TOPIC-NEWDX-02", "TOPIC-NEWDX-03",
    "TOPIC-IMG-01", "TOPIC-IMG-02",
    "TOPIC-BRACE-01", "TOPIC-BRACE-02", "TOPIC-BRACE-03",
    "TOPIC-SCHROTH-01", "TOPIC-SCHROTH-02",
    "TOPIC-DAILY-01", "TOPIC-DAILY-02", "TOPIC-DAILY-03",
    "TOPIC-MIND-01", "TOPIC-MIND-02", "TOPIC-MIND-03",
]

CSS = """
:root{--ink:#22302f;--muted:#6b7a78;--line:#e2e8e6;--teal:#597f81;--bg:#f6f8f7}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.75 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif}
.wrap{max-width:780px;margin:0 auto;padding:32px 20px 80px}
.top{background:#fff;border:1px solid var(--line);border-radius:14px;padding:20px 22px;margin-bottom:28px}
.top h1{margin:0 0 8px;font-size:24px}
.badge{display:inline-block;background:#fff4e5;color:#8a5a00;border:1px solid #f0d9b5;border-radius:999px;padding:2px 10px;font-size:12px;margin-bottom:10px}
.top p{margin:6px 0;color:var(--muted);font-size:14px}
.toc{background:#fff;border:1px solid var(--line);border-radius:14px;padding:18px 22px;margin-bottom:28px}
.toc h2{margin:0 0 10px;font-size:16px}
.toc a{color:var(--teal);text-decoration:none;font-size:14px}
.toc div{margin:6px 0}
article{background:#fff;border:1px solid var(--line);border-radius:14px;padding:24px 26px;margin-bottom:22px}
article h2{font-size:20px;margin:0 0 6px;line-height:1.4}
.meta{color:var(--muted);font-size:13px;margin-bottom:14px}
article h3{font-size:16px;margin:22px 0 8px;color:var(--teal)}
article blockquote{margin:0 0 16px;padding:10px 14px;background:#fff8ee;border-left:3px solid #d9a441;border-radius:6px;font-size:14px}
article p{margin:8px 0}
article ul{margin:8px 0 8px 20px;padding:0}
article li{margin:4px 0}
.sources{margin-top:18px;padding-top:14px;border-top:1px dashed var(--line);font-size:13px;color:var(--muted)}
.sources b{color:var(--ink)}
.sources li{margin:6px 0;word-break:break-all}
.sources a{color:var(--teal)}
"""


def primary_topic(version):
    """按分类决定主专题，避免一篇文章在合集里重复出现。"""
    category = version.categories.first()
    name = category.name if category else ""
    if name == "刚发现侧弯":
        return "new-diagnosis"
    if name == "看懂检查结果":
        return "imaging"
    if name == "正在接受治疗":
        return "schroth" if "Schroth" in version.title else "brace"
    if name == "每天怎么生活":
        return "daily-life"
    if name == "情绪与成长":
        return "mental-growth"
    return ""


def main():
    versions = {v.article_id: v for v in ArticleVersion.objects.filter(article_id__in=IDS)}

    cards, toc = [], []
    for topic_id, topic_name in TOPICS:
        items = [versions[i] for i in IDS if i in versions and primary_topic(versions[i]) == topic_id]
        items.sort(key=lambda v: IDS.index(v.article_id))
        if not items:
            continue
        toc.append('<div><b>%s</b>（%d 篇）</div>' % (html.escape(topic_name), len(items)))
        for version in items:
            anchor = "art-" + version.article_id.lower()
            toc.append('<div style="margin-left:14px"><a href="#%s">%s</a></div>' % (anchor, html.escape(version.title)))
            sources = "".join(
                '<li>%s — %s.%s%s</li>' % (
                    html.escape(source.title),
                    html.escape(source.organization or ""),
                    html.escape(str(source.year or "")),
                    (' <a href="%s">原文</a>' % html.escape(source.url)) if source.url else "",
                )
                for source in version.sources.all()
            )
            cards.append(
                '<article id="%s"><h2>%s</h2>'
                '<div class="meta">%s · 第 %d 版 · 未经医学审核</div>%s'
                '<div class="sources"><b>参考来源</b><ul>%s</ul></div></article>'
                % (anchor, html.escape(version.title), html.escape(topic_name), version.number,
                   # 正文里的 ## 降为 ###，避免和文章标题同级
                   render_markdown(re.sub(r"^## ", "### ", version.body_markdown, flags=re.M)), sources)
            )

    page = (
        '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        "<title>知识库专题文章预览</title><style>%s</style></head><body><div class=\"wrap\">"
        '<div class="top"><span class="badge">未经医学审核 · 仅供预览校对</span>'
        "<h1>脊柱侧弯知识库 · 精选专题文章</h1>"
        "<p>共 %d 篇，六个专题。本文集由编辑依据文末所列公开来源整理，用于健康教育，不替代医生的诊断与治疗建议。</p>"
        "<p>本文件不改变 App 的发布状态；专题页是否展示仍取决于医学审核。</p></div>"
        '<div class="toc"><h2>目录</h2>%s</div>%s</div></body></html>'
    ) % (CSS, len(cards), "".join(toc), "".join(cards))

    OUT.write_text(page, encoding="utf-8")
    print("written", OUT, len(cards), "articles")


if __name__ == "__main__":
    main()
