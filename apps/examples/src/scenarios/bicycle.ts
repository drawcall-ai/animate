import { MathUtils, Quaternion, Vector3 } from 'three';
import type { Humanoid, Proportions } from '@prohuman/core';
import type { Part, Scenario } from '../scenario';
import { quatYXZ, vec, wrapAngle } from '../math';
import { bend, Boarding, footRotation, handRotation, Keys, onBall, Travel, type Riding } from './ride';

const { smoothstep, degToRad } = MathUtils;

/**
 * A step-through city hybrid for a 1.75 m rider (m, scaled with the body), in its frame: the
 * origin on the ground under the crank axle, +z ahead, +x to the left. 700c wheels, wheelbase
 * 1.01 m, seat tube 73°, head tube 72° with its top 0.56 m over and 0.38 m ahead of the axle
 * (stack and reach), a flat bar on a short stem; no top tube, one stout down tube: the leg steps
 * through the frame getting on.
 */
const BIKE = {
  axle: 0.27,
  crank: 0.17,
  wheel: 0.34,
  rear: -0.41,
  front: 0.6,
  seatAngle: degToRad(73),
  headTop: vec(0, 0.83, 0.38),
  headAngle: degToRad(72),
  /** the bar's middle, and its grips' half-width */
  bar: vec(0, 0.9, 0.5),
  grip: 0.27,
  /** the pedals' middles out from the frame's */
  pedal: 0.12,
};
/** the knee's flexion at the bottom of the stroke the saddle is set for (rad; 25–35°, Bini 2011) */
const KNEE_AT_BOTTOM = degToRad(30);
/** the hip joints over the saddle's top (m, default body: the core's seat) */
const SIT = 0.085;
/** metres travelled per crank turn: seated, and out of the saddle in a bigger gear */
const GEAR = { seated: 4, standing: 5.3 };
/**
 * the foot's pitch around the stroke (+ = toes up, rad): flattest pushing over the top, the
 * toes furthest down pulling through the bottom (ankling: ~−5° to −25° of pedal angle)
 */
const ankling = (crank: number) => -0.2 + 0.15 * Math.cos(crank - degToRad(60));
/** out of the saddle the bike rocks under the rider, away from the pedal going down (rad) */
const ROCK = 0.07;

/** the script: the turn (along the way, m), standing on the pedals and braking (s) */
const TURN = { from: 12, to: 27, radius: 8, ramp: 4 };
const STAND = { from: 8.6, to: 11.2 };
const BRAKE = { from: 12.6, to: 14.8 };

const _v = new Vector3();
const _q = new Quaternion();

/** a bike fitted to a body: its saddle set by the knee at the bottom of the stroke */
class Bike {
  readonly s: number;
  /** the saddle's top (in the bike's frame) */
  readonly saddle = new Vector3();
  /** the steering axis, up along the head tube */
  private readonly steerAxis = vec(0, Math.sin(BIKE.headAngle), -Math.cos(BIKE.headAngle));

  constructor(readonly p: Proportions) {
    const s = (this.s = p.scale);
    const tube = vec(0, Math.sin(BIKE.seatAngle), -Math.cos(BIKE.seatAngle));
    // (the hip joints to the ankle at the bottom of the stroke)
    const reach = Math.sqrt(p.thigh ** 2 + p.shin ** 2 + 2 * p.thigh * p.shin * Math.cos(KNEE_AT_BOTTOM));
    const bottom = this.ankle(Math.PI, 1, new Vector3(), new Quaternion()).setX(0);
    let lo = 0.3;
    let hi = 1.2;
    for (let i = 0; i < 40; i++) {
      const L = ((lo + hi) / 2) * s;
      this.saddle.copy(tube).multiplyScalar(L).setY(BIKE.axle * s + tube.y * L);
      if (_v.copy(this.saddle).setY(this.saddle.y + SIT * s).distanceTo(bottom) > reach) hi = (lo + hi) / 2;
      else lo = (lo + hi) / 2;
    }
  }

  /** a pedal's spindle at crank angle `crank` (0 = up, + = forward over the top); `side` 1 = left */
  pedal(crank: number, side: number, out: Vector3) {
    const s = this.s;
    return out.set(side * BIKE.pedal * s, (BIKE.axle + BIKE.crank * Math.cos(crank)) * s, BIKE.crank * Math.sin(crank) * s);
  }

  /** the ankle with the ball of the foot on a pedal, and the foot's rotation (in the bike's frame) */
  ankle(crank: number, side: number, out: Vector3, rot: Quaternion) {
    const { p } = this;
    footRotation(_q.identity(), 0, ankling(crank), rot);
    const ball = p.offsets.leftToes;
    // (the sole under the ball on the pedal's top)
    return this.pedal(crank, side, out)
      .setY(out.y + 0.012 * this.s)
      .add(_v.set(0, -ball.y, -ball.z).applyQuaternion(rot));
  }

  /** a point of the front end (fork, bar) steered by `steer` (rad, + = left) */
  steered(p: Vector3, steer: number, out: Vector3) {
    const top = _v.copy(BIKE.headTop).multiplyScalar(this.s);
    return out.copy(p).sub(top).applyAxisAngle(this.steerAxis, steer).add(top);
  }

  /** a wrist on its grip (the heel of the hand over the bar), and the hand's rotation (in the bike's frame) */
  wrist(side: number, steer: number, out: Vector3, rot: Quaternion) {
    const s = this.s;
    this.steered(vec(side * BIKE.grip, BIKE.bar.y + 0.035, BIKE.bar.z - 0.05).multiplyScalar(s), steer, out);
    // the fingers ahead and down around the grip, turned out a little; the palm down and in
    const fingers = vec(side * 0.25, -0.5, 1).applyAxisAngle(this.steerAxis, steer);
    const palm = vec(-side * 0.35, -1, 0.3).applyAxisAngle(this.steerAxis, steer);
    handRotation(fingers, palm, side, rot);
    return out;
  }

  /** its parts at crank angle `crank` (the right crank's; the left's is opposite), steered by `steer` */
  parts(crank: number, steer: number): Part[] {
    const s = this.s;
    const m = (x: number, y: number, z: number) => vec(x, y, z).multiplyScalar(s);
    const axle = m(0, BIKE.axle, 0);
    const rear = m(0, BIKE.wheel, BIKE.rear);
    const front = m(0, BIKE.wheel, BIKE.front);
    const top = m(BIKE.headTop.x, BIKE.headTop.y, BIKE.headTop.z);
    const headLow = top.clone().addScaledVector(this.steerAxis, -0.14 * s);
    const seatTop = this.saddle.clone().lerp(axle, 0.35);
    const rod = (from: Vector3, to: Vector3, radius = 0.016): Part => ({ kind: 'rod', from, to, radius: radius * s });
    const fork = (p: Vector3) => this.steered(p, steer, new Vector3());
    const parts: Part[] = [
      { kind: 'wheel', center: rear, radius: BIKE.wheel * s, tube: 0.03 * s },
      { kind: 'wheel', center: fork(front), radius: BIKE.wheel * s, tube: 0.03 * s },
      rod(axle, seatTop),
      // (the post up into the saddle's shell, which sits between the thighs)
      rod(seatTop, this.saddle.clone().lerp(seatTop, 0.12), 0.012),
      rod(axle, headLow, 0.025),
      rod(top, headLow, 0.022),
      rod(headLow, fork(front), 0.014),
      rod(top, fork(m(0, BIKE.bar.y, BIKE.bar.z)), 0.014),
      rod(fork(m(BIKE.grip + 0.05, BIKE.bar.y, BIKE.bar.z)), fork(m(-BIKE.grip - 0.05, BIKE.bar.y, BIKE.bar.z)), 0.013),
      { kind: 'box', center: this.saddle.clone().add(m(0, 0.02, 0.03)), size: m(0.14, 0.04, 0.26) },
    ];
    for (const side of [1, -1]) {
      parts.push(rod(axle.clone().setX(side * 0.07 * s), rear.clone().setX(side * 0.06 * s), 0.01));
      parts.push(rod(seatTop.clone().setX(side * 0.02 * s), rear.clone().setX(side * 0.06 * s), 0.009));
      const pedal = this.pedal(side > 0 ? crank + Math.PI : crank, side, new Vector3());
      parts.push(rod(axle.clone().setX(side * 0.075 * s), pedal.clone().setX(side * 0.075 * s), 0.012));
      parts.push({ kind: 'box', center: pedal, size: m(0.09, 0.02, 0.07) });
    }
    parts.push({ kind: 'wheel', center: m(-0.05, BIKE.axle, 0), radius: 0.1 * s, tube: 0.012 * s });
    return parts;
  }
}

export const bicycle: Scenario = {
  id: 'bicycle',
  title: 'Riding a bicycle',
  drives: 'a walk-to spot, then the bike (a mount, getting on: its weight) + the hips, hands and feet getting on + the saddle (a seat) + the grips + the pedals',
  description:
    'The rider walks up to the parked bike from behind and gets on from its left: takes the grips, tilts the bike toward itself and steps the right leg through the frame over the low down tube, the knee lifted and turned out, stands astride it, perches on the saddle with the bike leaning onto the left foot on tiptoe and the right foot on the raised pedal, pushes off and finds the left pedal as the bike rolls upright. The script keys the hips, hands and feet through it, how far the bike carries the body and its tilt. Then the bike rides a path with a left-hand turn, leaning into it as a balanced bike must. The script moves it and gives the saddle, the hands on the grips and the feet on the pedals as the cranks turn; everything else is inferred: the knees tracking over the pedals, the trunk leaning forward to the bar, the whole body leaning with the bike into the turn, the head level, looking down the road. Halfway the saddle is taken away: the rider stands on the pedals, the bike rocking under them, then sits down again, stops pedalling and brakes, leaning back.',
  duration: 24,
  actors: [{ position: { x: 0.38, y: 0, z: -3 }, yaw: 0 }],
  cameraDistance: 5,
  create() {
    let bike: Bike | null = null;
    const travel = new Travel();
    let crank = BOARD.crank;
    let steer = 0;
    let standing = 0;
    const frame = new Quaternion();
    const heading = new Quaternion();
    const at = (p: Vector3) => p.applyQuaternion(frame).add(travel.position);
    const upright = (p: Vector3) => p.applyQuaternion(heading).add(travel.position);
    const turn = (q: Quaternion) => q.premultiply(frame);
    /** getting on: when it starts (s), how long the rider has stood at the spot, its keys and the bike's tilt */
    let start = Infinity;
    let stood = 0;
    let board: Boarding | null = null;
    const tilt = new Keys(1);
    return {
      inputs(t, dt, [actor]) {
        const p = actor.proportions;
        const b = (bike ??= new Bike(p));
        // (riding from the push-off)
        const r = t - start - BOARD.times.push;
        // speed: rolling off and on, faster out of the saddle, braking to a crawl
        const brake = smoothstep(r, BRAKE.from, BRAKE.to);
        const speed = r > 0 ? (5.4 * smoothstep(r, 0, 3.5) + 1.2 * smoothstep(r, STAND.from, STAND.to) - 3.6 * brake) * Math.sqrt(p.scale) : 0;
        travel.step(speed, bend(travel.s, TURN.from, TURN.to, TURN.radius, TURN.ramp), dt);
        // (up off the saddle first, then rocking the bike, which settles before sitting down again)
        standing = smoothstep(r, STAND.from + 0.3, STAND.from + 0.9) * (1 - smoothstep(r, STAND.to - 0.6, STAND.to));
        // pedalling (coasting while braking, the cranks come level)
        const pedalling = 1 - smoothstep(r, BRAKE.from - 0.6, BRAKE.from);
        crank += ((pedalling * 2 * Math.PI * speed) / (MathUtils.lerp(GEAR.seated, GEAR.standing, standing) * p.scale)) * dt;
        const level = Math.round((crank - Math.PI / 2) / Math.PI) * Math.PI + Math.PI / 2;
        if (r > 0) crank += (level - crank) * (1 - pedalling) * Math.min(1, 4 * dt);
        steer = Math.atan((BIKE.front - BIKE.rear) * p.scale * travel.curvature);
        const lean = travel.lean + ROCK * standing * Math.sin(crank) + (board ? tilt.at(t - start)[0] : 0);
        quatYXZ(travel.yaw, 0, -lean, frame);
        quatYXZ(travel.yaw, 0, 0, heading);
        const sides = [1, -1] as const;
        const [left, right] = sides.map((side) => {
          const foot = new Quaternion();
          const hand = new Quaternion();
          const ankle = at(b.ankle(side > 0 ? crank + Math.PI : crank, side, new Vector3(), foot));
          const wrist = at(b.wrist(side, steer, new Vector3(), hand));
          return { foot: { position: ankle, quaternion: turn(foot) }, hand: { position: wrist, quaternion: turn(hand) } };
        });
        // walking up to the bike's left side; standing there a moment, getting on
        if (!board) {
          const spot = upright(vec(BOARD.spot.out, 0, BOARD.spot.ahead).multiplyScalar(p.scale));
          const [f0, f1] = actor.feet;
          const there = Math.hypot(f0.position.x + f1.position.x - 2 * spot.x, f0.position.z + f1.position.z - 2 * spot.z) < 0.16 * p.scale;
          const still = actor.velocity.length() < 0.03 && actor.feet.every((f) => f.phase === 'planted') && Math.abs(wrapAngle(actor.yaw - travel.yaw)) < 0.1;
          stood = there && still ? stood + dt : 0;
          if (stood < BOARD.wait) return [{ goal: { position: spot, quaternion: heading.clone() } }];
          start = t;
          const local = (w: Vector3) => w.clone().sub(travel.position).applyQuaternion(heading.clone().invert());
          board = boarding(actor, b, local, heading, tilt);
        }
        const input: Riding = {
          mount: { position: travel.position.clone(), quaternion: frame.clone() },
          leftFoot: left.foot,
          rightFoot: right.foot,
          leftHand: left.hand,
          rightHand: right.hand,
        };
        // (up on the pedals, the saddle is left)
        if (r < STAND.from || r > STAND.to) input.seat = { position: at(b.saddle.clone()), quaternion: frame.clone() };
        return [t - start < BOARD.end ? board.input(t - start, upright, heading, input) : input];
      },
      props: () => (bike ? [{ kind: 'vehicle', position: travel.position.clone(), quaternion: frame.clone(), parts: bike.parts(crank, steer) }] : []),
      facing: () => travel.yaw,
    };
  },
};

/**
 * Getting on from the bike's left (m in its upright frame, default body; s; rad): standing
 * beside it facing ahead, the hands take the grips; the bike tilts toward the body and the
 * right leg steps through the frame (Dubbeldam 2016's way on through the frame, rather than
 * the leg swung over the saddle, which takes the hip past its extension at this saddle height):
 * the knee lifted, the thigh turned out over the down tube, the trunk a little forward and
 * turned toward the bike, the pelvis hitched on that side, onto the floor on the far side; astride it, the bike leans onto the left foot as the hips perch on the
 * saddle, the left foot on tiptoe, the right foot onto the pedal raised forward; a push off
 * it, the bike rolling upright, the left foot onto its pedal.
 */
const BOARD = {
  spot: { out: 0.38, ahead: -0.08 },
  wait: 0.3,
  /** the right pedal raised forward to push off from (crank angle, rad) */
  crank: Math.PI / 3,
  tilt: { over: 0.2, astride: 0.08, perched: 0.33 },
  times: { grips: 0.8, tilted: 1.2, swing: 1.3, over: 2.4, down: 2.7, perch: 3, sat: 3.6, pedal: 3.7, push: 4, rolled: 4.7 },
  end: 5,
};

/** getting on keyed for `h` from where it stands, warped to `bike`; its tilt into `tilt` */
function boarding(h: Humanoid, bike: Bike, local: (w: Vector3) => Vector3, frame: Quaternion, tilt: Keys): Boarding {
  const b = new Boarding(h, local, frame, 0);
  const s = bike.s;
  const T = BOARD.times;
  const B = BOARD.tilt;
  tilt.key(0, 0).key(T.grips, 0).key(T.tilted, B.over).key(T.over, B.over).key(T.down, B.astride).key(T.perch, B.astride).key(T.sat, B.perched).key(T.push, B.perched).key(T.rolled, 0);
  // the hips: forward and turned toward the bike as the leg steps through, astride the frame, up and back onto the saddle
  const [x, y, z, yaw] = b.from.hips;
  const D = T.over - T.swing;
  const saddle = bike.saddle.clone().applyAxisAngle(vec(0, 0, 1), -B.perched);
  b.hips
    .key(0, ...b.from.hips)
    .key(T.grips, x - 0.02 * s, y - 0.02 * s, z + 0.03 * s, yaw, 0.2, 0)
    .key(T.swing, x - 0.03 * s, y - 0.03 * s, z + 0.03 * s, yaw - 0.05, 0.3, 0)
    .key(T.swing + 0.5 * D, x - 0.06 * s, y, z + 0.02 * s, yaw - 0.25, 0.45, 0.25)
    .key(T.swing + 0.8 * D, x - 0.22 * s, y - 0.03 * s, z + 0.02 * s, yaw - 0.15, 0.4, 0.35)
    .key(T.over, 0.1 * s, y - 0.06 * s, z, yaw, 0.4, 0)
    .key(T.down, 0.06 * s, y - 0.04 * s, 0.04 * s, yaw, 0.3, 0)
    .key(T.perch, 0.07 * s, y - 0.03 * s, 0.02 * s, yaw, 0.3, 0)
    .key(T.sat, saddle.x, saddle.y + 0.085 * s, saddle.z, yaw, 0.35, 0);
  // (the chest forward over the bar as the leg steps through)
  b.chest
    .key(T.grips, 0, 0, 0, 0)
    .key(T.swing, 0.2, 0, 0, 0.6)
    .key(0.5 * (T.swing + T.over), 0.3, 0, 0, 0.7)
    .key(T.down, 0.1, 0, 0, 0.5)
    .key(T.sat, 0, 0, 0, 0);
  // the feet: the left stays, up onto its toes, onto its pedal; the right through the frame to
  // the floor astride, then up onto its pedal
  const [l0, r0] = b.from.feet;
  const rDown = [-0.24 * s, r0[1], r0[2] + 0.22 * s, yaw - 0.1, 0, 0];
  b.feet[0]
    .key(0, ...l0)
    .key(T.perch, ...l0)
    .key(T.sat, ...onBall(l0, -0.8, bike.p))
    .key(T.push, ...onBall(l0, -0.8, bike.p))
    .key(T.push + 0.25, l0[0] - 0.1 * s, 0.3 * s, l0[2] + 0.05 * s, l0[3], -0.3, 0);
  // (the knee lifted forward and out, the foot carried over the down tube, put down on the far side)
  b.feet[1]
    .key(0, ...r0)
    .key(T.swing, ...r0)
    .key(T.swing + 0.12 * D, ...onBall(r0, -0.5, bike.p))
    .key(T.swing + 0.32 * D, r0[0] + 0.04 * s, 0.4 * s, r0[2] - 0.06 * s, yaw, -0.5, 0)
    .key(T.swing + 0.45 * D, r0[0] + 0.02 * s, 0.5 * s, r0[2] - 0.03 * s, yaw - 0.2, -0.45, 0)
    .key(T.swing + 0.6 * D, 0.06 * s, 0.5 * s, r0[2] + 0.1 * s, yaw - 0.3, -0.4, 0)
    .key(T.swing + 0.78 * D, -0.17 * s, 0.4 * s, r0[2] + 0.14 * s, yaw - 0.3, -0.3, 0)
    .key(T.over, -0.22 * s, 0.22 * s, r0[2] + 0.12 * s, yaw - 0.2, -0.2, 0)
    .key(T.over + 0.15, ...rDown)
    .key(T.perch, ...rDown)
    .key(0.5 * (T.perch + T.pedal), -0.12 * s, 0.4 * s, 0.05 * s, yaw, -0.2, 0);
  // the hands: onto the grips
  const grip = (side: number) => [...bike.wrist(side, 0, new Vector3(), new Quaternion()).toArray(), side * 0.25, -0.5, 1, -side * 0.35, -1, 0.3, 1];
  const free = (k: number[]) => [...k.slice(0, 9), 0];
  b.hands[0].key(0, ...free(grip(1))).key(T.grips, ...grip(1));
  b.hands[1].key(0, ...free(grip(-1))).key(T.grips, ...grip(-1));
  // (the contacts go over to the bike's: the grips as it tilts, the pedals as they turn)
  b.onto
    .key(T.grips, 0, 0, 0, 0)
    .key(T.tilted, 0, 0, 1, 1)
    .key(0.5 * (T.perch + T.pedal), 0, 0, 1, 1)
    .key(T.pedal, 0, 1, 1, 1)
    .key(T.push + 0.25, 0, 1, 1, 1)
    .key(T.rolled, 1, 1, 1, 1);
  b.look
    .key(0, 0, 0.8 * s, 0.5 * s)
    .key(T.grips, 0, 0.7 * s, 0.5 * s)
    .key(T.swing, 0, 0.8 * s, -0.2 * s)
    .key(T.over, 0, 0.6 * s, 0)
    .key(T.perch, 0, 0.5 * s, 0.4 * s)
    .key(T.push, 0, 1.2 * s, 4 * s);
  b.carry
    .key(0, 0.02, 1)
    .key(T.swing, 0.3, 1)
    .key(T.over, 0.5, 1)
    .key(T.down, 0.1, 1)
    .key(T.perch, 0.25, 1)
    .key(T.perch + 0.15, 0.6, 1)
    .key(T.sat - 0.2, 0.7, 1)
    .key(T.sat, 0.8, 0)
    .key(T.push, 0.85, 0)
    .key(T.rolled, 1, 0);
  return b;
}
