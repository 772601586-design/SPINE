#!/usr/bin/env python
"""Build an importable knowledge package from topics/*.md + sources.json.

Usage:
    python backend/knowledge/content/build_package.py

Outputs (next to this file):
    articles.json          - article array accepted by knowledge.importing
    knowledge-topics.zip   - ZIP containing articles.json + sources.json

The script only rearranges text that already exists in topics/*.md. It never
calls a model and never marks anything as medically reviewed.
"""
import json
import re
import sys
import zipfile
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent
TOPICS = ROOT / "topics"
SOURCES = ROOT / "sources.json"
OUT_JSON = ROOT / "articles.json"
OUT_ZIP = ROOT / "knowledge-topics.zip"

CATEGORIES = {
    "刚发现侧弯", "看懂检查结果", "正在接受治疗",
    "每天怎么生活", "情绪与成长", "长期康复与随访",
}
SECTIONS = ["核心回答", "详细医学解释", "相关概念", "需要区分的情况", "常见误区", "就医提示", "延伸阅读"]
REQUIRED = ["id", "title", "category", "summary", "target_population", "keywords",
            "content_type", "risk_level", "source_ids", "source_urls",
            "related_article_ids", "clinical_review_status", "publication_status"]
ID_RE = re.compile(r"^[-a-zA-Z0-9_]{1,100}$")


def parse_markdown(path: Path):
    text = path.read_text(encoding="utf-8-sig")
    parts = re.split(r"^---\s*$", text, maxsplit=2, flags=re.M)
    if len(parts) != 3 or parts[0].strip():
        raise ValueError("需要 YAML front matter（--- 包裹），其后为正文")
    meta = yaml.safe_load(parts[1])
    if not isinstance(meta, dict):
        raise ValueError("front matter 必须是对象")
    body = parts[2].strip()
    missing = [name for name in REQUIRED if meta.get(name) in (None, "", [])]
    if missing:
        raise ValueError("缺少字段：" + "、".join(missing))
    meta["body_markdown"] = body
    return meta


def check(meta, sources, seen):
    problems = []
    aid = str(meta["id"])
    if not ID_RE.fullmatch(aid):
        problems.append("ID 不合法")
    if aid in seen:
        problems.append("ID 重复")
    if meta["category"] not in CATEGORIES:
        problems.append("未知分类：" + str(meta["category"]))
    if len(str(meta["title"])) > 300:
        problems.append("标题超过 300 字")
    for section in SECTIONS:
        if not re.search(r"^#{1,6}\s+.*" + re.escape(section), meta["body_markdown"], re.M):
            problems.append("缺少章节：" + section)
    for key in ["keywords", "source_ids", "source_urls", "related_article_ids"]:
        if not isinstance(meta[key], list):
            problems.append(key + " 必须是数组")
    for sid in meta["source_ids"]:
        if sid not in sources:
            problems.append("未知来源：" + sid)
    for url in meta["source_urls"]:
        if not isinstance(url, str) or not url.startswith("https://"):
            problems.append("来源链接必须为 https：" + str(url)[:60])
    if len(meta["source_ids"]) != len(meta["source_urls"]):
        problems.append("source_ids 与 source_urls 数量不一致")
    if meta["clinical_review_status"] != "pending":
        problems.append("clinical_review_status 必须是 pending")
    if meta["publication_status"] != "draft_not_approved":
        problems.append("publication_status 必须是 draft_not_approved")
    if meta["risk_level"] not in {"low", "medium", "high"}:
        problems.append("risk_level 必须是 low/medium/high")
    if not meta["body_markdown"].strip():
        problems.append("正文为空")
    return problems


def main():
    if not SOURCES.exists():
        sys.exit("找不到 sources.json")
    sources = json.loads(SOURCES.read_text(encoding="utf-8"))
    files = sorted(TOPICS.glob("*.md"))
    if not files:
        sys.exit("topics/ 下没有 Markdown 文件")

    rows, seen, failures = [], set(), []
    for path in files:
        try:
            meta = parse_markdown(path)
        except (ValueError, yaml.YAMLError) as exc:
            failures.append((path.name, [str(exc)]))
            continue
        problems = check(meta, sources, seen)
        if problems:
            failures.append((path.name, problems))
            continue
        seen.add(str(meta["id"]))
        rows.append({key: meta[key] for key in
                     ["id", "title", "category", "summary", "body_markdown", "target_population",
                      "keywords", "content_type", "risk_level", "source_ids", "source_urls",
                      "related_article_ids", "clinical_review_status", "publication_status"]})

    # Referenced related articles must exist in this package (or be intentionally empty).
    ids = {row["id"] for row in rows}
    for row in rows:
        for ref in row["related_article_ids"]:
            if ref not in ids:
                failures.append((row["id"], ["关联文章不存在：" + ref]))

    if failures:
        for name, problems in failures:
            print("[FAIL] " + name)
            for problem in problems:
                print("       - " + problem)
        sys.exit(1)

    OUT_JSON.write_text(json.dumps(rows, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    with zipfile.ZipFile(OUT_ZIP, "w", zipfile.ZIP_DEFLATED) as package:
        package.writestr("articles.json", json.dumps(rows, ensure_ascii=False, indent=2))
        package.writestr("sources.json", json.dumps(sources, ensure_ascii=False, indent=2))

    by_topic = {}
    for row in rows:
        by_topic[row["category"]] = by_topic.get(row["category"], 0) + 1
    print("已生成：" + str(OUT_JSON))
    print("已生成：" + str(OUT_ZIP))
    print("文章 %d 篇，来源 %d 条" % (len(rows), len(sources)))
    for category, count in sorted(by_topic.items()):
        print("  %s：%d 篇" % (category, count))


if __name__ == "__main__":
    main()
