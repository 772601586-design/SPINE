"""Local, bounded document extraction. Never resolves URLs or executes document content."""
import argparse
import json
import re
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

MAX_PAGES = 24
MAX_TEXT = 200000
MAX_XML_BYTES = 8 * 1024 * 1024
W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


class ExtractionError(Exception):
    def __init__(self, code, message):
        self.code = code
        super().__init__(message)


def clean(text):
    return text.replace("\x00", "").replace("\r\n", "\n").replace("\r", "\n").strip("\ufeff \t\n")


def text_quality(text):
    compact = re.sub(r"\s", "", text)
    if not compact:
        return -100
    bad = sum(c == "\ufffd" or 0xE000 <= ord(c) <= 0xF8FF or (ord(c) < 32 and c not in "\n\t\r") for c in compact)
    bad += len(re.findall(r"\(cid:\d+\)", text)) * 6
    cjk = sum("\u3400" <= c <= "\u9fff" for c in compact)
    return len(compact) + cjk * 0.5 - bad * 20


def needs_ocr(text):
    compact = re.sub(r"\s", "", text)
    bad = sum(c == "\ufffd" or 0xE000 <= ord(c) <= 0xF8FF or (ord(c) < 32 and c not in "\n\t\r") for c in compact)
    return len(compact) < 20 or bad > max(1, len(compact) * 0.015) or "(cid:" in text


def extract_pdf(filename, output):
    import pypdfium2 as pdfium
    from pypdf import PdfReader

    try:
        reader = PdfReader(str(filename))
        if reader.is_encrypted and reader.decrypt("") == 0:
            raise ExtractionError("PASSWORD_REQUIRED", "PDF 已加密，请上传未加密的方案文件。")
        count = len(reader.pages)
        if count > MAX_PAGES:
            raise ExtractionError("TOO_MANY_PAGES", "方案 PDF 需不超过 24 页，请分成多个文件上传。")
        if not count:
            raise ValueError("No pages")
        document = pdfium.PdfDocument(str(filename))
        pages = []
        try:
            for index, page in enumerate(reader.pages):
                candidates = []
                try:
                    candidates.append(clean(page.extract_text() or ""))
                except Exception:
                    pass
                rendered_page = document[index]
                try:
                    text_page = rendered_page.get_textpage()
                    try:
                        candidates.append(clean(text_page.get_text_range() or ""))
                    finally:
                        text_page.close()
                    text = max(candidates, key=text_quality) if candidates else ""
                    info = {"text": text, "needsOcr": needs_ocr(text)}
                    if info["needsOcr"]:
                        width, height = rendered_page.get_size()
                        if not width or not height:
                            raise ValueError("Invalid PDF dimensions")
                        scale = min(2.0, 2400.0 / max(width, height))
                        bitmap = rendered_page.render(scale=scale)
                        try:
                            bitmap.to_pil().save(output / ("page-%d.png" % (index + 1)))
                        finally:
                            bitmap.close()
                        info["image"] = "page-%d.png" % (index + 1)
                    pages.append(info)
                finally:
                    rendered_page.close()
        finally:
            document.close()
        return {"pages": pages, "engine": "local-pdf-text"}
    except ExtractionError:
        raise
    except Exception as exc:
        raise ExtractionError("INVALID_PDF", "无法读取这份 PDF，请确认文件完整且没有密码后重试。") from exc


def paragraph(node):
    return "".join(item.text or "" if item.tag == W + "t" else "\n" if item.tag in (W + "br", W + "cr") else "\t" if item.tag == W + "tab" else "" for item in node.iter())


def word_blocks(parent):
    result = []
    for node in parent:
        if node.tag == W + "p":
            result.append(paragraph(node))
        elif node.tag == W + "tbl":
            for row in node.findall(W + "tr"):
                result.append("\t".join(" ".join(word_blocks(cell)) for cell in row.findall(W + "tc")))
        elif node.tag != W + "sectPr":
            result.extend(word_blocks(node))
    return result


def extract_docx(filename):
    try:
        with zipfile.ZipFile(filename) as archive:
            entries = archive.infolist()
            if len(entries) > 10000 or sum(entry.file_size for entry in entries) > 128 * 1024 * 1024:
                raise ExtractionError("DOCUMENT_TOO_LARGE", "Word 文件解压内容过大，请分成多个方案文件上传。")
            info = archive.getinfo("word/document.xml")
            if info.file_size > MAX_XML_BYTES:
                raise ExtractionError("DOCUMENT_TOO_LARGE", "Word 正文过大，请分成多个方案文件上传。")
            xml = archive.read(info)
            if re.search(br"<!DOCTYPE|<!ENTITY", xml, re.I):
                raise ExtractionError("INVALID_DOCX", "Word 文件包含不支持的 XML 内容，请另存为标准 DOCX 后重试。")
            root = ET.fromstring(xml)
            body = root.find(W + "body")
            if body is None:
                raise ValueError("Missing body")
            return {"text": clean("\n".join(word_blocks(body))), "engine": "local-docx-xml"}
    except ExtractionError:
        raise
    except Exception as exc:
        raise ExtractionError("INVALID_DOCX", "无法读取这份 Word 文件，请重新另存为 DOCX 后上传。") from exc


def extract_text(filename):
    raw = filename.read_bytes()
    encodings = ["utf-8-sig", "gb18030"]
    if raw.startswith((b"\xff\xfe", b"\xfe\xff")):
        encodings = ["utf-16"]
    elif b"\x00" in raw:
        # UTF-16 without a BOM is common in exported Windows text files.
        even, odd = raw[::2].count(0), raw[1::2].count(0)
        if max(even, odd) > len(raw) / 10:
            encodings = ["utf-16-le" if odd >= even else "utf-16-be"]
        else:
            raise ExtractionError("INVALID_TEXT", "文本文件包含无效内容，请另存为 UTF-8 文本后上传。")
    for encoding in encodings:
        try:
            text = clean(raw.decode(encoding, errors="strict"))
            if any(ord(c) < 32 and c not in "\n\t\r" for c in text):
                continue
            return {"text": text, "engine": "local-text-" + encoding}
        except UnicodeError:
            pass
    raise ExtractionError("INVALID_TEXT", "无法识别文本编码，请另存为 UTF-8 文本后上传。")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("kind", choices=["pdf", "docx", "txt"])
    parser.add_argument("filename")
    parser.add_argument("output")
    args = parser.parse_args()
    filename, output = Path(args.filename), Path(args.output)
    try:
        result = extract_pdf(filename, output) if args.kind == "pdf" else extract_docx(filename) if args.kind == "docx" else extract_text(filename)
        text_length = len(result.get("text", "")) + sum(len(page["text"]) for page in result.get("pages", []))
        if text_length > MAX_TEXT:
            raise ExtractionError("TEXT_TOO_LONG", "方案文字超过 20 万字，请分成多个文件上传。")
        print(json.dumps(result, ensure_ascii=True))
    except ExtractionError as exc:
        print(json.dumps({"error": str(exc), "code": exc.code}, ensure_ascii=True))
        sys.exit(2)


if __name__ == "__main__":
    main()
