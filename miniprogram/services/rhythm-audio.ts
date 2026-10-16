let player: WxInnerAudioContext | null = null;
let sequence = 0;
function numberClips(value: number): number[] {
  if (value <= 20 || value % 10 === 0 && value < 100) return [value];
  if (value < 100) return [Math.floor(value / 10) * 10, value % 10];
  const hundreds = Math.floor(value / 100), remainder = value % 100;
  return [hundreds, 100, ...(remainder ? [...(remainder < 10 ? [0] : []), ...numberClips(remainder)] : [])];
}
export function stopRhythmAudio(): void {
  sequence += 1;
  if (player) { player.stop(); player.destroy(); player = null; }
}
export function speakRhythm(value: number | 'begin' | 'paused' | 'done'): void {
  stopRhythmAudio();
  const current = sequence;
  const clips: Array<number | string> = typeof value === 'number' ? numberClips(value) : [value];
  const next = (): void => {
    if (current !== sequence || !clips.length) return;
    if (player) { player.destroy(); player = null; }
    player = wx.createInnerAudioContext();
    player.src = `/assets/rhythm/${clips.shift()}.wav`;
    player.onEnded(next);
    player.onError(() => { if (current === sequence && player) { player.destroy(); player = null; } });
    player.play();
  };
  next();
}
