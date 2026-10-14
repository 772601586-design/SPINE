import type { Attachment } from '../models/types';
import { ApiError, request } from './request';

/**
 * 私有附件的三步上传（规格 §15）：申请 → 传字节 → 确认。
 *
 * 服务端在收到字节之前就要知道用途、类型和体积，所以先申请 intent。上传地址自带
 * 短期签名，`wx.uploadFile` 不需要也不应该带 Token 头。
 */
export interface LocalFile { path: string; name: string; size: number }

interface UploadIntent {
  id: string; upload_url: string; method: string; field_name: string;
  expires_at: string; max_bytes: number;
}

const MIME_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', pdf: 'application/pdf',
};

export function mimeFor(filename: string): string {
  const suffix = filename.slice(filename.lastIndexOf('.') + 1).toLowerCase();
  return MIME_BY_EXTENSION[suffix] ?? 'application/octet-stream';
}

export function isPreviewableImage(mime: string): boolean {
  return mime === 'image/jpeg' || mime === 'image/png' || mime === 'image/webp';
}

function parseUploadError(statusCode: number, raw: string): ApiError {
  try {
    const payload = JSON.parse(raw) as { error?: { code?: string; message?: string; request_id?: string } };
    if (payload?.error?.message) {
      return new ApiError(statusCode, payload.error.message, payload.error.code, undefined, payload.error.request_id);
    }
  } catch (_) { /* 非 JSON 响应按下面的兜底处理 */ }
  return new ApiError(statusCode, '文件上传失败，请重试。');
}

function sendBytes(intent: UploadIntent, file: LocalFile): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    wx.uploadFile({
      url: intent.upload_url,
      filePath: file.path,
      name: intent.field_name || 'file',
      timeout: 60000,
      success(response) {
        if (response.statusCode >= 200 && response.statusCode < 300) { resolve(); return; }
        reject(parseUploadError(response.statusCode, response.data));
      },
      fail(error) { reject(new Error(error.errMsg || '文件上传失败，请检查网络后重试。')); },
    });
  });
}

export async function uploadPrivateFile(purpose: string, file: LocalFile): Promise<Attachment> {
  const intent = await request<UploadIntent>('POST', '/api/v1/attachments/upload-intent/', {
    purpose, filename: file.name, mime_type: mimeFor(file.name), size_bytes: file.size,
  });
  await sendBytes(intent, file);
  return request<Attachment>('POST', `/api/v1/attachments/${intent.id}/complete/`, {});
}
