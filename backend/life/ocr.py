"""Local OCR only. No private report is sent to a third-party service."""
import json
import os
from pathlib import Path
import re
import shutil
import subprocess

from django.shortcuts import get_object_or_404
from rest_framework.exceptions import ValidationError
from rest_framework import serializers
from rest_framework.response import Response
from rest_framework.views import APIView

from core.models import Attachment
from core.storage import StorageError, get_storage
from core.errors import ErrorCode, SpineError


class OCRUnavailable(SpineError):
    status_code = 503
    default_code = ErrorCode.SERVICE_UNAVAILABLE

    def __init__(self):
        super().__init__("本机 OCR 引擎暂不可用，请使用手动录入与校对。")


def recognize(path):
    if os.name == "nt":
        shell = shutil.which("powershell.exe")
        if not shell:
            raise OCRUnavailable()
        command = [shell, "-NoLogo", "-NoProfile", "-NonInteractive", "-File", str(Path(__file__).with_name("windows_ocr.ps1")), "-ImagePath", str(path)]
    else:
        binary = shutil.which("tesseract")
        if not binary:
            raise OCRUnavailable()
        command = [binary, str(path), "stdout", "-l", "chi_sim+eng"]
    try:
        result = subprocess.run(command, capture_output=True, timeout=45, check=True, encoding="utf-8", errors="replace")
        return json.loads(result.stdout)["text"] if os.name == "nt" else result.stdout
    except (subprocess.SubprocessError, OSError, ValueError, KeyError) as exc:
        raise OCRUnavailable() from exc


def prescription_candidates(text):
    candidates = []
    # Extract only explicitly labelled dose fields; never assume missing doses or direction.
    for line in text.splitlines()[:100]:
        line = line.strip()
        line = re.sub(r"(?<=\d)\s+(?=\d)", "", line)
        line = re.sub(r"(?<=[\u4e00-\u9fff])\s+(?=[\u4e00-\u9fff])", "", line)
        found = {}
        for key, pattern in [("sets", r"(\d+)\s*组"), ("reps_per_set", r"(\d+)\s*次(?!呼吸)"),
                             ("breaths_per_set", r"(\d+)\s*(?:次呼吸|呼吸)"), ("hold_seconds", r"(\d+)\s*秒")]:
            match = re.search(pattern, line)
            if match:
                found[key] = int(match.group(1))
        if not found:
            continue
        first_number = re.search(r"\d+\s*(?:组|次|呼吸|秒)", line)
        name = line[:first_number.start()].strip(" ·:：,，;；-0123456789.、") if first_number else ""
        if name:
            candidates.append({"name": name[:160], **found})
    return candidates[:50]


class OCRView(APIView):
    def post(self, request):
        attachment_id = serializers.UUIDField().run_validation(request.data.get("attachment"))
        attachment = get_object_or_404(Attachment, pk=attachment_id, owner=request.user, status="ready", purpose="medical")
        if attachment.mime_type not in ("image/jpeg", "image/png"):
            raise ValidationError("OCR 支持 JPG / PNG。PDF 请先转为报告图片，或手动录入。")
        storage = get_storage()
        if not hasattr(storage, "path"):
            raise OCRUnavailable()
        try:
            text = recognize(storage.path(attachment.storage_key))[:20000]
        except StorageError as exc:
            raise OCRUnavailable() from exc
        return Response({"text": text, "candidates": prescription_candidates(text), "requires_confirmation": True,
                         "note": "仅识别印刷文字；请逐项对照原件。未生成诊断或从影像测量角度。"})
