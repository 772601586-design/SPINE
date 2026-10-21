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
module.exports = { recognize };
