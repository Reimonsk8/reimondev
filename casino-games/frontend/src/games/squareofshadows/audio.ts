/**
 * Square of Shadows — procedural audio.
 *
 * Combat SFX are synthesised with the Web Audio API. The menu and battle music
 * are compressed, crossfaded MP3 loops loaded as static public assets.
 *
 * Autoplay policy: browsers block audio until a user gesture, so the context is
 * resumed on the first real click. Nothing here throws if audio is unavailable.
 */

export type SfxName =
  | 'select'
  | 'move'
  | 'attack'
  | 'hit'
  | 'heal'
  | 'unitDefeated'
  | 'invalid'
  | 'turnStart'
  | 'spell'
  | 'victory'
  | 'defeat'
  | 'soulHarvest'
  | 'altarWish';

/** Footfall timbre, chosen from the mover's class weight. */
export type FootstepWeight = 'heavy' | 'stone' | 'light';

/** Which ability to voice — each has a distinct transient so it reads clearly. */
export type SpellCue =
  | 'fireball'
  | 'thunder'
  | 'ice'
  | 'bless'
  | 'trap'
  | 'grapple'
  | 'slam';

export type AudioPrefs = {
  sfx: boolean;
  music: boolean;
  sfxVolume: number;
  musicVolume: number;
};
export type MusicTrack = 'menu' | 'battle';

export const MUSIC_TRACK_URLS: Record<MusicTrack, string> = {
  menu: publicAsset('/audio/square-of-shadows/menu-loop.mp3'),
  battle: publicAsset('/audio/square-of-shadows/battle-loop.mp3'),
};

export const MUSIC_SFX_RATIO = 0.4;
export const MUSIC_FADE_SECONDS = 2;

/** Optional placement + send for a one-shot. */
export interface CueOptions {
  /** -1 (hard left) .. 1 (hard right), normally derived from board X. */
  pan?: number;
  /** How much of the cavern reverb send this cue gets (0..1). */
  reverb?: number;
}

const PREFS_KEY = 'c888_sos_audio';
const SFX_BUS_GAIN = 0.55;
const DEFAULT_AUDIO_PREFS: AudioPrefs = {
  sfx: true,
  music: true,
  sfxVolume: 100,
  musicVolume: Math.round(MUSIC_SFX_RATIO * 100),
};
const clampVolume = (value: number | undefined, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(100, Math.round(value)))
    : fallback;
const sfxGain = () => (prefs.sfx ? SFX_BUS_GAIN * (prefs.sfxVolume / 100) : 0);
const musicGain = () => (prefs.music ? SFX_BUS_GAIN * (prefs.musicVolume / 100) : 0);

const readPrefs = (): AudioPrefs => {
  if (typeof localStorage === 'undefined') return { ...DEFAULT_AUDIO_PREFS };
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return { ...DEFAULT_AUDIO_PREFS };
    const parsed = JSON.parse(raw) as Partial<AudioPrefs>;
    return {
      sfx: parsed.sfx !== false,
      music: parsed.music !== false,
      sfxVolume: clampVolume(parsed.sfxVolume, DEFAULT_AUDIO_PREFS.sfxVolume),
      musicVolume: clampVolume(parsed.musicVolume, DEFAULT_AUDIO_PREFS.musicVolume),
    };
  } catch {
    return { ...DEFAULT_AUDIO_PREFS };
  }
};

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let sfxBus: GainNode | null = null;
let musicBus: GainNode | null = null;
/** Cavern send. Everything routed here comes back smeared and echoing. */
let reverbBus: GainNode | null = null;
let prefs: AudioPrefs = readPrefs();
type MusicPlayback = { track: MusicTrack; source: AudioBufferSourceNode; gain: GainNode };
let activeMusic: MusicPlayback | null = null;
let requestedMusic: MusicTrack | null = null;
let musicRequest = 0;
const musicBuffers = new Map<MusicTrack, Promise<AudioBuffer | null>>();

const now = () => (ctx ? ctx.currentTime : 0);

/** Create the graph on first use. Safe to call repeatedly. */
const ensure = (): AudioContext | null => {
  if (typeof window === 'undefined') return null;
  if (ctx) {
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
    return ctx;
  }
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
  } catch {
    return null;
  }
  master = ctx.createGain();
  master.gain.value = 0.9;
  master.connect(ctx.destination);
  sfxBus = ctx.createGain();
  sfxBus.gain.value = sfxGain();
  sfxBus.connect(master);
  musicBus = ctx.createGain();
  musicBus.gain.value = 0;
  musicBus.connect(master);

  // A stone dungeon: synthesised impulse response (decaying noise) instead of
  // shipping an audio file. Long-ish tail so hits read as "in a big room".
  reverbBus = ctx.createGain();
  reverbBus.gain.value = 1;
  const convolver = ctx.createConvolver();
  const seconds = 2.4;
  const length = Math.floor(ctx.sampleRate * seconds);
  const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let channel = 0; channel < 2; channel += 1) {
    const data = impulse.getChannelData(channel);
    for (let i = 0; i < length; i += 1) {
      const decay = Math.pow(1 - i / length, 2.6);
      data[i] = (Math.random() * 2 - 1) * decay * 0.6;
    }
  }
  convolver.buffer = impulse;
  const wet = ctx.createGain();
  wet.gain.value = 0.5;
  reverbBus.connect(convolver);
  convolver.connect(wet);
  wet.connect(master);
  return ctx;
};

/** Pan from a board column: left edge -1, centre 0, right edge +1. */
export function panFromColumn(x: number, width: number): number {
  if (width <= 1) return 0;
  const centre = (width - 1) / 2;
  return Math.max(-1, Math.min(1, (x - centre) / centre));
}

/**
 * Route a node through a stereo panner (when panned) and optionally into the
 * cavern send. Keeps every voice in one place so panning stays consistent.
 */
const place = (node: AudioNode, { pan, reverb }: CueOptions = {}): void => {
  let tail: AudioNode = node;
  if (pan !== undefined && pan !== 0 && ctx && typeof ctx.createStereoPanner === 'function') {
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    tail.connect(panner);
    tail = panner;
  }
  tail.connect(sfxBus as GainNode);
  if (reverb && reverbBus) {
    const send = ctx!.createGain();
    send.gain.value = reverb;
    tail.connect(send);
    send.connect(reverbBus);
  }
};

/** Call from a user gesture so later sounds are allowed to play. */
export function unlockAudio(): void {
  const audio = ensure();
  if (audio?.state === 'suspended') void audio.resume().catch(() => {});
}

/**
 * Suspend/resume the whole context.
 *
 * Used when the tab is hidden so the ambient loop stops dead instead of
 * droning on in a background tab nobody is listening to. Suspending (rather
 * than stopping the oscillators) keeps playback position, so resuming is
 * seamless and the player's music toggle is untouched.
 */
export function setAudioSuspended(suspended: boolean): void {
  if (!ctx) return;
  if (suspended) {
    if (ctx.state === 'running') void ctx.suspend();
  } else if (ctx.state === 'suspended') {
    void ctx.resume();
  }
}

interface ToneOptions {
  type?: OscillatorType;
  from: number;
  to?: number;
  dur: number;
  gain?: number;
  delay?: number;
  bus?: GainNode | null;
  pan?: number;
  reverb?: number;
}

const tone = ({ type = 'sine', from, to, dur, gain = 0.3, delay = 0, bus, pan, reverb }: ToneOptions) => {
  const c = ensure();
  if (!c) return;
  if (bus) {
    const t0 = now() + delay;
    const osc = c.createOscillator();
    const env = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t0);
    if (to !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t0 + dur);
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(gain, t0 + Math.min(0.02, dur * 0.2));
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(env);
    env.connect(bus);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
    return;
  }
  const t0 = now() + delay;
  const osc = c.createOscillator();
  const env = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(from, t0);
  if (to !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t0 + dur);
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(gain, t0 + Math.min(0.02, dur * 0.2));
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(env);
  if (!sfxBus) return;
  place(env, { pan, reverb });
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
};

interface NoiseOptions {
  dur: number;
  gain?: number;
  cutoff?: number;
  delay?: number;
  type?: BiquadFilterType;
  pan?: number;
  reverb?: number;
}

const noise = ({
  dur,
  gain = 0.2,
  cutoff = 1800,
  delay = 0,
  type = 'lowpass',
  pan,
  reverb,
}: NoiseOptions) => {
  const c = ensure();
  if (!c || !sfxBus) return;
  const t0 = now() + delay;
  const frames = Math.max(1, Math.floor(c.sampleRate * dur));
  const buffer = c.createBuffer(1, frames, c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i += 1) {
    // Fade the noise out so it reads as a hit, not a hiss.
    data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
  }
  const src = c.createBufferSource();
  src.buffer = buffer;
  const filter = c.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = cutoff;
  const env = c.createGain();
  env.gain.value = gain;
  src.connect(filter);
  filter.connect(env);
  place(env, { pan, reverb });
  src.start(t0);
};

/**
 * Footfall voiced by the mover's bulk: the Warrior's plate clanks with a
 * metallic ring on top of the thud, the Ranger is a dry scuff. Both are
 * positioned so you can hear which side of the board moved.
 */
export function playFootstep(weight: FootstepWeight, opts: CueOptions = {}): void {
  if (!prefs.sfx || !ensure()) return;
  const { pan, reverb = 0.35 } = opts;

  switch (weight) {
    case 'heavy':
      // Low body thud plus two inharmonic partials = iron on stone.
      tone({ type: 'sine', from: 90, to: 45, dur: 0.2, gain: 0.3, pan, reverb });
      noise({ dur: 0.16, gain: 0.14, cutoff: 900, pan, reverb });
      tone({ type: 'square', from: 420, to: 300, dur: 0.1, gain: 0.05, pan, reverb: reverb * 0.6 });
      tone({ type: 'triangle', from: 1_180, to: 900, dur: 0.13, gain: 0.045, pan, reverb: reverb * 0.8 });
      break;
    case 'stone':
      tone({ type: 'sine', from: 130, to: 70, dur: 0.14, gain: 0.2, pan, reverb });
      noise({ dur: 0.1, gain: 0.1, cutoff: 1_400, pan, reverb });
      break;
    case 'light':
    default:
      tone({ type: 'sine', from: 200, to: 110, dur: 0.09, gain: 0.14, pan, reverb });
      noise({ dur: 0.07, gain: 0.06, cutoff: 2_400, pan, reverb });
      break;
  }
}

/**
 * Spell cues stay crisp: short attack transient, little reverb send, so they cut
 * through the ambient bed instead of smearing into it.
 */
export function playSpell(cue: SpellCue, opts: CueOptions = {}): void {
  if (!prefs.sfx || !ensure()) return;
  const { pan } = opts;
  const dry = 0.1;

  switch (cue) {
    case 'fireball':
      noise({ dur: 0.34, gain: 0.26, cutoff: 3_000, pan, reverb: dry });
      tone({ type: 'sawtooth', from: 620, to: 110, dur: 0.36, gain: 0.2, pan, reverb: dry });
      break;
    case 'thunder':
      // Crack, then a rumbling tail.
      noise({ dur: 0.1, gain: 0.3, cutoff: 5_000, type: 'highpass', pan, reverb: dry });
      noise({ dur: 0.7, gain: 0.18, cutoff: 420, pan, reverb: 0.5 });
      tone({ type: 'sine', from: 70, to: 38, dur: 0.7, gain: 0.22, pan, reverb: 0.5 });
      break;
    case 'ice':
      tone({ type: 'triangle', from: 1_500, to: 2_400, dur: 0.22, gain: 0.14, pan, reverb: dry });
      noise({ dur: 0.3, gain: 0.12, cutoff: 6_000, type: 'highpass', pan, reverb: 0.4 });
      break;
    case 'bless':
      [523, 659, 880].forEach((f, i) =>
        tone({ type: 'sine', from: f, dur: 0.5, gain: 0.11, delay: i * 0.09, pan, reverb: 0.45 }),
      );
      break;
    case 'trap':
      tone({ type: 'square', from: 320, to: 180, dur: 0.1, gain: 0.12, pan, reverb: dry });
      break;
    case 'grapple':
      tone({ type: 'sawtooth', from: 180, to: 900, dur: 0.16, gain: 0.13, pan, reverb: dry });
      noise({ dur: 0.12, gain: 0.1, cutoff: 3_000, pan, reverb: dry });
      break;
    case 'slam':
      // Shield into a body: low boom plus a bright metallic ring.
      tone({ type: 'sine', from: 110, to: 48, dur: 0.3, gain: 0.3, pan, reverb: 0.4 });
      tone({ type: 'square', from: 640, to: 420, dur: 0.14, gain: 0.08, pan, reverb: 0.3 });
      noise({ dur: 0.2, gain: 0.18, cutoff: 2_400, pan, reverb: 0.35 });
      break;
    default:
      break;
  }
}

/** Map a class to its footfall weight. */
export function footstepWeightFor(type: string): FootstepWeight {
  if (type === 'WARRIOR') return 'heavy';
  if (type === 'RANGER') return 'light';
  // A Beast is built like the Warrior it replaced and drags itself along the
  // floor; the Spitter keeps the default.
  if (type === 'BEAST') return 'heavy';
  return 'stone';
}

/** Fire a one-shot sound effect. No-op when disabled or not yet unlocked. */
export function playSfx(name: SfxName, opts: CueOptions = {}): void {
  if (!prefs.sfx) return;
  if (!ensure()) return;
  const { pan } = opts;
  // Combat hits ring off the stone; UI clicks stay dry and close.
  const room = opts.reverb ?? 0.25;

  switch (name) {
    case 'select':
      tone({ type: 'triangle', from: 660, to: 880, dur: 0.07, gain: 0.18, pan });
      break;
    case 'move':
      tone({ type: 'triangle', from: 420, to: 240, dur: 0.14, gain: 0.16, pan, reverb: room });
      noise({ dur: 0.1, gain: 0.05, cutoff: 900, pan, reverb: room });
      break;
    case 'attack':
      tone({ type: 'sawtooth', from: 300, to: 120, dur: 0.16, gain: 0.2, pan, reverb: room });
      noise({ dur: 0.12, gain: 0.12, cutoff: 2600, pan, reverb: room });
      break;
    case 'hit':
      noise({ dur: 0.22, gain: 0.3, cutoff: 1200, pan, reverb: 0.35 });
      tone({ type: 'sine', from: 150, to: 60, dur: 0.22, gain: 0.28, pan, reverb: 0.35 });
      break;
    case 'heal':
      tone({ type: 'sine', from: 520, to: 780, dur: 0.28, gain: 0.18, pan, reverb: 0.45 });
      tone({ type: 'sine', from: 780, to: 1040, dur: 0.24, gain: 0.1, delay: 0.1, pan, reverb: 0.45 });
      break;
    case 'unitDefeated':
      tone({ type: 'sawtooth', from: 240, to: 70, dur: 0.4, gain: 0.22, pan, reverb: 0.5 });
      noise({ dur: 0.3, gain: 0.14, cutoff: 700, pan, reverb: 0.5 });
      break;
    case 'invalid':
      tone({ type: 'square', from: 150, to: 110, dur: 0.18, gain: 0.14 });
      break;
    case 'turnStart':
      tone({ type: 'triangle', from: 523, dur: 0.16, gain: 0.16, reverb: 0.4 });
      tone({ type: 'triangle', from: 784, dur: 0.22, gain: 0.14, delay: 0.12, reverb: 0.4 });
      break;
    case 'spell':
      playSpell('fireball', opts);
      break;
    case 'victory':
      [523, 659, 784, 1047].forEach((f, i) =>
        tone({ type: 'triangle', from: f, dur: 0.3, gain: 0.16, delay: i * 0.12, reverb: 0.5 }),
      );
      break;
    case 'defeat':
      [392, 330, 262, 196].forEach((f, i) =>
        tone({ type: 'sine', from: f, dur: 0.42, gain: 0.16, delay: i * 0.16, reverb: 0.5 }),
      );
      break;
    case 'soulHarvest':
      // A soul torn loose: a rising cry dragged out of a low stone thud.
      tone({ type: 'sine', from: 160, to: 540, dur: 0.5, gain: 0.13, pan, reverb: 0.5 });
      noise({ dur: 0.3, gain: 0.07, cutoff: 1_200, pan, reverb: 0.5 });
      break;
    case 'altarWish':
      // The altar takes its price: a low swell into a bright, wrong-sounding chord.
      tone({ type: 'sawtooth', from: 96, to: 58, dur: 0.55, gain: 0.2, pan, reverb: 0.6 });
      [392, 587].forEach((f, i) =>
        tone({
          type: 'triangle',
          from: f,
          to: f * 1.5,
          dur: 0.5,
          gain: 0.12,
          delay: 0.2 + i * 0.12,
          pan,
          reverb: 0.6,
        }),
      );
      break;
    default:
      break;
  }
}

// ── looping music ───────────────────────────────────────────────────────────

const rampGain = (gain: GainNode, value: number, seconds = MUSIC_FADE_SECONDS) => {
  if (!ctx) return;
  const t = ctx.currentTime;
  gain.gain.cancelScheduledValues(t);
  gain.gain.setValueAtTime(gain.gain.value, t);
  gain.gain.linearRampToValueAtTime(value, t + seconds);
};

const loadMusicBuffer = (track: MusicTrack): Promise<AudioBuffer | null> => {
  const cached = musicBuffers.get(track);
  if (cached) return cached;
  const audio = ensure();
  if (!audio) return Promise.resolve(null);

  const pending = fetch(MUSIC_TRACK_URLS[track])
    .then((response) => {
      if (!response.ok) throw new Error(`Music request failed: ${response.status}`);
      return response.arrayBuffer();
    })
    .then((bytes) => audio.decodeAudioData(bytes))
    .catch(() => {
      musicBuffers.delete(track);
      return null;
    });
  musicBuffers.set(track, pending);
  return pending;
};

const retirePlayback = (playback: MusicPlayback, stopAt: number) => {
  playback.source.onended = () => {
    playback.source.disconnect();
    playback.gain.disconnect();
  };
  try {
    playback.source.stop(stopAt);
  } catch {
    /* Already stopped by a newer track request. */
  }
};

/** Choose the loop for this screen. It records intent even if music is muted. */
export function setMusicTrack(track: MusicTrack | null): void {
  requestedMusic = track;
  const request = ++musicRequest;

  if (!track) {
    if (!ctx || !musicBus) return;
    const previous = activeMusic;
    activeMusic = null;
    const audio = ctx;
    rampGain(musicBus, 0);
    if (previous) {
      rampGain(previous.gain, 0);
      retirePlayback(previous, audio.currentTime + MUSIC_FADE_SECONDS + 0.05);
    }
    return;
  }

  if (!prefs.music) {
    if (musicBus) rampGain(musicBus, 0);
    return;
  }

  const audio = ensure();
  if (!audio || !musicBus) return;

  rampGain(musicBus, musicGain());
  if (activeMusic?.track === track) {
    rampGain(activeMusic.gain, 1);
    return;
  }

  void loadMusicBuffer(track).then((buffer) => {
    if (
      !buffer ||
      request !== musicRequest ||
      requestedMusic !== track ||
      !prefs.music ||
      !ctx ||
      !musicBus
    ) return;

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    source.connect(gain);
    gain.connect(musicBus);

    const previous = activeMusic;
    const playback = { track, source, gain };
    activeMusic = playback;
    const startAt = ctx.currentTime;
    source.start(startAt);
    rampGain(gain, 1);
    if (previous) {
      rampGain(previous.gain, 0);
      retirePlayback(previous, startAt + MUSIC_FADE_SECONDS + 0.05);
    }
  });
}

/** Toggle only background music; sound effects remain independently controlled. */
export function setMusicEnabled(enabled: boolean): void {
  prefs = { ...prefs, music: enabled };
  persist();
  if (!musicBus) ensure();
  if (!musicBus) return;
  rampGain(musicBus, musicGain());
  if (enabled && requestedMusic) setMusicTrack(requestedMusic);
}

export function setSfxEnabled(enabled: boolean): void {
  prefs = { ...prefs, sfx: enabled };
  persist();
  if (!sfxBus) ensure();
  if (sfxBus) rampGain(sfxBus, sfxGain(), 0.12);
}

export function setSfxVolume(volume: number): void {
  prefs = { ...prefs, sfxVolume: clampVolume(volume, DEFAULT_AUDIO_PREFS.sfxVolume) };
  persist();
  if (!sfxBus) ensure();
  if (sfxBus) rampGain(sfxBus, sfxGain(), 0.08);
}

export function setMusicVolume(volume: number): void {
  prefs = { ...prefs, musicVolume: clampVolume(volume, DEFAULT_AUDIO_PREFS.musicVolume) };
  persist();
  if (!musicBus) ensure();
  if (musicBus) rampGain(musicBus, musicGain(), 0.08);
}

function persist(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* private mode — preference simply does not persist */
  }
}

export function getAudioPrefs(): AudioPrefs {
  return { ...prefs };
}

/** Re-apply stored prefs once audio is unlocked by a gesture. */
export function restoreAudio(): void {
  if (prefs.music && requestedMusic) setMusicTrack(requestedMusic);
}

/** Stop everything (used when leaving the game). */
export function stopAudio(): void {
  // Leaving the game fades music without changing the saved mute preference.
  setMusicTrack(null);
}
import { publicAsset } from '../../utils/publicAsset';
