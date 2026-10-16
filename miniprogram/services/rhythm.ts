/** Wall-clock rhythm. It never confirms or persists exercise completion. */
export class Rhythm {
  private elapsed = 0;
  private started = 0;
  private running = false;
  constructor(public readonly total: number, public readonly stepSeconds: number, public readonly mode: 'timer' | 'count') {}
  start(now: number): void { if (!this.running) { this.started = now; this.running = true; } }
  pause(now: number): void { if (this.running) { this.elapsed += Math.max(0, now - this.started); this.running = false; } }
  reset(): void { this.elapsed = 0; this.started = 0; this.running = false; }
  state(now: number): { value: number; progress: number; finished: boolean; running: boolean } {
    const duration = this.mode === 'timer' ? this.total : this.total * this.stepSeconds;
    const seconds = (this.elapsed + (this.running ? Math.max(0, now - this.started) : 0)) / 1000;
    const finished = seconds >= duration;
    const value = this.mode === 'timer' ? Math.max(0, Math.ceil(this.total - seconds))
      : Math.min(this.total, Math.floor(seconds / this.stepSeconds));
    return { value, progress: Math.min(100, Math.max(0, seconds / duration * 100)), finished, running: this.running && !finished };
  }
}
