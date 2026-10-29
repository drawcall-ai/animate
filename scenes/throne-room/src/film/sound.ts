import { Audio, AudioListener, AudioLoader, Object3D, PositionalAudio, Vector3 } from 'three';

// The film's sound: clips played at story time, each from where it happens (three.js positional audio heard by a listener on the story
// camera) or everywhere (the music and the hall's air). Headless, or before the viewer's first click (browsers start audio only after
// one), nothing plays, but every cue is still logged with its story time, so its sync with the motion can be checked.
//
// The files (public/audio) are web-sized mp3s:
// - march: "heroic orchestral fantasy score" (Drawcall Market heroic-orchestral-fantasy-score@1.0.1), trimmed to the film and faded;
// - doors, steps, roar: market clips (stone-cache-lid-open-grind, heavy-gate-swing, heavy-stone-grit-landing; stone-footstep,
//   marble-footstep-dry-stone-tap, basalt-footfall; beast-angry-growl) slowed, pitched and given the hall's reverb;
// - threepio: generated speech ("Oh! Oh my!"), combed to sound tinny;
// - r2-*, crowd, hall: synthesized (chirp chains, a few hundred clapping hands with market crowd cheers, low wind and room tone).

export const CLIPS = {
  march: 'march.mp3',
  hall: 'hall.mp3',
  doors: 'doors.mp3',
  step1: 'step-1.mp3',
  step2: 'step-2.mp3',
  step3: 'step-3.mp3',
  r2Cheer1: 'r2-cheer-1.mp3',
  r2Cheer2: 'r2-cheer-2.mp3',
  r2Whistle: 'r2-whistle.mp3',
  r2Chatter: 'r2-chatter.mp3',
  roar: 'roar.mp3',
  threepio: 'threepio.mp3',
  crowd: 'crowd.mp3',
} as const;
export type Clip = keyof typeof CLIPS;

export interface PlayOptions {
  /** where it sounds from: an object it follows (a bone), or a point; none: everywhere, not positional */
  from?: Object3D | Vector3;
  /** gain (1: as recorded) */
  volume?: number;
  /** playback rate: pitch and speed together */
  rate?: number;
  loop?: boolean;
  /** distance (m) within which it is heard at full volume; it falls off as refDistance / distance beyond */
  near?: number;
  /** a label for the cue log (what made the sound) */
  why?: string;
}

/** a clip asked for: when (s of story time), which, why */
export interface Cue {
  time: number;
  clip: Clip;
  why?: string;
}

/** a playing clip: everywhere, or from a place */
type Voice = Audio<GainNode> | PositionalAudio;

const LONG = new Set<Clip>(['march', 'hall', 'crowd']);

export class Sound {
  /** every clip asked for since the last reset, at its story time (logged headless too) */
  readonly cues: Cue[] = [];
  /** story seconds since the last reset */
  time = 0;
  /** where point sources are put (the playing beat's scene) */
  private room?: Object3D;
  private listener?: AudioListener;
  private readonly buffers = new Map<Clip, AudioBuffer>();
  private readonly voices = new Set<Voice>();
  private muted = false;
  /** long clips asked for while silent (muted or not yet connected): started part-way in once sound is on */
  private missed: { clip: Clip; options: PlayOptions; at: number }[] = [];

  /** starts sound through `listener` (create it on a user's click): loads every clip, then plays what is asked from now on */
  async connect(listener: AudioListener): Promise<void> {
    this.listener = listener;
    const loader = new AudioLoader();
    await Promise.all((Object.keys(CLIPS) as Clip[]).map(async (clip) => this.buffers.set(clip, await loader.loadAsync(`/audio/${CLIPS[clip]}`))));
    if (listener.context.state === 'suspended') await listener.context.resume();
    this.catchUp();
  }

  get connected(): boolean {
    return this.buffers.size > 0;
  }

  /** forgets every cue and stops every voice: a new story starts at time 0 in `room` */
  reset(room?: Object3D): void {
    for (const voice of this.voices) this.end(voice);
    this.cues.length = 0;
    this.missed = [];
    this.time = 0;
    this.room = room;
  }

  advance(seconds: number): void {
    this.time += seconds;
  }

  /** silent while true (a seek plays the story faster than real time); on unmuting, the long clips asked for meanwhile join part-way in */
  setMuted(muted: boolean): void {
    this.muted = muted;
    if (!muted) this.catchUp();
  }

  /** pauses or resumes everything playing (the viewer's pause) */
  setPaused(paused: boolean): void {
    const context = this.listener?.context;
    if (!context) return;
    if (paused) void context.suspend();
    else void context.resume();
  }

  /** plays `clip` now (story time), logged as a cue; silent headless or muted */
  play(clip: Clip, options: PlayOptions = {}): void {
    this.cues.push({ time: this.time, clip, why: options.why });
    if (this.muted || !this.connected) {
      if (LONG.has(clip)) this.missed.push({ clip, options, at: this.time });
      return;
    }
    this.start(clip, options, 0);
  }

  /** fades every voice playing `clip` to silence over `seconds` (the music at the end) */
  fade(clip: Clip, seconds: number): void {
    this.cues.push({ time: this.time, clip, why: `fade out over ${seconds} s` });
    this.missed = this.missed.filter((each) => each.clip !== clip);
    for (const voice of this.voices) {
      if (voice.userData.clip !== clip) continue;
      const gain = voice.gain.gain, now = voice.context.currentTime;
      gain.setValueAtTime(gain.value, now);
      gain.linearRampToValueAtTime(0, now + seconds);
      setTimeout(() => this.end(voice), seconds * 1000 + 50);
    }
  }

  private catchUp() {
    if (this.muted || !this.connected) return;
    for (const { clip, options, at } of this.missed) {
      const buffer = this.buffers.get(clip)!;
      const offset = this.time - at;
      if (options.loop || offset < buffer.duration / (options.rate ?? 1)) this.start(clip, options, offset);
    }
    this.missed = [];
  }

  private start(clip: Clip, { from, volume = 1, rate = 1, loop = false, near = 3 }: PlayOptions, offset: number) {
    const listener = this.listener!, buffer = this.buffers.get(clip)!;
    let voice: Voice;
    if (from) {
      const positional = new PositionalAudio(listener);
      positional.setRefDistance(near);
      positional.setRolloffFactor(1.2);
      const holder = from instanceof Vector3 ? Object.assign(new Object3D(), { name: `sound ${clip}` }) : from;
      if (from instanceof Vector3) {
        holder.position.copy(from);
        (this.room ?? listener.parent)?.add(holder);
        positional.userData.holder = holder;
      }
      holder.add(positional);
      positional.updateMatrixWorld(true);
      voice = positional;
    } else {
      voice = new Audio<GainNode>(listener);
    }
    voice.userData.clip = clip;
    voice.setBuffer(buffer);
    voice.setLoop(loop);
    voice.setVolume(volume);
    voice.setPlaybackRate(rate);
    voice.offset = loop ? offset % buffer.duration : offset;
    voice.onEnded = () => this.end(voice);
    voice.play();
    this.voices.add(voice);
  }

  private end(voice: Voice) {
    if (!this.voices.delete(voice)) return;
    if (voice.isPlaying) voice.stop();
    voice.disconnect();
    (voice.userData.holder as Object3D | undefined)?.removeFromParent();
    voice.removeFromParent();
  }
}
