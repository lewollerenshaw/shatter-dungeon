/**
 * All sound is synthesised with WebAudio, so there are no audio assets to
 * load. Every effect is rate-limited so a 500-hit turn stays pleasant.
 */
const PENTATONIC = [0, 2, 4, 7, 9];

export class Sfx {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private last = new Map<string, number>();
  muted = false;

  /** Must be called from a user gesture (browsers block audio until then). */
  unlock(): void {
    if (!this.ctx) {
      const AC: typeof AudioContext | undefined =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -16;
      comp.ratio.value = 6;
      const out = ctx.createGain();
      out.gain.value = 0.5;
      out.connect(comp).connect(ctx.destination);
      const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      this.ctx = ctx;
      this.out = out;
      this.noiseBuf = buf;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private ok(name: string, gap: number): boolean {
    if (!this.ctx || this.muted || this.ctx.state !== 'running') return false;
    const t = this.ctx.currentTime;
    if (t - (this.last.get(name) ?? -1) < gap) return false;
    this.last.set(name, t);
    return true;
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, slideTo = 0, delay = 0): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo > 0) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.out!);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private noise(dur: number, vol: number, freq: number, type: BiquadFilterType = 'lowpass', slideTo = 0): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (slideTo > 0) f.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.out!);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  /** Climbs a pentatonic scale as the combo builds. */
  bounce(combo: number): void {
    if (!this.ok('bounce', 0.028)) return;
    const step = Math.min(combo, 34);
    const semis = PENTATONIC[step % 5] + 12 * Math.floor(step / 5);
    this.tone(196 * Math.pow(2, semis / 12), 0.09, 'triangle', 0.22);
  }

  wall(): void {
    if (this.ok('wall', 0.06)) this.tone(140, 0.04, 'sine', 0.06);
  }

  launch(): void {
    if (this.ok('launch', 0.05)) this.tone(520, 0.07, 'sine', 0.1, 880);
  }

  crit(): void {
    if (!this.ok('crit', 0.07)) return;
    this.tone(1320, 0.16, 'square', 0.07, 1980);
  }

  kill(): void {
    if (!this.ok('kill', 0.045)) return;
    this.noise(0.16, 0.3, 2400, 'bandpass', 500);
    this.tone(300, 0.14, 'triangle', 0.16, 90);
  }

  explode(): void {
    if (!this.ok('explode', 0.08)) return;
    this.noise(0.35, 0.5, 900, 'lowpass', 80);
    this.tone(110, 0.3, 'sine', 0.35, 40);
  }

  zap(): void {
    if (this.ok('zap', 0.06)) this.tone(1800, 0.1, 'sawtooth', 0.06, 240);
  }

  freeze(): void {
    if (!this.ok('freeze', 0.08)) return;
    this.tone(2100, 0.25, 'sine', 0.1, 3100);
    this.noise(0.12, 0.1, 6000, 'highpass');
  }

  reflect(): void {
    if (this.ok('reflect', 0.05)) this.tone(900, 0.08, 'square', 0.06, 1500);
  }

  armor(): void {
    if (this.ok('armor', 0.05)) this.noise(0.06, 0.16, 5000, 'highpass');
  }

  shatter(): void {
    if (!this.ok('shatter', 0.08)) return;
    this.noise(0.22, 0.25, 4200, 'highpass');
    this.tone(1500, 0.2, 'triangle', 0.08, 500);
  }

  heroHit(): void {
    if (!this.ok('heroHit', 0.1)) return;
    this.tone(90, 0.4, 'sawtooth', 0.3, 35);
    this.noise(0.3, 0.4, 500, 'lowpass', 60);
  }

  heal(): void {
    if (this.ok('heal', 0.15)) this.tone(520, 0.18, 'sine', 0.1, 780);
  }

  perk(): void {
    if (!this.ok('perk', 0.1)) return;
    [0, 4, 7, 12].forEach((s, i) => this.tone(392 * Math.pow(2, s / 12), 0.3, 'triangle', 0.16, 0, i * 0.06));
  }

  floorClear(): void {
    if (!this.ok('floorClear', 0.3)) return;
    [0, 7, 12, 16].forEach((s, i) => this.tone(330 * Math.pow(2, s / 12), 0.35, 'triangle', 0.18, 0, i * 0.08));
  }

  boss(): void {
    if (!this.ok('boss', 0.5)) return;
    this.tone(55, 1.4, 'sawtooth', 0.3, 41);
    this.tone(82, 1.4, 'square', 0.12, 61);
    this.noise(1.1, 0.2, 300, 'lowpass', 60);
  }

  death(): void {
    if (!this.ok('death', 0.5)) return;
    [0, -3, -7, -12].forEach((s, i) => this.tone(294 * Math.pow(2, s / 12), 0.45, 'sawtooth', 0.14, 0, i * 0.16));
  }

  click(): void {
    if (this.ok('click', 0.03)) this.tone(660, 0.05, 'sine', 0.1);
  }
}
