import { MathUtils, Vector3 } from 'three';
import type { Audio } from '../audio';
import type { Engine } from './engine';
import type { Handling } from './handling';
import type { Rover } from './model';

/** The engine speed (rpm) the firing pulses are laid down at, how many engine cycles (two turns each) they run before repeating. */
const REFERENCE = 1000;
const CYCLES = 16;
/** Each cylinder's share of a firing's strength: no two burn quite alike, which gives a diesel its lumpy beat. */
const CYLINDERS = [1, 0.88, 0.96, 0.84];
/** How fast each level follows what it is set to (s). */
const GLIDE = 0.05;

/** The layers mixed into the rover's sound. */
type Layer = 'thump' | 'valves' | 'knock' | 'block' | 'starter' | 'fan' | 'whine' | 'roll' | 'grit' | 'skid' | 'rattle' | 'wind';

/**
 * The rover heard: its four-cylinder diesel built from its firing pulses (a thump through the exhaust for each, the injection's knock
 * above it, the valvetrain's tick between) over the block's rumble and the fan and belts, sped up and slowed with the engine and
 * louder and brighter revved and with its load; the starter turning it over after its solenoid's click, and the shudder as it stops; the
 * gears' whine, the straight-cut reverse loudest; the tyres rolling and sliding, the body rattling over bumps and the wind through the open
 * cab; and the clunk of each gear change, each bump and the handbrake's ratchet.
 */
export class RoverSound {
  private readonly firing: AudioBufferSourceNode;
  private readonly exhaust: BiquadFilterNode;
  private readonly levels: Record<Layer, GainNode>;
  private readonly sources: AudioScheduledSourceNode[] = [];
  private readonly starter: OscillatorNode;
  private readonly labour: OscillatorNode;
  private readonly whine: OscillatorNode;
  private readonly skid: AudioBufferSourceNode;
  private readonly engine: PannerNode;
  private readonly chassis: PannerNode;
  private readonly at = new Vector3();
  /** what was heard last: the engine's state and gear, the handbrake, when the last bump was (s) */
  private state: Engine['state'] = 'off';
  private gear = 1;
  private handbrake = true;
  private bumped = 0;
  /** the engine stopped and not yet run down: its last shudder still to come */
  private stopping = false;

  constructor(private readonly audio: Audio, private readonly rover: Rover, private readonly handling: Handling) {
    const context = audio.context;
    this.engine = this.panner(2.5);
    this.chassis = this.panner(3);
    const level = (into: AudioNode) => {
      const gain = context.createGain();
      gain.gain.value = 0;
      gain.connect(into);
      return gain;
    };
    this.levels = {
      thump: level(this.engine), valves: level(this.engine), knock: level(this.engine), block: level(this.engine), starter: level(this.engine),
      fan: level(this.engine), whine: level(this.chassis), roll: level(this.chassis), grit: level(this.chassis), skid: level(this.chassis),
      rattle: level(this.chassis), wind: level(this.chassis),
    };

    // The firing pulses, the thump on one channel and the knock on the other, in step, through the exhaust and above it.
    this.firing = this.loop(firings(context));
    const split = context.createChannelSplitter(2);
    this.firing.connect(split);
    this.exhaust = filter(context, 'lowpass', 300, 0.9);
    const body = filter(context, 'peaking', 95, 1);
    body.gain.value = 7;
    // (each pulse pushes one way: the exhaust passes no steady flow)
    split.connect(filter(context, 'highpass', 35, 0.7), 0).connect(this.exhaust).connect(body).connect(this.levels.thump);
    // (with each firing the valvetrain ticks in the midrange, and the injection clatters above it)
    split.connect(filter(context, 'bandpass', 700, 1), 1).connect(this.levels.valves);
    split.connect(filter(context, 'bandpass', 2000, 0.8), 1).connect(this.levels.knock);

    // The starter's whine, labouring with each compression it turns the engine through.
    this.starter = context.createOscillator();
    this.starter.type = 'sawtooth';
    this.starter.frequency.value = 150;
    this.labour = context.createOscillator();
    const depth = context.createGain();
    depth.gain.value = 35;
    this.labour.connect(depth).connect(this.starter.frequency);
    this.starter.connect(filter(context, 'bandpass', 900, 1.5)).connect(this.levels.starter);
    this.whine = context.createOscillator();
    this.whine.type = 'triangle';
    this.whine.connect(this.levels.whine);
    this.sources.push(this.starter, this.labour, this.whine);

    // Noise for the block's rumble between firings, the fan and belts, the tyres' roar and the grit under them, the body's rattle and the
    // wind through the open cab.
    const noise = noiseBuffer(context);
    this.loop(noise).connect(filter(context, 'lowpass', 220, 0.7)).connect(this.levels.block);
    this.loop(noise).connect(filter(context, 'bandpass', 1500, 1.2)).connect(this.levels.fan);
    this.loop(noise).connect(filter(context, 'bandpass', 320, 0.7)).connect(this.levels.roll);
    this.loop(noise).connect(filter(context, 'highpass', 2600, 0.7)).connect(this.levels.grit);
    this.loop(noise).connect(filter(context, 'bandpass', 3000, 1)).connect(this.levels.rattle);
    this.loop(noise).connect(filter(context, 'lowpass', 700, 0.7)).connect(this.levels.wind);
    this.skid = this.loop(audio.buffer('skid'));
    this.skid.loopStart = 0.05;
    this.skid.loopEnd = 0.7;
    this.skid.connect(this.levels.skid);
    for (const source of this.sources) source.start();
  }

  /** Follows the rover and its engine; once a rendered frame. */
  update() {
    const { engine, speed, slip, input } = this.handling, jolt = this.handling.jolted(), now = this.audio.context.currentTime;
    const set = (param: AudioParam, value: number) => param.setTargetAtTime(value, now, GLIDE);
    this.place(this.engine, this.rover.marks.engine);
    this.place(this.chassis, this.rover.body);

    const running = engine.running, cranking = engine.state === 'cranking', load = engine.load, rpm = engine.rpm, rolling = Math.abs(speed);
    const turning = MathUtils.clamp(rpm / 400, 0, 1);
    set(this.firing.playbackRate, Math.max(0.05, rpm / REFERENCE));
    // (two compressions a turn)
    set(this.labour.frequency, rpm / 30);
    set(this.exhaust.frequency, running ? 220 + 1100 * load + 0.12 * rpm : 160);
    // (louder revved; the starter turning it over, compression alone thumps; stopped, it runs down quietly)
    const revved = 0.75 + 0.25 * rpm / 1000;
    set(this.levels.thump.gain, turning * (running ? (0.13 + 0.07 * load) * revved : cranking ? 0.6 : 0.06));
    set(this.levels.valves.gain, running ? 0.5 - 0.1 * rpm / 3000 + 0.1 * load : 0);
    set(this.levels.knock.gain, running ? 0.25 - 0.06 * rpm / 3000 + 0.1 * load : 0);
    set(this.levels.block.gain, running ? (0.05 + 0.04 * load) * revved : 0);
    set(this.levels.fan.gain, running ? 0.012 * rpm / 1000 : 0);
    set(this.levels.starter.gain, cranking ? 0.2 : 0);
    // (the gears whine with the road speed: the straight-cut reverse loudest)
    const reversing = running && engine.gear < 0;
    set(this.whine.frequency, 40 + rolling * (reversing ? 230 : 120));
    set(this.levels.whine.gain, running ? reversing ? 0.025 * Math.min(1, rolling / 1.5) : Math.min(0.01, rolling * 0.0008) : 0);
    set(this.levels.roll.gain, Math.min(0.2, rolling * 0.016));
    set(this.levels.grit.gain, Math.min(0.03, rolling * 0.0025));
    set(this.levels.wind.gain, Math.min(0.12, 0.0003 * rolling * rolling));
    set(this.levels.rattle.gain, jolt > 0.4 ? 0.05 * Math.min(1, jolt / 1.5) : 0);
    set(this.levels.skid.gain, 0.4 * MathUtils.smoothstep(slip, 0.8, 4));
    set(this.skid.playbackRate, MathUtils.clamp(0.9 + 0.04 * slip, 0.9, 1.2));

    const engineAt = this.rover.marks.engine.getWorldPosition(this.at), chassisAt = this.rover.body.position;
    // (the starter's solenoid clicks in; stopped, the engine shudders to rest)
    if (cranking && this.state === 'off') this.audio.play('clunk', 0.08, 0, 0.06, engineAt);
    // (not one stopped dead, reset)
    if (engine.state === 'off' && this.state !== 'off' && rpm > 150) this.stopping = true;
    if (this.stopping && rpm < 150) {
      this.audio.play('thud', 0.08, 0.24, 0.4, engineAt);
      this.stopping = false;
    }
    this.state = engine.state;
    if (engine.gear !== this.gear && running) this.audio.play('clunk', 0.14, 0, 0.35, engineAt);
    this.gear = engine.gear;
    if (input.handbrake !== this.handbrake) {
      if (input.handbrake) this.audio.play('lever', 0.12, 0.1, 0.5, chassisAt);
      else this.audio.play('lever', 0.1, 0.13, 0.2, chassisAt);
    }
    this.handbrake = input.handbrake;
    if (jolt > 1.2 && now - this.bumped > 0.25) {
      this.audio.play('thud', Math.min(0.45, (jolt - 1) * 0.18), 0.24, 0.8, chassisAt);
      this.bumped = now;
    }
  }

  dispose() {
    for (const source of this.sources) source.stop();
    this.engine.disconnect();
    this.chassis.disconnect();
  }

  private panner(distance: number) {
    const panner = this.audio.context.createPanner();
    Object.assign(panner, { panningModel: 'HRTF', refDistance: distance, maxDistance: 60, rolloffFactor: 1.2 });
    panner.connect(this.audio.output);
    return panner;
  }

  private loop(buffer: AudioBuffer) {
    const source = this.audio.context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    this.sources.push(source);
    return source;
  }

  private place(panner: PannerNode, at: { getWorldPosition(target: Vector3): Vector3 }) {
    const { x, y, z } = at.getWorldPosition(this.at), now = this.audio.context.currentTime;
    panner.positionX.setTargetAtTime(x, now, 0.02);
    panner.positionY.setTargetAtTime(y, now, 0.02);
    panner.positionZ.setTargetAtTime(z, now, 0.02);
  }
}

function filter(context: BaseAudioContext, type: BiquadFilterType, frequency: number, q: number) {
  const node = context.createBiquadFilter();
  node.type = type;
  node.frequency.value = frequency;
  node.Q.value = q;
  return node;
}

/**
 * `CYCLES` engine cycles of a four-cylinder four-stroke at `REFERENCE` rpm, a firing every half turn: on the left channel each firing's
 * pressure pulse, on the right the knock of its injection, each cylinder burning a little unlike the others and no two firings quite
 * alike or quite on time.
 */
function firings(context: BaseAudioContext) {
  const rate = context.sampleRate, interval = 30 / REFERENCE, length = Math.round(CYCLES * 4 * interval * rate);
  const buffer = context.createBuffer(2, length, rate), thump = buffer.getChannelData(0), knock = buffer.getChannelData(1);
  // (a fixed seed, so the engine sounds the same each time)
  let seed = 7;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let firing = 0; firing < CYCLES * 4; firing++) {
    const start = Math.round((firing + 0.06 * (random() - 0.5)) * interval * rate);
    const strength = CYLINDERS[firing % 4] * (0.9 + 0.2 * random());
    // (the pressure rings on down the pipe for most of the half turn, so the firings run together into a rumble rather than pops)
    for (let i = 0; i < Math.round(0.04 * rate); i++) {
      const t = i / rate, at = (start + i) % length;
      thump[at] += strength * (Math.exp(-t / 0.014) - Math.exp(-t / 0.001)) * (1 + 0.5 * Math.sin(2 * Math.PI * 70 * t));
      knock[at] += strength * (2 * random() - 1) * Math.exp(-t / 0.0015);
    }
  }
  return buffer;
}

function noiseBuffer(context: BaseAudioContext) {
  const buffer = context.createBuffer(1, 2 * context.sampleRate, context.sampleRate), data = buffer.getChannelData(0);
  let seed = 11;
  for (let i = 0; i < data.length; i++) data[i] = 2 * (seed = (seed * 16807) % 2147483647) / 2147483647 - 1;
  return buffer;
}
