// Reuse the local OCR service. Documents are not sent to an external provider.
function recognize(path) {
  return new Promise((resolve, reject) => {
    if (typeof wx.recognizeDocument === 'function') {
      wx.recognizeDocument({ path, success: resolve, fail: error => reject(Error(error.message || error.errMsg || '识别未完成，请重试或手动校对。')) });
      return;
    }
    const fs = wx.getFileSystemManager();
    if (!fs.readFile || typeof wx.request !== 'function') { reject(Error('当前环境暂不能识别，可先保存原件并手动校对文字。')); return; }
    fs.readFile({ filePath: path, encoding: 'base64', success: result => {
      const mime = /\.png$/i.test(path) ? 'image/png' : 'image/jpeg';
      wx.request({ url: 'http://127.0.0.1:4180/api/recognize-document', method: 'POST', timeout: 50000,
        data: { image: 'data:' + mime + ';base64,' + result.data },
        success: response => response.statusCode === 200 ? resolve(response.data) : reject(Error(response.data.error || '识别未完成，可重试或手动补充。')),
        fail: () => reject(Error('本机识别服务未连接，可先保存原件并手动校对。')) });
    }, fail: () => reject(Error('原件无法读取，请重新选择图片。')) });
  });
}

function recognizeFile(document) {
  return new Promise((resolve, reject) => {
    if (!document || typeof document !== 'object') { reject(Error('请选择方案文件。')); return; }
    const path = document.path || document.filePath || document.tempFilePath;
    const name = document.originalName || document.name || (typeof path === 'string' ? path.split(/[\\/]/).pop() : '');
    const extension = String(document.extension || name.split('.').pop() || '').replace(/^\./, '').toLowerCase();
    if (typeof path !== 'string' || !path || !name) { reject(Error('方案原件无法读取，请重新选择文件。')); return; }
    if (Number(document.size) > 20 * 1024 * 1024) { reject(Error('方案文件需小于 20 MB，请压缩或分成多个文件。')); return; }
    if (typeof wx.recognizeSchemeFile === 'function') {
      wx.recognizeSchemeFile({ path, name, extension, success: resolve,
        fail: error => reject(Error(error.message || error.errMsg || '方案识别未完成，请重试。')) });
      return;
    }
    const fs = typeof wx.getFileSystemManager === 'function' ? wx.getFileSystemManager() : null;
    if (!fs || typeof fs.readFile !== 'function' || typeof wx.request !== 'function') {
      reject(Error('当前环境未连接本机方案识别服务，原件已保留，可连接服务后重试。')); return;
    }
    fs.readFile({ filePath: path, encoding: 'base64', success: result => {
      if (typeof result.data !== 'string' || !result.data) { reject(Error('方案文件内容无法读取，请重新选择。')); return; }
      wx.request({ url: 'http://127.0.0.1:4180/api/recognize-scheme', method: 'POST', timeout: 180000,
        header: { 'content-type': 'application/json' }, data: { fileBase64: result.data, name, extension },
        success: response => response.statusCode === 200 && response.data && typeof response.data.text === 'string'
          ? resolve(response.data) : reject(Error(response.data && response.data.error || '方案识别未完成，请重试。')),
        fail: () => reject(Error('本机方案识别服务未连接，原件已保留，请连接服务后重试。')) });
    }, fail: () => reject(Error('方案原件无法读取，请重新选择文件。')) });
  });
}
module.exports = { recognize, recognizeFile };
