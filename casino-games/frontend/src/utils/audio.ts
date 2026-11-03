export class SoundManager {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private enabled: boolean = true;
  private ambient: { level: GainNode; nodes: AudioNode[] } | null = null;
  /** Whether the current screen has asked for the pad, independent of mute. */
  private ambientOn = false;

  constructor() {
    if (typeof window !== 'undefined') {
      const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioContext) {
        this.ctx = new AudioContext();
        this.masterGain = this.ctx.createGain();
        this.masterGain.connect(this.ctx.destination);
        this.masterGain.gain.value = 0.3; // Default volume
      }
      // Browsers block audio before a user gesture; the first click anywhere
      // unlocks the context. It deliberately does NOT start the ambient pad —
      // that used to fire on the first click in the app, so the casino-room pad
      // followed you onto the game-select screen and followed you around the
      // rest of the site. Ambient is now opt-in via setAmbient().
      window.addEventListener('pointerdown', () => this.resumeContext(), { once: true });
    }
  }

  /**
   * Turn the room pad on or off.
   *
   * The one-shots (chip, win, lose, spin, click) are unaffected either way — they
   * play on their own. This only governs the sustained background bed, which
   * belongs to a screen rather than to the session.
   */
  public setAmbient(on: boolean) {
    this.ambientOn = on;
    this.resumeContext();
    if (on) this.ensureAmbient();
    this.setAmbientGain(on && this.enabled ? 0.02 : 0);
  }

  public setVolume(volume: number) {
    if (this.masterGain) {
      this.masterGain.gain.value = Math.max(0, Math.min(1, volume));
    }
  }

  public toggleMute() {
    this.enabled = !this.enabled;
    if (this.masterGain) {
      this.masterGain.gain.value = this.enabled ? 0.3 : 0;
    }
    // Keyed off the requested state, not merely "does the pad exist" — otherwise
    // unmuting anywhere would bring music back on a screen that never asked for it.
    if (this.ambient) this.setAmbientGain(this.enabled && this.ambientOn ? 0.02 : 0);
  }

  // Soft casino-room pad: a detuned chord through a lowpass, with a slow
  // LFO swell. Inaudible until the first user gesture resumes the context.
  private ensureAmbient() {
    if (!this.ctx || !this.masterGain || this.ambient || !this.enabled) return;
    const ctx = this.ctx;

    const level = ctx.createGain();
    level.gain.value = 0;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 650;
    level.connect(filter);
    filter.connect(this.masterGain);

    const swell = ctx.createGain();
    swell.gain.value = 1;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.15;
    lfo.connect(lfoGain);
    lfoGain.connect(swell.gain);
    lfo.start();

    const nodes: AudioNode[] = [swell, filter, lfo, lfoGain];
    [110, 110.7, 164.8].forEach((freq) => {
      const osc = this.createOscillator(freq, 'triangle');
      if (!osc) return;
      osc.connect(swell);
      osc.start();
      nodes.push(osc);
    });
    swell.connect(level);

    this.ambient = { level, nodes };
  }

  private setAmbientGain(value: number) {
    if (!this.ambient || !this.ctx) return;
    this.ambient.level.gain.setTargetAtTime(value, this.ctx.currentTime, 0.8);
  }

  private createOscillator(freq: number, type: OscillatorType = 'sine'): OscillatorNode | null {
    if (!this.ctx) return null;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    return osc;
  }

  // UI Click (Short, crisp high pitched tick)
  public playClick() {
    if (!this.ctx || !this.enabled || !this.masterGain) return;
    this.resumeContext();

    const t = this.ctx.currentTime;
    const osc = this.createOscillator(800, 'triangle');
    const gain = this.ctx.createGain();

    if (!osc) return;

    osc.connect(gain);
    gain.connect(this.masterGain);

    gain.gain.setValueAtTime(0.1, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);

    osc.start(t);
    osc.stop(t + 0.1);
  }

  // Chip Place (Thud sound)
  public playChip() {
    if (!this.ctx || !this.enabled || !this.masterGain) return;
    this.resumeContext();

    const t = this.ctx.currentTime;
    const osc = this.createOscillator(300, 'sine');
    const gain = this.ctx.createGain();

    if (!osc) return;

    osc.connect(gain);
    gain.connect(this.masterGain);

    gain.gain.setValueAtTime(0.2, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);

    osc.start(t);
    osc.stop(t + 0.15);
  }

  // Win (Happy Major Chord Arpeggio)
  public playWin() {
    if (!this.ctx || !this.enabled || !this.masterGain) return;
    this.resumeContext();

    const notes = [523.25, 659.25, 783.99, 1046.50]; // C Major: C5, E5, G5, C6
    const ctx = this.ctx;
    const t = ctx.currentTime;

    notes.forEach((freq, i) => {
      const osc = this.createOscillator(freq, 'triangle');
      const gain = ctx.createGain();
      if (!osc) return;

      osc.connect(gain);
      if (!this.masterGain) return;
      gain.connect(this.masterGain);

      const startTime = t + i * 0.08;
      gain.gain.setValueAtTime(0, startTime);
      gain.gain.linearRampToValueAtTime(0.15, startTime + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.4);

      osc.start(startTime);
      osc.stop(startTime + 0.4);
    });
  }

  // Lose (Descending low tritone)
  public playLose() {
    if (!this.ctx || !this.enabled || !this.masterGain) return;
    this.resumeContext();

    const t = this.ctx.currentTime;
    const osc = this.createOscillator(180, 'sawtooth');
    const gain = this.ctx.createGain();

    if (!osc) return;

    osc.connect(gain);
    gain.connect(this.masterGain);

    // Pitch bend down
    osc.frequency.setValueAtTime(180, t);
    osc.frequency.exponentialRampToValueAtTime(100, t + 0.4);

    gain.gain.setValueAtTime(0.15, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);

    osc.start(t);
    osc.stop(t + 0.4);
  }

  // Spin (Rolling mechanical sound)
  public playSpin(duration: number = 0.5) {
    if (!this.ctx || !this.enabled || !this.masterGain) return;
    this.resumeContext();

    const t = this.ctx.currentTime;
    const osc = this.createOscillator(100, 'square');
    const gain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter(); // Lowpass to muffle square wave

    if (!osc) return;

    filter.type = 'lowpass';
    filter.frequency.value = 400;

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);

    // Rapid volume modulation for "ticking" effect
    gain.gain.setValueAtTime(0.1, t);
    gain.gain.linearRampToValueAtTime(0, t + duration);

    osc.start(t);
    osc.stop(t + duration);
  }

  private resumeContext() {
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    // No ambient here on purpose: unlocking the context must not start music.
    // setAmbient() owns that decision.
  }
}

// Singleton instance
export const soundManager = new SoundManager();

// Backward compatibility alias
export function playTone(freq: number, duration: number = 0.2) {
  if (typeof window === 'undefined') return;

  // Use the manager to spawn a generic tone
  // @ts-ignore - Accessing private for legacy compat shim
  if (!soundManager.ctx || !soundManager.enabled) return;
  // @ts-ignore
  soundManager.resumeContext();

  // @ts-ignore
  const ctx = soundManager.ctx as AudioContext;
  // @ts-ignore
  const master = soundManager.masterGain as GainNode;

  if (!ctx || !master) return;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.frequency.value = freq;
  osc.type = freq > 400 ? 'sine' : 'triangle';

  osc.connect(gain);
  gain.connect(master);

  gain.gain.setValueAtTime(0.15, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

  osc.start();
  osc.stop(ctx.currentTime + duration);
}

