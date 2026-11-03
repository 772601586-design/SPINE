"""Build the delivery ZIP for the knowledge-base topic package."""
import shutil
import subprocess
import zipfile
from pathlib import Path

ROOT = Path(r"D:\SPINE-main (2)\SPINE-main\SPINE-main")
STAGE = ROOT / "output" / "delivery-staging"
OUT = ROOT / "知识库专题交付包-v1.zip"
BASE_COMMIT = "31c58bd"

PACKAGE = [
    ("01-提示词", ROOT / "backend/knowledge/prompts", "*.md"),
    ("02-稿件", ROOT / "backend/knowledge/content/topics", "*.md"),
    ("02-稿件", ROOT / "backend/knowledge/content", "sources.json"),
    ("02-稿件", ROOT / "backend/knowledge/content", "articles.json"),
    ("02-稿件", ROOT / "backend/knowledge/content", "knowledge-topics.zip"),
    ("02-稿件", ROOT / "backend/knowledge/content", "build_package.py"),
    ("03-报告", ROOT / "backend/knowledge/content", "import-report.json"),
    ("03-报告", ROOT / "backend/knowledge/content", "import-report-main.json"),
    ("03-报告", ROOT / "backend/knowledge/content", "import-preview-main.json"),
    ("03-报告", ROOT / "ai_path", "knowledge-claims-report.json"),
    ("03-报告", ROOT / "ai_path", "knowledge-demo-review-repair.json"),
    ("03-报告", ROOT / "ai_path", "knowledge-rewrite-report.json"),
    ("03-报告", ROOT / "ai_path", "knowledge-import-report.json"),
    ("04-文档", ROOT / "ai_path", "知识库专题文章与权威来源.md"),
    ("04-文档", ROOT / "ai_path", "知识库实施与验收.md"),
    ("04-文档", ROOT / "ai_path", "知识库审核SOP.md"),
    ("05-预览", ROOT / "ai_path", "知识库专题文章预览.html"),
    ("05-预览", ROOT / "output", "kb-preview.png"),
]


def reset_stage():
    if STAGE.exists():
        shutil.rmtree(STAGE)
    STAGE.mkdir(parents=True)


def copy_items():
    for folder, source, pattern in PACKAGE:
        target = STAGE / folder
        target.mkdir(parents=True, exist_ok=True)
        if pattern.startswith("*"):
            for item in sorted(source.glob(pattern)):
                shutil.copy2(item, target / item.name)
        else:
            item = source / pattern
            if not item.exists():
                raise SystemExit("missing: " + str(item))
            shutil.copy2(item, target / item.name)

    shutil.copy2(ROOT / "ai_path" / "交付说明-知识库专题.md", STAGE / "README-交付说明.md")


def write_patch():
    patch = subprocess.run(
        ["git", "-C", str(ROOT), "diff", BASE_COMMIT + "..HEAD", "--", ".",
         ":(exclude)*.png", ":(exclude)*.jpg", ":(exclude)*.jpeg",
         ":(exclude)*.gif", ":(exclude)*.webm", ":(exclude)*.ico", ":(exclude)*.zip"],
        capture_output=True, check=True,
    ).stdout
    (STAGE / "06-代码变更.patch").write_bytes(patch)
    print("patch: %.1f KB" % (len(patch) / 1024))


def build_zip():
    if OUT.exists():
        OUT.unlink()
    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        for path in sorted(STAGE.rglob("*")):
            if path.is_file():
                zf.write(path, Path("知识库专题交付包-v1") / path.relative_to(STAGE))
    with zipfile.ZipFile(OUT) as zf:
        names = zf.namelist()
    print("zip:", OUT)
    print("size: %.1f MB" % (OUT.stat().st_size / 1024 / 1024))
    print("entries:", len(names))
    return names


def main():
    reset_stage()
    copy_items()
    write_patch()
    names = build_zip()
    for name in names:
        print("  " + name)


if __name__ == "__main__":
    main()
