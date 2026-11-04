import { Vector3, type Camera } from 'three';
import type { Body } from '@drawcall/animate';
import type { Movement } from './movement';

const FILES = {
  'step-a': 'step-a.ogg', 'step-b': 'step-b.ogg',
  jump: 'jump.mp3', land: 'land.mp3', shot: 'shot.mp3',
  reload: 'reload.mp3', cloth: 'cloth.mp3', lift: 'lift.mp3', ambient: 'ambient.ogg',
  rung: 'rung.mp3', clank: 'clank.mp3', thud: 'thud.mp3', boot: 'boot.mp3', clunk: 'clunk.mp3', lever: 'lever.mp3', skid: 'skid.mp3',
};

export type Sound = keyof typeof FILES;
type Feet = Pick<Body, 'feet'>;
type Motion = Pick<Movement, 'grounded' | 'actualVelocity'>;
export type Play = (sound: Sound, gain: number, offset?: number, duration?: number) => void;

/** Sound follows solved foot contacts; intent to move alone makes no footsteps. */
export class Contacts {
  private feet: boolean[] = [];
  private speeds: number[] = [];
  private grounded: boolean | undefined;
  private falling = 0;
  private landing: number | undefined;

  constructor(private readonly play: Play) {}

  reset(body: Feet, motion: Motion) {
    this.feet = body.feet.map((foot) => foot.planted);
    this.speeds = this.feet.map(() => 0);
    this.grounded = motion.grounded;
    this.falling = 0;
    this.landing = undefined;
  }

  update(body: Feet, motion: Motion) {
    if (this.grounded === undefined) { this.reset(body, motion); return; }
    const feet = body.feet.map((foot) => foot.planted), velocity = motion.actualVelocity;
    const speed = Math.hypot(velocity.x, velocity.z);
    feet.forEach((planted, i) => { if (!planted) this.speeds[i] = Math.max(this.speeds[i] ?? 0, speed); });
    if (this.grounded && !motion.grounded) {
      this.falling = 0;
      this.landing = undefined;
      if (velocity.y > 0) this.play('jump', 0.16);
    }
    if (!motion.grounded) this.falling = Math.max(this.falling, -velocity.y);
    if (!this.grounded && motion.grounded) this.landing = this.falling;
    const contacts = feet.flatMap((planted, i) => planted && !this.feet[i] ? [i] : []);
    if (motion.grounded && contacts.length) {
      if (this.landing !== undefined) {
        if (this.landing > 0) this.play('land', Math.min(0.65, 0.12 + this.landing * 0.06));
        this.landing = undefined;
      } else {
        for (const i of contacts) if (this.speeds[i] > 0.1)
          this.play(i === 0 ? 'step-a' : 'step-b', Math.min(0.32, 0.12 + this.speeds[i] * 0.04));
      }
    }
    for (const i of contacts) this.speeds[i] = 0;
    this.feet = feet;
    this.grounded = motion.grounded;
  }
}

export class Audio {
  /** where every sound goes, to the speakers */
  readonly output: GainNode;
  private readonly ambient: AudioBufferSourceNode;
  private readonly motor: AudioBufferSourceNode;
  private readonly motorGain: GainNode;
  private readonly motorPosition: PannerNode;
  private readonly position = new Vector3();
  private readonly forward = new Vector3();
  private readonly up = new Vector3();

  private constructor(readonly context: AudioContext, private readonly buffers: ReadonlyMap<string, AudioBuffer>) {
    this.output = context.createGain();
    this.output.gain.value = 0.63;
    this.output.connect(context.destination);
    this.ambient = this.source('ambient');
    this.ambient.loop = true;
    this.ambient.loopStart = 0.5;
    this.ambient.loopEnd = 20.5;
    const breeze = context.createGain();
    breeze.gain.value = 0.12;
    this.ambient.connect(breeze).connect(this.output);
    this.ambient.start(0, this.ambient.loopStart);
    this.motor = this.source('lift');
    this.motor.loop = true;
    this.motor.loopStart = 0.2;
    this.motor.loopEnd = 4.6;
    this.motorGain = context.createGain();
    this.motorGain.gain.value = 0;
    this.motorPosition = context.createPanner();
    this.motorPosition.panningModel = 'HRTF';
    this.motorPosition.refDistance = 3;
    this.motorPosition.maxDistance = 35;
    this.motorPosition.rolloffFactor = 1.3;
    this.motor.connect(this.motorGain).connect(this.motorPosition).connect(this.output);
    this.motor.start();
  }

  static async load(): Promise<Audio> {
    const context = new AudioContext();
    try {
      const buffers = await Promise.all(Object.entries(FILES).map(async ([name, file]) => {
        const response = await fetch(`/audio/${file}`);
        if (!response.ok) throw new Error(`Could not load ${file}: ${response.status}`);
        const buffer = await context.decodeAudioData(await response.arrayBuffer());
        return { name, buffer };
      }));
      return new Audio(context, new Map(buffers.map(({ name, buffer }) => [name, buffer])));
    } catch (error) {
      await context.close();
      throw error;
    }
  }

  resume() { return this.context.resume(); }
  pause() { return this.context.suspend(); }

  play(sound: Sound, volume: number, offset = 0, duration?: number, position?: Readonly<Vector3>) {
    if (this.context.state !== 'running') return;
    // (no two alike: each a little higher or lower and louder or softer)
    const source = this.source(sound), gain = this.context.createGain();
    source.playbackRate.value = 1 + 0.08 * (Math.random() - 0.5);
    gain.gain.value = volume * (0.9 + 0.2 * Math.random());
    const panner = position ? this.context.createPanner() : undefined;
    if (panner && position) {
      panner.panningModel = 'HRTF';
      panner.refDistance = 4;
      panner.maxDistance = 50;
      panner.positionX.value = position.x;
      panner.positionY.value = position.y;
      panner.positionZ.value = position.z;
      source.connect(gain).connect(panner).connect(this.output);
    } else source.connect(gain).connect(this.output);
    source.onended = () => { source.disconnect(); gain.disconnect(); panner?.disconnect(); };
    source.start(0, offset, duration);
  }

  listen(camera: Camera) {
    camera.getWorldPosition(this.position);
    camera.getWorldDirection(this.forward);
    this.up.setFromMatrixColumn(camera.matrixWorld, 1).normalize();
    const listener = this.context.listener;
    listener.positionX.value = this.position.x;
    listener.positionY.value = this.position.y;
    listener.positionZ.value = this.position.z;
    listener.forwardX.value = this.forward.x;
    listener.forwardY.value = this.forward.y;
    listener.forwardZ.value = this.forward.z;
    listener.upX.value = this.up.x;
    listener.upY.value = this.up.y;
    listener.upZ.value = this.up.z;
  }

  /** A short synthesized hit-marker tick. */
  tick() {
    if (this.context.state !== 'running') return;
    const now = this.context.currentTime, tone = this.context.createOscillator(), gain = this.context.createGain();
    tone.frequency.value = 1400;
    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.03);
    tone.connect(gain).connect(this.output);
    tone.onended = () => { tone.disconnect(); gain.disconnect(); };
    tone.start(now);
    tone.stop(now + 0.03);
  }

  lift(position: Readonly<Vector3>, speed: number) {
    this.motorPosition.positionX.value = position.x;
    this.motorPosition.positionY.value = position.y;
    this.motorPosition.positionZ.value = position.z;
    this.motorGain.gain.setTargetAtTime(Math.min(0.14, Math.abs(speed) * 0.08), this.context.currentTime, 0.08);
  }

  dispose() { this.ambient.stop(); this.motor.stop(); return this.context.close(); }

  buffer(sound: Sound): AudioBuffer {
    const buffer = this.buffers.get(sound);
    if (!buffer) throw new Error(`Sound ${sound} was not loaded`);
    return buffer;
  }

  private source(sound: Sound): AudioBufferSourceNode {
    const source = this.context.createBufferSource();
    source.buffer = this.buffer(sound);
    return source;
  }
}
