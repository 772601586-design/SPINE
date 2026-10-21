const t = require('./training');
const documents = require('./documents');
function saveFile(file) {
  return new Promise((resolve, reject) => {
    const originalName = file.name || String(file.tempFilePath || file.path || '').split('/').pop() || '方案单.jpg';
    const extension = (originalName.split('.').pop() || '').toLowerCase();
    const kind = ['jpg', 'jpeg', 'png'].includes(extension) ? 'image' : extension === 'txt' ? 'text' : ['pdf', 'doc', 'docx'].includes(extension) ? 'document' : '';
    if (!kind) { reject(Error('请选择 JPG、PNG、PDF、Word 或 TXT 方案单。')); return; }
    if (file.size > 20 * 1024 * 1024) { reject(Error('方案单文件请控制在 20 MB 以内。')); return; }
    const path = wx.env.USER_DATA_PATH + '/' + t.id('scheme') + '.' + extension;
    wx.getFileSystemManager().copyFile({ srcPath: file.tempFilePath || file.path, destPath: path,
      success: () => {
        try { resolve(documents.save({ type: 'training', path, originalName, extension, kind, recordingBatchId: t.id('scheme-batch'), status: 'pending' })); }
        catch (error) { reject(error); }
      }, fail: () => reject(Error('方案单保存失败，请重新选择。')) });
  });
}
function choose(source) {
  return new Promise((resolve, reject) => {
    const fail = error => /cancel/.test(error.errMsg || '') ? resolve(null) : reject(Error('未能打开相机或文件选择器，请重试。'));
    if (source === 'camera') {
      wx.chooseMedia({ count: 1, mediaType: ['image'], sourceType: ['camera'], sizeType: ['compressed'],
        success: result => result.tempFiles[0] ? saveFile(result.tempFiles[0]).then(resolve, reject) : resolve(null), fail });
    } else {
      wx.chooseMessageFile({ count: 1, type: 'file', extension: ['jpg', 'jpeg', 'png', 'pdf', 'doc', 'docx', 'txt'],
        success: result => result.tempFiles[0] ? saveFile(result.tempFiles[0]).then(resolve, reject) : resolve(null), fail });
    }
  });
}
module.exports = { choose };
