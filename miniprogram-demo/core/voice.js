let audio = null;
let generation = 0;
function stop() { generation++; if (audio) { audio.stop(); audio.destroy(); audio = null; } }
function digits(value) {
  if (value <= 20 || value < 100 && value % 10 === 0) return [value];
  if (value < 100) return [Math.floor(value / 10) * 10, value % 10];
  if (value <= 999) { const remainder = value % 100; return [Math.floor(value / 100), 100].concat(remainder ? (remainder < 10 ? [0] : []).concat(digits(remainder)) : []); }
  return String(value).split('').map(Number);
}
function speak(value) {
  stop(); const token = generation, queue = typeof value === 'number' ? digits(value) : [value];
  function next() {
    if (token !== generation) return;
    if (audio) { audio.destroy(); audio = null; }
    if (!queue.length) return;
    audio = wx.createInnerAudioContext(); audio.src = '/assets/rhythm/' + queue.shift() + '.wav';
    audio.onEnded(next); audio.onError(stop); audio.play();
  }
  next();
}
module.exports = { speak, stop };
