import { MathUtils, Quaternion, Vector3 } from 'three';
import type { Humanoid, Proportions } from '@prohuman/core';
import type { Effector, Part, Scenario } from '../scenario';
import { jointOf } from '../joints';
import { quatYXZ, vec, wrapAngle } from '../math';
import { bend, Boarding, footRotation, handRotation, onBall, Travel } from './ride';

const { smoothstep } = MathUtils;

/**
 * A horse of ~1.6 m at the withers (m, scaled with the rider), in its frame: the origin on
 * the ground under the saddle, +z ahead, +x to the left. The saddle's seat (its lowest point,
 * where the rider sits); the stirrups' treads (out from the middle, ahead of the seat, under
 * it); the hands holding the reins (ahead of and over the seat, apart).
 */
const HORSE = { seat: 1.42, stirrup: { out: 0.29, ahead: 0.06, below: 0.6 }, hands: { ahead: 0.32, over: 0.2, apart: 0.07 } };

/**
 * The gaits by their speed (m/s), stride rate (Hz) and the saddle's motion through a stride:
 * its rise and fall (m: walk ±1.5 cm twice a stride; trot ~9 cm peak to peak twice a stride,
 * the diagonal beats; canter ~10 cm once a stride), its rocking (rad: the canter's
 * rocking-horse pitch), its fore-aft surge (m), its sway side to side (m) (Buchner 1996;
 * Pfau 2009).
 */
const GAITS = {
  walk: { speed: 1.6, rate: 0.95, beats: 2, rise: 0.015, pitch: 0.02, surge: 0.02, sway: 0.025 },
  trot: { speed: 3.6, rate: 1.4, beats: 2, rise: 0.045, pitch: 0.02, surge: 0.02, sway: 0.01 },
  canter: { speed: 6, rate: 1.75, beats: 1, rise: 0.05, pitch: 0.09, surge: 0.012, sway: 0.01 },
} as const;
type Gait = keyof typeof GAITS;
/** the script: when each gait takes over (s), easing in for a second; a wide turn (along the way, m) */
const SCRIPT: readonly (readonly [number, Gait])[] = [
  [0, 'walk'],
  [4, 'trot'],
  [10, 'canter'],
];
const TURN = { from: 30, to: 55, radius: 15, ramp: 6 };

/** the gait blend at `t`: each gait's share */
function blendAt(t: number): Record<Gait, number> {
  const out = { walk: 0, trot: 0, canter: 0 };
  let k = 1;
  for (let i = SCRIPT.length - 1; i >= 0; i--) {
    const [at, gait] = SCRIPT[i];
    const w = i === 0 ? 1 : smoothstep(t, at, at + 1);
    out[gait] += k * w;
    k *= 1 - w;
  }
  return out;
}

/** a horse fitted to its rider: its saddle's seat, the stirrups and reins */
class Horse {
  readonly s: number;

  constructor(readonly p: Proportions) {
    this.s = p.scale;
  }

  m(x: number, y: number, z: number, out = new Vector3()) {
    return out.set(x, y, z).multiplyScalar(this.s);
  }

  /** the ankle on a stirrup's tread (the ball of the foot on it, the heel down), and the foot's rotation */
  foot(side: number, out: Vector3, rot: Quaternion) {
    const { stirrup } = HORSE;
    footRotation(new Quaternion(), side * 0.15, 0.25, rot);
    const ball = this.p.offsets.leftToes;
    return this.m(side * stirrup.out, HORSE.seat - stirrup.below, stirrup.ahead, out).add(_v.set(0, -ball.y, -ball.z).applyQuaternion(rot));
  }

  /** a hand on the reins (thumbs up, the fingers closed round them, the palms facing in), and its rotation */
  hand(side: number, out: Vector3, rot: Quaternion) {
    const { hands } = HORSE;
    handRotation(vec(-side * 0.3, -0.5, 1), vec(-side, 0.1, 0.2), side, rot);
    return this.m(side * hands.apart, HORSE.seat + hands.over, hands.ahead, out);
  }

  /** its parts at stride phase `phase` (0..1) of `gait` blend (the legs swing, the head nods) */
  parts(phase: number, mix: Record<Gait, number>, hands: readonly Vector3[]): Part[] {
    const m = (x: number, y: number, z: number) => this.m(x, y, z);
    const rod = (from: Vector3, to: Vector3, radius: number): Part & { kind: 'rod' } => ({ kind: 'rod', from, to, radius: radius * this.s });
    const y = HORSE.seat;
    const withers = m(0, y + 0.08, 0.62);
    const poll = m(0, y + 0.5, 1.15 + 0.03 * Math.sin(2 * Math.PI * phase));
    const muzzle = m(0, y + 0.15, 1.45 + 0.03 * Math.sin(2 * Math.PI * phase));
    const parts: Part[] = [
      rod(m(0, y - 0.42, 0.55), m(0, y - 0.45, -0.75), 0.2),
      rod(withers, poll, 0.11),
      rod(poll, muzzle, 0.09),
      rod(m(0, y - 0.15, -0.85), m(0, y - 0.75, -1.05), 0.05),
      { kind: 'box', center: m(0, y - 0.03, 0), size: m(0.34, 0.1, 0.5) },
    ];
    // the legs: from the shoulders and hips, swinging and lifting through the stride (diagonal pairs trotting)
    const lag = { walk: [0, 0.5, 0.25, 0.75], trot: [0, 0.5, 0.5, 0], canter: [0, 0.35, 0.2, 0.55] };
    [
      [0.12, 0.55],
      [-0.12, 0.55],
      [0.12, -0.65],
      [-0.12, -0.65],
    ].forEach(([x, z], i) => {
      const off = mix.walk * lag.walk[i] + mix.trot * lag.trot[i] + mix.canter * lag.canter[i];
      const a = 2 * Math.PI * (phase + off);
      const top = m(x, y - 0.5, z);
      const hoof = m(x, 0.06 + 0.12 * Math.max(0, Math.sin(a)), z + 0.3 * Math.cos(a));
      const knee = top.clone().lerp(hoof, 0.5).add(m(0, 0, z > 0 ? 0.05 : -0.08));
      parts.push(rod(top, knee, 0.06), rod(knee, hoof, 0.04));
    });
    // the stirrups on their leathers, the reins from the bit to the hands
    for (const side of [1, -1]) {
      const tread = m(side * HORSE.stirrup.out, y - HORSE.stirrup.below, HORSE.stirrup.ahead);
      // (the leather hangs from the bar under the saddle's flap, the leg over it)
      parts.push({ ...rod(m(side * 0.22, y - 0.2, 0.02), tread.clone().setY(tread.y + 0.03), 0.008), contact: true });
      parts.push({ kind: 'box', center: tread, size: m(0.11, 0.015, 0.06) });
    }
    for (const h of hands) parts.push({ ...rod(muzzle.clone().setY(muzzle.y - 0.02), h, 0.006), contact: true });
    return parts;
  }
}

const _v = new Vector3();

export const horse: Scenario = {
  id: 'horse',
  title: 'Riding a horse',
  drives: 'a walk-to spot, then the horse (a mount, getting on: its weight) + the hips, hands and feet getting on + the saddle (a seat) + the stirrups + the hands on the reins',
  description:
    'The rider walks up to the standing horse and mounts from its left side: by its shoulder facing its tail, the left hand with the reins on the withers, the left foot into the stirrup, the right hand on the pommel; a dip and a spring off the right foot, turning to face the horse, up onto the stirrup, the right leg swung high over the hindquarters, sitting down softly and finding the right stirrup. The script keys the hips, hands and feet through it, and how far the horse carries the body. Then the horse walks, trots and canters through a wide turn; the script moves its saddle in each gait’s rhythm (a sway and small rise at the walk, two hard bounces a stride at the trot, the canter’s rocking) and gives the saddle, the stirrups and the reins. Inferred: the trunk and arms through the mount, the posting trot — the rider rises out of the saddle on one bounce and sits on the next, from how fast and hard the saddle bounces — the canter ridden sitting, its rocking taken by the hips under a still upper body, the legs hanging long in the stirrups, heels down, and the head steady, looking ahead.',
  duration: 26,
  actors: [{ position: { x: 0.52, y: 0, z: 4.2 }, yaw: Math.PI }],
  cameraDistance: 5,
  // (the camera on the rider, up on the horse)
  focus: (a) => jointOf(a[0], 'hips'),
  create() {
    let horse: Horse | null = null;
    const travel = new Travel();
    const frame = new Quaternion();
    let phase = 0;
    let mix = blendAt(0);
    const hands: Vector3[] = [];
    const saddle = new Vector3();
    /** getting on: when it starts (s), how long the rider has stood at the spot, its keys */
    let start = Infinity;
    let stood = 0;
    let mount: Boarding | null = null;
    return {
      inputs(t, dt, [actor]) {
        const p = actor.proportions;
        const h = (horse ??= new Horse(p));
        // (standing until the rider is on, then walking off)
        const r = t - start - MOUNT.end;
        mix = blendAt(r);
        const off = smoothstep(r, 0, 1.5);
        const g = (k: keyof (typeof GAITS)['walk']) => (mix.walk * GAITS.walk[k] + mix.trot * GAITS.trot[k] + mix.canter * GAITS.canter[k]) * (k === 'rate' ? 1 : off);
        const speed = g('speed') * Math.sqrt(p.scale);
        phase = (phase + g('rate') * dt * off) % 1;
        travel.step(speed, bend(travel.s, TURN.from, TURN.to, TURN.radius, TURN.ramp), dt);
        // the saddle through the stride: its rise and fall on each beat, its rocking and surge, its sway
        const a = 2 * Math.PI * phase;
        const beat = (n: number) => -Math.cos(n * a);
        const rise = (mix.walk * GAITS.walk.rise * beat(2) + mix.trot * GAITS.trot.rise * beat(2) + mix.canter * GAITS.canter.rise * beat(1)) * off;
        const pitch = g('pitch') * Math.sin(a);
        const surge = g('surge') * Math.sin(a + 0.5);
        const sway = g('sway') * Math.sin(a);
        quatYXZ(travel.yaw, pitch, -0.5 * travel.lean, frame);
        const at = (v: Vector3) => v.applyQuaternion(frame).add(travel.position).add(_v.set(0, rise * p.scale, 0)).addScaledVector(fwd(travel.yaw), surge * p.scale).addScaledVector(lft(travel.yaw), sway * p.scale);
        const heading = quatYXZ(travel.yaw, 0, 0);
        // (the hands follow the horse's mouth, giving with its rocking: carried level, half its rise)
        const held = (v: Vector3) => v.applyQuaternion(heading).add(travel.position).add(_v.set(0, 0.5 * rise * p.scale, 0)).addScaledVector(fwd(travel.yaw), surge * p.scale);
        saddle.copy(at(h.m(0, HORSE.seat, 0)));
        const side = (s: number) => {
          const foot = new Quaternion();
          const hand = new Quaternion();
          const ankle = at(h.foot(s, new Vector3(), foot));
          const wrist = held(h.hand(s, new Vector3(), hand));
          return { foot: { position: ankle, quaternion: foot.premultiply(frame) } as Effector, hand: { position: wrist, quaternion: hand.premultiply(heading) } as Effector };
        };
        const [left, right] = [side(1), side(-1)];
        // (the reins run from the bit to the hands: where they are in the horse's frame)
        const local = (w: Vector3) => w.clone().sub(at(new Vector3())).applyQuaternion(frame.clone().invert());
        hands.length = 0;
        hands.push(local(left.hand.position), local(right.hand.position));
        // walking up to the horse's left shoulder, facing its tail; standing there a moment, getting on
        if (!mount) {
          const spot = at(h.m(MOUNT.spot.out, 0, MOUNT.spot.ahead));
          const there = Math.hypot(actor.feet[0].position.x + actor.feet[1].position.x - 2 * spot.x, actor.feet[0].position.z + actor.feet[1].position.z - 2 * spot.z) < 0.16 * p.scale;
          const still = actor.velocity.length() < 0.03 && actor.feet.every((f) => f.phase === 'planted') && Math.abs(wrapAngle(actor.yaw - travel.yaw - Math.PI)) < 0.1;
          stood = there && still ? stood + dt : 0;
          if (stood < MOUNT.wait) return [{ goal: { position: spot, quaternion: quatYXZ(travel.yaw + Math.PI) } }];
          start = t;
          mount = mounting(actor, h, local, frame);
        }
        // (its ground point moves with the saddle's surge and sway, not its bounce: a horse is no vehicle on a road)
        const ride = { mount: { position: at(new Vector3()).setY(rise * p.scale), quaternion: heading, lean: 0.4 }, seat: { position: saddle.clone(), quaternion: heading } };
        const riding = { ...ride, leftFoot: left.foot, rightFoot: right.foot, leftHand: left.hand, rightHand: right.hand };
        return [t - start < MOUNT.end ? mount.input(t - start, at, frame, riding) : riding];
      },
      facing: () => travel.yaw,
      props: () => (horse ? [{ kind: 'vehicle', position: saddle.clone().sub(_v.set(0, HORSE.seat * horse.s, 0).applyQuaternion(frame)), quaternion: frame.clone(), parts: horse.parts(phase, mix, hands) }] : []),
    };
  },
};

/**
 * Getting on from the horse's left (near) side, the classic way (m in its frame, default body;
 * s): standing by its shoulder facing its tail; the left hand with the reins on the withers,
 * the left foot into the stirrup, the right hand on the pommel; a dip and a spring off the
 * right foot, turning to face the horse, up onto the stirrup, the trunk over the saddle; the
 * right leg swung high over the hindquarters as the body turns on to face ahead; sitting down
 * softly, finding the right stirrup, the hands taking up the reins.
 */
const MOUNT = {
  spot: { out: 0.52, ahead: 0.58 },
  wait: 0.3,
  /** the left hand with the reins on the withers, the right on the pommel */
  withers: vec(0.13, 1.6, 0.62),
  pommel: vec(0.06, 1.5, 0.22),
  times: { reins: 0.9, lift: 0.7, foot: 1.6, pommel: 2.0, dip: 2.35, push: 2.6, up: 3.5, swing: 3.65, over: 4.35, sat: 4.8, found: 5.35 },
  end: 5.55,
};

/** the classic mount keyed for `h` from where it stands, warped to `horse` */
function mounting(h: Humanoid, horse: Horse, local: (w: Vector3) => Vector3, frame: Quaternion): Boarding {
  const b = new Boarding(h, local, frame, Math.PI);
  const s = horse.s;
  const T = MOUNT.times;
  const seat = (HORSE.seat + 0.085) * s;
  const hips = b.from.hips;
  const [x, y, z, yaw] = hips;
  // the hips: over the right foot as the left comes up, a dip, up over the stirrup turning to
  // face the horse, bent over the saddle; over it as the body turns ahead, down onto it
  b.hips
    .key(0, ...hips)
    .key(T.lift, x + 0.04 * s, y - 0.02 * s, z, yaw, 0.05, 0)
    .key(T.foot, x + 0.05 * s, y - 0.07 * s, z, yaw, 0.1, 0)
    .key(T.pommel, x + 0.05 * s, y - 0.08 * s, z, yaw + 0.1, 0.15, 0)
    .key(T.dip, x + 0.05 * s, y - 0.14 * s, z - 0.02 * s, yaw + 0.15, 0.2, 0)
    .key(T.up, 0.34 * s, 1.7 * s, 0.08 * s, 1.5 * Math.PI, 0.55, 0)
    .key(T.swing, 0.32 * s, 1.71 * s, 0.07 * s, 1.52 * Math.PI, 0.6, 0)
    .key(0.5 * (T.swing + T.over), 0.17 * s, 1.67 * s, 0.01 * s, 1.75 * Math.PI, 0.6, -0.15)
    .key(T.over, 0.03 * s, seat + 0.07 * s, 0, 1.97 * Math.PI, 0.3, 0)
    .key(T.sat, 0, seat, 0, 2 * Math.PI, 0, 0);
  // the feet: the left into the stirrup, turning with the body; the right on the floor, pushing
  // off and hanging, swung over the croup, into its stirrup
  const stirrup = (yaw: number) => {
    const rot = footRotation(new Quaternion(), yaw, 0.15);
    const p = vec(HORSE.stirrup.out, HORSE.seat - HORSE.stirrup.below, HORSE.stirrup.ahead)
      .multiplyScalar(s)
      .add(vec(0, -horse.p.offsets.leftToes.y, -horse.p.offsets.leftToes.z).applyQuaternion(rot));
    return [p.x, p.y, p.z, yaw, 0.15, 0];
  };
  const riding = (side: number) => {
    const rot = new Quaternion();
    const p = horse.foot(side, new Vector3(), rot);
    const f = vec(0, 0, 1).applyQuaternion(rot);
    return [p.x, p.y, p.z, Math.atan2(f.x, f.z) + 2 * Math.PI, Math.asin(f.y), 0];
  };
  const [l0, r0] = b.from.feet;
  b.feet[0]
    .key(0, ...l0)
    .key(T.lift, ...l0)
    .key(0.5 * (T.lift + T.foot), l0[0] - 0.08 * s, 0.55 * s, l0[2] - 0.15 * s, Math.PI + 0.2, 0.3, 0)
    .key(T.foot, ...stirrup(Math.PI + 0.2))
    .key(T.dip, ...stirrup(Math.PI + 0.25))
    .key(T.up, ...stirrup(Math.PI + 0.4))
    .key(T.swing + 0.2, ...stirrup(1.6 * Math.PI))
    .key(T.sat, ...riding(1));
  const hang = (k: number[], below: number) => [k[0] + 0.03 * s, k[1] - below * s, k[2] - 0.12 * s, 1.5 * Math.PI, -0.6, 0];
  b.feet[1]
    .key(0, ...r0)
    .key(T.push, ...r0)
    .key(T.push + 0.15, ...onBall(r0, -0.6, horse.p))
    .key(T.push + 0.3, ...onBall(r0, -0.9, horse.p).map((v, i) => (i === 1 ? v + 0.05 * s : v)))
    .key(T.up, ...hang(b.hips.at(T.up), 0.8))
    .key(T.swing, ...hang(b.hips.at(T.swing), 0.8))
    .key(T.swing + 0.25, 0.42 * s, 1.15 * s, -0.55 * s, 1.6 * Math.PI, -0.5, 0)
    .key(0.5 * (T.swing + T.over) + 0.12, 0.05 * s, 1.5 * s, -0.62 * s, 1.75 * Math.PI, -0.4, 0)
    .key(T.over, -0.3 * s, 1.15 * s, -0.25 * s, 1.95 * Math.PI, -0.3, 0)
    .key(T.sat, -0.33 * s, 0.95 * s, 0.02 * s, 1.95 * Math.PI, -0.2, 0)
    .key(T.found, ...riding(-1));
  // the hands: the left with the reins on the withers, the right on the pommel; both taking up the reins
  const reins = (side: number) => [...horse.hand(side, new Vector3(), new Quaternion()).toArray(), -side * 0.3, -0.5, 1, -side, 0.1, 0.2, 1];
  const on = (v: Vector3, fingers: number[], palm: number[]) => [...v.clone().multiplyScalar(s).toArray(), ...fingers, ...palm, 1];
  const withers = on(MOUNT.withers, [-1, -0.3, 0.2], [-0.3, -1, 0]);
  const pommel = on(MOUNT.pommel, [-0.6, -0.6, -0.4], [-0.3, -1, 0]);
  const free = (k: number[]) => [...k.slice(0, 9), 0];
  b.hands[0].key(0, ...free(withers)).key(T.reins, ...withers).key(T.over, ...withers).key(T.found, ...reins(1));
  b.hands[1].key(0, ...free(pommel)).key(0.8, ...free(pommel)).key(T.pommel, ...pommel).key(T.over, ...pommel).key(T.found, ...reins(-1));
  b.look
    .key(0, 0.3 * s, 0.9 * s, 0.1 * s)
    .key(T.foot, 0.3 * s, 0.85 * s, 0.06 * s)
    .key(T.dip, 0, 1.45 * s, 0)
    .key(T.up, 0, 1.45 * s, -0.3 * s)
    .key(T.over, 0, 1.6 * s, 2 * s)
    .key(T.sat, 0, 1.9 * s, 6 * s);
  b.carry
    .key(0, 0.02, 1)
    .key(T.push, 0.05, 1)
    .key(T.push + 0.3, 0.8, 1)
    .key(T.up, 0.92, 1)
    .key(T.over, 0.97, 1)
    .key(T.sat, 1, 0);
  return b;
}

const fwd = (yaw: number) => new Vector3(Math.sin(yaw), 0, Math.cos(yaw));
const lft = (yaw: number) => new Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
