import { MathUtils, Quaternion, Vector3 } from 'three';
import type { Humanoid, Proportions } from '@prohuman/core';
import type { Effector, Part, Scenario, ScenarioInput } from '../scenario';
import { minimumJerk, quatYXZ, vec, wrapAngle } from '../math';
import { bend, Boarding, footRotation, handRotation, Keys, Travel, type Riding } from './ride';

const { smoothstep, degToRad, lerp, clamp } = MathUtils;

/**
 * A saloon (m, default body), in its frame: the origin on the ground under the middle, +z
 * ahead, +x to the left; driving on the right, the driver sits left of the middle. The
 * driver's seat (its top under the hips, its back leaning back), the cabin floor, the
 * steering wheel (its middle, rim radius, its column tilted up toward the driver), the
 * wheelbase and track, the wheels.
 */
const CAR = {
  driver: 0.37,
  seat: vec(0, 0.47, -0.05),
  recline: degToRad(22),
  floor: 0.3,
  wheel: vec(0, 0.97, 0.26),
  rim: 0.19,
  column: degToRad(25),
  base: 2.7,
  track: 0.78,
  tyre: 0.32,
};
/**
 * The driver's door (m, default body): hinged on its front edge at the body's side, its
 * bottom, waist and the window frame's top at its rear; how far it opens (rad); the outer
 * handle and the inner pull (along it from the hinge, up).
 */
const DOOR = { hinge: vec(0.85, 0, 0.9), length: 1.02, bottom: 0.38, waist: 0.95, top: 1.3, open: 0.42, handle: vec(0, 0.86, 0.95), pull: vec(0, 0.96, 0.68) };
/** the roof over the cabin, a box the head ducks under getting in (m, default body) */
const ROOF = { min: vec(-0.72, 1.38, -0.9), max: vec(0.72, 1.5, 0.15) };

/** the steering ratio: steering wheel turn per road wheel turn */
const RATIO = 15;
/** where each hand rests on the rim (rad from 12 o'clock, clockwise as the driver sees it) and how far either way it holds on before moving round */
const GRIP = { home: degToRad(90), reach: degToRad(60), move: 0.35 };
/**
 * The feet by their heel on the floor (m from the driver's line, along the car), turned
 * (rad, + = left) and pitched toes up (rad): the right on the accelerator or the brake, a
 * little further up and in; the left resting on the footrest. Pressed, the foot tips down.
 */
const FEET = {
  gas: { across: -0.15, along: 0.62, lift: 0, yaw: -0.08, pitch: 0.72 },
  brake: { across: -0.03, along: 0.6, lift: 0.04, yaw: 0, pitch: 0.9 },
  rest: { across: 0.13, along: 0.66, lift: 0, yaw: 0.1, pitch: 0.8 },
  press: 0.15,
  move: 0.35,
};

/** the script: speed (m/s) through the timeline (s), the turn and lane change (along the road, m), the shoulder check (s) */
const SPEED: readonly (readonly [number, number])[] = [
  [0, 0],
  [4, 9],
  [5.5, 9],
  [7.5, 6],
  [11, 6],
  [13.5, 11],
  [17.6, 11],
  [20.4, 0],
  [22, 0],
  [26, 9],
];
const TURN = { from: 40, to: 52, radius: -10, ramp: 4 };
const LANE = { from: 93, length: 28, offset: 3.5 };
const CHECK = { from: 13.3, to: 14.3 };

/** the speed on the timeline: eased from key to key */
function speedAt(t: number) {
  let i = 1;
  while (i < SPEED.length - 1 && t > SPEED[i][0]) i++;
  const [t0, v0] = SPEED[i - 1];
  const [t1, v1] = SPEED[i];
  return lerp(v0, v1, minimumJerk((t - t0) / (t1 - t0)));
}

/** the lane change's curvature: one sine period, a heading change out and back (1/m, + = left) */
const laneChange = (s: number) => {
  const u = (s - LANE.from) / LANE.length;
  return u < 0 || u > 1 ? 0 : ((2 * Math.PI * LANE.offset) / LANE.length ** 2) * Math.sin(2 * Math.PI * u);
};

const _v = new Vector3();

/** a car's cabin fitted to a body (the default body's cabin, scaled) */
class Cabin {
  readonly s: number;
  /** the steering column's axis toward the driver, and the wheel's up and right */
  readonly toward: Vector3;
  readonly up: Vector3;
  readonly right: Vector3;

  constructor(readonly p: Proportions) {
    this.s = p.scale;
    this.toward = vec(0, Math.sin(CAR.column), -Math.cos(CAR.column));
    this.up = vec(0, 1, 0).addScaledVector(this.toward, -this.toward.y).normalize();
    this.right = this.up.clone().cross(this.toward);
  }

  /** a point in the car's frame (default body), scaled */
  m(v: Vector3) {
    return v.clone().multiplyScalar(this.s);
  }

  /** a point of the driver's place, in the car's frame */
  at(across: number, y: number, along: number, out = new Vector3()) {
    return out.set(CAR.driver + across, y, along).multiplyScalar(this.s);
  }

  /** the rim at angle `a` (rad from 12 o'clock, clockwise as the driver sees it) */
  rim(a: number, out = new Vector3()) {
    return this.at(0, CAR.wheel.y, CAR.wheel.z, out)
      .addScaledVector(this.right, Math.sin(a) * CAR.rim * this.s)
      .addScaledVector(this.up, Math.cos(a) * CAR.rim * this.s);
  }

  /** a wrist gripping the rim at `a` (its heel just outside and toward the driver), and the hand's rotation */
  grip(a: number, side: number, out: Vector3, rot: Quaternion) {
    const radial = _v.copy(this.right).multiplyScalar(Math.sin(a)).addScaledVector(this.up, Math.cos(a));
    this.rim(a, out).addScaledVector(radial, 0.025 * this.s).addScaledVector(this.toward, 0.05 * this.s);
    // the fingers round the rim, forward and in; the palm on it
    const fingers = this.toward.clone().multiplyScalar(-1).addScaledVector(radial, -0.5);
    const palm = radial.clone().multiplyScalar(-1).addScaledVector(this.toward, -0.6);
    handRotation(fingers, palm, side, rot);
    return out;
  }

  /** a foot by its heel on the floor, and its rotation (in the car's frame) */
  foot(f: { across: number; along: number; lift: number; yaw: number; pitch: number }, out: Vector3, rot: Quaternion) {
    footRotation(new Quaternion(), f.yaw, f.pitch, rot);
    const heel = this.p.sole.heel;
    return this.at(f.across, CAR.floor + f.lift, f.along, out).sub(_v.set(0, heel.y, heel.z).applyQuaternion(rot));
  }

  /** a point of the door open by `angle` (rad): `along` it from the hinge, `up` (in the car's frame) */
  door(angle: number, along: number, up: number, out = new Vector3()) {
    const h = DOOR.hinge;
    return out.set(h.x + along * Math.sin(angle), up, h.z - along * Math.cos(angle)).multiplyScalar(this.s);
  }

  parts(wheel: number, steer: number, pedals: readonly Vector3[], door: number): Part[] {
    const s = this.s;
    const m = (x: number, y: number, z: number) => vec(x, y, z).multiplyScalar(s);
    const rod = (from: Vector3, to: Vector3, radius = 0.015): Part & { kind: 'rod' } => ({ kind: 'rod', from, to, radius: radius * s });
    const parts: Part[] = [];
    // the body's outline: sills, the windscreen's pillars, the roof, the rear pillars, the bonnet and boot
    for (const x of [0.85, -0.85]) {
      parts.push(rod(m(x, 0.35, 2.2), m(x, 0.35, -2.2)));
      parts.push(rod(m(x, 0.85, 2.2), m(x, 0.95, 0.95)));
      parts.push(rod(m(x, 0.95, 0.95), m(x * 0.85, 1.4, 0.15)));
      parts.push(rod(m(x * 0.85, 1.4, 0.15), m(x * 0.85, 1.4, -0.9)));
      parts.push(rod(m(x * 0.85, 1.4, -0.9), m(x, 0.95, -1.6)));
      parts.push(rod(m(x, 0.95, -1.6), m(x, 0.9, -2.2)));
      parts.push(rod(m(x, 0.35, 2.2), m(x, 0.85, 2.2)));
      parts.push(rod(m(x, 0.35, -2.2), m(x, 0.9, -2.2)));
    }
    for (const [y, z] of [
      [0.95, 0.95],
      [1.4, 0.15],
      [1.4, -0.9],
      [0.95, -1.6],
      [0.85, 2.2],
      [0.9, -2.2],
    ])
      parts.push(rod(m(0.85, y, z), m(-0.85, y, z)));
    // the dashboard, the seat, the column and wheel, the pedals
    parts.push(rod(m(0.8, 0.85, 0.75), m(-0.8, 0.85, 0.75), 0.04));
    // (the seat's cushion under the thighs, its back behind the pelvis, leaning back)
    parts.push({ kind: 'box', center: this.at(0, CAR.seat.y - 0.05, CAR.seat.z + 0.08), size: m(0.48, 0.08, 0.46) });
    const back = quatYXZ(0, -CAR.recline, 0);
    parts.push({ kind: 'box', center: this.at(0, CAR.seat.y, CAR.seat.z - 0.17).add(m(0, 0.33, 0).applyQuaternion(back)), size: m(0.48, 0.66, 0.06), quaternion: back });
    const hub = this.at(0, CAR.wheel.y, CAR.wheel.z);
    parts.push(rod(hub, hub.clone().addScaledVector(this.toward, -0.45 * s), 0.025));
    const face = new Quaternion().setFromUnitVectors(vec(1, 0, 0), this.toward);
    parts.push({ kind: 'wheel', center: hub, radius: CAR.rim * s, tube: 0.03 * s, quaternion: face });
    parts.push(rod(this.rim(wheel - Math.PI / 2), this.rim(wheel + Math.PI / 2), 0.012));
    parts.push(rod(hub, this.rim(wheel + Math.PI), 0.012));
    for (const p of pedals) parts.push({ kind: 'box', center: p, size: m(0.08, 0.02, 0.1), quaternion: quatYXZ(0, -0.8, 0) });
    // the driver's door on its hinge: its frame, the window frame, the handles (held: against the hand)
    const d = (along: number, up: number) => this.door(door, along, up);
    const L = DOOR.length;
    parts.push(rod(d(0, DOOR.bottom), d(L, DOOR.bottom), 0.02), rod(d(0, DOOR.waist), d(L, DOOR.waist), 0.02), rod(d(0, DOOR.bottom), d(0, DOOR.waist), 0.02));
    parts.push(rod(d(L, DOOR.bottom), d(L, DOOR.top), 0.02), rod(d(L, DOOR.top), d(0.25, 1.12), 0.015));
    parts.push({ ...rod(d(DOOR.handle.z - 0.06, DOOR.handle.y), d(DOOR.handle.z + 0.04, DOOR.handle.y), 0.012), contact: true });
    parts.push({ ...rod(d(DOOR.pull.z - 0.08, DOOR.pull.y), d(DOOR.pull.z + 0.08, DOOR.pull.y), 0.012), contact: true });
    // the road wheels, the front ones steered
    for (const x of [CAR.track, -CAR.track])
      for (const z of [CAR.base / 2, -CAR.base / 2]) {
        const q = z > 0 ? quatYXZ(steer, 0, 0) : undefined;
        parts.push({ kind: 'wheel', center: m(x, CAR.tyre, z), radius: CAR.tyre * s, tube: 0.18 * s, quaternion: q });
      }
    return parts;
  }
}

/** a hand on the rim: where it grips (rad, in the wheel's own frame), and where it let go to move there (null: holding on) */
interface Hand {
  grip: number;
  from: number | null;
  since: number;
}

export const car: Scenario = {
  id: 'car',
  title: 'Driving a car',
  drives: 'a walk-to spot, the hand on the door, a seat sat on sideways, then the car (a mount, getting in: its weight) + the hands, feet and seat getting in + the seat + the hands on the wheel + the feet on the pedals (+ a glance over the shoulder)',
  description:
    'The driver walks up along the parked car, opens the door with the right hand and steps into the gap, turns the back to the seat and sits down onto its edge, ducking under the roof; then, the hands on the seat, swings round on it, the legs over the sill into the footwell and onto the pedals, the right hand onto the wheel, leans out to pull the door shut and takes the wheel with the left. The script keys the door, the hands, feet and the seat sliding round, and how far the car carries the body; walking up, stepping in, sitting down and ducking are inferred. The car then drives a road: easing off and braking into a sharp right turn, accelerating out of it, a look over the left shoulder and a lane change, a stop at a line and pulling away again. The script gives the seat (its back leaning back), the hands on the wheel — turning with it, moving round it push-pull through the sharp turn — the right foot on the accelerator or over on the brake, the left on the footrest, and the glance over the shoulder. Belted in, the body takes only a fifth of a balanced lean (the mount’s lean share): it sways out of the turns and forward under braking instead. Inferred: the trunk resting against the seat back, the arms and legs reaching the controls, the head turning into the turn.',
  duration: 40,
  actors: [{ position: { x: 1.22, y: 0, z: -3.6 }, yaw: 0 }],
  cameraDistance: 3.2,
  create() {
    let cabin: Cabin | null = null;
    const travel = new Travel();
    const frame = new Quaternion();
    let wheel = 0;
    let steer = 0;
    let brake = 0;
    let pressed = 0;
    let lastSpeed = 0;
    const hands: [Hand, Hand] = [
      { grip: -GRIP.home, from: null, since: 0 },
      { grip: GRIP.home, from: null, since: 0 },
    ];
    const pedals: Vector3[] = [];
    const world = (p: Vector3) => p.applyQuaternion(frame).add(travel.position);
    const local = (w: Vector3) => w.clone().sub(travel.position).applyQuaternion(frame.clone().invert());
    /** getting in: when the door is reached and when the body sits on the seat (s), how long it has stood at the door; the door; the keys */
    let opened = Infinity;
    let sat = Infinity;
    let stood = 0;
    /** in the gap with the back to the seat, standing still that long (s) */
    let backed = 0;
    let door = 0;
    let board: Boarding | null = null;
    /** opening: [door angle, the right hand's weight]; swinging in: [door angle, how far round on the seat, the left hand from the door to the wheel and the back onto the seat's] */
    const opening = new Keys(2);
    const swing = new Keys(3);
    return {
      inputs(t, dt, [actor]) {
        const p = actor.proportions;
        const c = (cabin ??= new Cabin(p));
        // (driving from the end of getting in)
        const r = t - sat - IN.end;
        const speed = speedAt(r) * Math.sqrt(p.scale);
        const accel = (speed - lastSpeed) / dt;
        lastSpeed = speed;
        travel.step(speed, bend(travel.s, TURN.from, TURN.to, TURN.radius, TURN.ramp) + laneChange(travel.s), dt);
        quatYXZ(travel.yaw, 0, 0, frame);
        steer = Math.atan(CAR.base * travel.curvature);
        wheel = -RATIO * steer;

        // the hands: each holds on within reach of its home, then moves round to grip further back
        const [left, right] = hands.map((h, i) => {
          const side = i === 0 ? 1 : -1;
          const home = -side * GRIP.home;
          const out = new Vector3();
          const rot = new Quaternion();
          h.since += dt;
          const a = h.grip + wheel;
          const other = hands[1 - i];
          if (h.from === null && other.from === null && Math.abs(a - home) > GRIP.reach) {
            h.from = h.grip;
            h.grip = home - Math.sign(a - home) * 0.7 * GRIP.reach - wheel;
            h.since = 0;
          }
          c.grip(h.grip + wheel, side, out, rot);
          if (h.from !== null) {
            // (off the rim and round it, the wheel turning on under it)
            const k = minimumJerk(h.since / GRIP.move);
            const wasRot = new Quaternion();
            const was = c.grip(h.from + wheel, side, new Vector3(), wasRot);
            out.lerp(was, 1 - k).addScaledVector(c.toward, 0.06 * c.s * Math.sin(Math.PI * k));
            // (the hand turns round with it: no snap onto the new grip)
            rot.slerp(wasRot, 1 - k);
            if (k >= 1) h.from = null;
          }
          return { position: world(out), quaternion: rot.premultiply(frame) } as Effector;
        });

        // the right foot: over to the brake while slowing, back on the accelerator, pressing as hard as it takes
        const braking = accel < -0.3 || speed < 0.1;
        brake = clamp(brake + (braking ? dt : -dt) / FEET.move, 0, 1);
        pressed += (clamp(Math.abs(accel) / 4, 0.1, 1) - pressed) * Math.min(1, 6 * dt);
        const k = minimumJerk(brake);
        const on = { ...FEET.gas };
        for (const key of ['across', 'along', 'lift', 'yaw', 'pitch'] as const) on[key] = lerp(FEET.gas[key], FEET.brake[key], k);
        // (lifted clear as it crosses over)
        on.lift += 0.05 * Math.sin(Math.PI * k);
        on.pitch -= FEET.press * pressed;
        const feet = [FEET.rest, on].map((f) => {
          const rot = new Quaternion();
          const ankle = c.foot(f, new Vector3(), rot);
          return { position: world(ankle), quaternion: rot.premultiply(frame) } as Effector;
        });
        pedals.length = 0;
        for (const f of [FEET.gas, FEET.brake]) pedals.push(c.foot({ ...f, pitch: f.pitch - FEET.press * 0.5 }, new Vector3(), new Quaternion()).add(vec(0, -0.03, 0.12).multiplyScalar(c.s)));

        const check = smoothstep(r, CHECK.from, CHECK.from + 0.2) * (1 - smoothstep(r, CHECK.to - 0.2, CHECK.to));
        const roof = { min: world(c.m(ROOF.min)), max: world(c.m(ROOF.max)) };
        /** the seat turned `yaw` (its middle `out`), its back leaning `back` of the way */
        const seated = (yaw: number, out: number, back: number) =>
          ({ position: world(c.at(out, CAR.seat.y, CAR.seat.z)), quaternion: frame.clone().multiply(quatYXZ(yaw, -CAR.recline * back, 0)) }) as Effector;
        const riding: Riding = {
          mount: { position: world(c.at(0, 0, 0)), quaternion: frame.clone(), lean: 0.2 },
          seat: seated(0, 0, 1),
          leftHand: left,
          rightHand: right,
          leftFoot: feet[0],
          rightFoot: feet[1],
          // (a glance over the left shoulder before moving over)
          lookAt: check > 0.5 ? world(c.at(3, 1.1, -5)) : undefined,
        };
        if (t - sat >= IN.end) return [riding];
        // walking up along the car to its door; opening it with the right hand
        if (opened === Infinity) {
          const spot = world(c.m(IN.spot));
          const [f0, f1] = actor.feet;
          const there = Math.hypot(f0.position.x + f1.position.x - 2 * spot.x, f0.position.z + f1.position.z - 2 * spot.z) < 0.16 * p.scale;
          const still = actor.velocity.length() < 0.03 && actor.feet.every((f) => f.phase === 'planted') && Math.abs(wrapAngle(actor.yaw - travel.yaw)) < 0.1;
          stood = there && still ? stood + dt : 0;
          if (stood < IN.wait) return [{ goal: { position: spot, quaternion: frame.clone() }, bodyObstacles: [roof] }];
          opened = t;
          const O = IN.open;
          opening.key(0, 0, 0).key(O.reach, 0, 1).key(O.pulled, O.angle, 1).key(O.let, 0.4 * O.angle + 0.6 * DOOR.open, 0).key(O.swung, DOOR.open, 0);
        }
        // stepping into the gap, the back to the seat's edge, and sitting down on it, ducking under the roof
        const side = seated(IN.side.yaw, IN.side.out, 0);
        if (!board) {
          const [angle, pull] = opening.at(t - opened);
          door = angle;
          const handle = world(c.door(door, DOOR.handle.z, DOOR.handle.y)).addScaledVector(vec(Math.cos(door), 0, Math.sin(door)).applyQuaternion(frame), 0.04 * c.s);
          const n = vec(Math.cos(door), 0, Math.sin(door));
          const grip = { position: handle, quaternion: handRotation(n.clone().negate().setY(0.5), n.clone().negate().setY(0.8), -1).premultiply(frame), weight: pull } as Effector;
          // (stepping into the gap, the back squarely to the seat, before sitting down: no step while sitting)
          const stepping = t - opened > IN.open.step;
          const gap = side.position.clone().addScaledVector(vec(1, 0, 0).applyQuaternion(frame), 0.33 * c.s).setY(0);
          const [f0, f1] = actor.feet;
          const there = Math.hypot(f0.position.x + f1.position.x - 2 * gap.x, f0.position.z + f1.position.z - 2 * gap.z) < 0.1 * p.scale;
          const still = actor.velocity.length() < 0.03 && actor.feet.every((f) => f.phase === 'planted') && Math.abs(wrapAngle(actor.yaw - travel.yaw - IN.side.yaw)) < 0.1;
          backed = backed > 0.1 || (stepping && there && still) ? backed + dt : 0;
          const sitting = backed > 0.1;
          const input: ScenarioInput = { bodyObstacles: [roof], lookAt: stepping ? undefined : handle };
          if (pull > 0) input.rightHand = grip;
          if (stepping && !sitting) input.goal = { position: gap, quaternion: side.quaternion };
          if (sitting) input.seat = side;
          if (!sitting || actor.seated < 0.97) return [input];
          sat = t;
          board = getIn(actor, c, local, frame, swing);
        }
        const u = t - sat;
        const [angle, round, toWheel] = swing.at(u);
                door = angle;
        const yaw = IN.side.yaw * (1 - round);
        const pull = world(c.door(door, DOOR.pull.z, DOOR.pull.y)).addScaledVector(vec(-Math.cos(door), 0, -Math.sin(door)).applyQuaternion(frame), 0.04 * c.s);
        const n = vec(Math.cos(door), 0, Math.sin(door));
        const held = handRotation(vec(0, 0, 1).applyAxisAngle(vec(0, 1, 0), door).setY(-0.3), n.clone().setY(-0.3), 1).premultiply(frame);
        const leftHand = { position: pull.lerp(left.position, toWheel), quaternion: left.quaternion ? held.slerp(left.quaternion, toWheel) : held };
        return [board.input(u, world, frame, { ...riding, seat: seated(yaw, IN.side.out * (1 - round), toWheel), leftHand, lookAt: undefined, bodyObstacles: [roof] })];
      },
      props: () => (cabin ? [{ kind: 'vehicle', position: travel.position.clone(), quaternion: frame.clone(), parts: cabin.parts(wheel, steer, pedals, door) }] : []),
      facing: () => travel.yaw,
    };
  },
};

/**
 * Getting in (m in the car's frame, default body; s from reaching the door, then from sitting
 * down; rad): the spot by the door's rear edge facing ahead; the right hand pulls the door
 * open by its handle and lets it swing on; a step into the gap, the back to the seat sat on
 * sideways at its edge (facing out); round on the seat, the legs over the sill and onto the
 * pedals, the left hand pulling the door shut by its pull and then on the wheel.
 */
const IN = {
  spot: vec(1.22, 0, -0.4),
  wait: 0.3,
  open: { reach: 0.7, pulled: 1.4, angle: 0.25, let: 1.7, swung: 2.2, step: 1.6 },
  /** sitting on the seat's edge facing out: off the seat's middle (m), the facing (rad) */
  side: { out: 0.27, yaw: Math.PI / 2 },
  /** the left hand on its way from the seat out to the door */
  reach: vec(0.72, 1.0, 0.15),
  times: { hold: 0.4, lift: 0.15, sill: 0.95, footwell: 1.35, pedals: 1.7, round: 1.5, grab: 2.2, shut: 3.85, wheel: 4.35 },
  end: 4.55,
};

/** swinging in from sitting on the seat's edge, keyed for `h` as it sits; the door and the turn on the seat into `swing` */
function getIn(h: Humanoid, c: Cabin, local: (w: Vector3) => Vector3, frame: Quaternion, swing: Keys): Boarding {
  const b = new Boarding(h, local, frame, IN.side.yaw);
  const s = c.s;
  const T = IN.times;
  swing.key(0, DOOR.open, 0, 0).key(T.lift + 0.15, DOOR.open, 0, 0).key(T.round, DOOR.open, 1, 0).key(T.grab + 0.95, DOOR.open, 1, 0).key(T.shut, 0, 1, 0).key(T.wheel, 0, 1, 1);
  // the feet: up off the floor (out from the sill), over the sill, into the footwell, onto the pedals
  const OUT = 1;
  const [l0, r0] = b.from.feet;
  const D = CAR.driver;
  b.feet[0]
    .key(0, ...l0)
    .key(T.lift, ...l0)
    .key(0.5 * (T.lift + T.sill), Math.max(l0[0], OUT * s), 0.48 * s, l0[2] + 0.1 * s, l0[3] - 0.3, -0.3, 0)
    .key(T.sill, (D + 0.4) * s, 0.55 * s, 0.38 * s, 0.4, -0.2, 0)
    .key(T.footwell, (D + 0.15) * s, 0.33 * s, 0.6 * s, 0.1, 0.3, 0);
  b.feet[1]
    .key(0, ...r0)
    .key(T.lift + 0.1, ...r0)
    .key(T.lift + 0.2, r0[0], r0[1] + 0.07 * s, r0[2], r0[3], -0.3, 0)
    .key(T.lift + 0.3, Math.max(r0[0], OUT * s), 0.22 * s, r0[2] + 0.05 * s, r0[3] - 0.1, -0.4, 0)
    .key(0.5 * (T.lift + T.sill) + 0.1, Math.max(r0[0], OUT * s), 0.48 * s, r0[2] + 0.1 * s, r0[3] - 0.3, -0.3, 0)
    .key(T.sill + 0.1, (D + 0.3) * s, 0.5 * s, 0.28 * s, 0.4, -0.2, 0)
    .key(T.footwell + 0.1, (D - 0.1) * s, 0.33 * s, 0.6 * s, 0, 0.3, 0);
  // the hands: onto the seat beside the hips, pushing round on it; the right then onto the wheel, the left to the door
  const cushion = (along: number) => [...c.at(0.12, CAR.seat.y + 0.07, CAR.seat.z + along).toArray(), 0.4, -0.3, Math.sign(along), 0, -1, 0, 1];
  const free = (k: number[]) => [...k.slice(0, 9), 0];
  b.hands[0]
    .key(0, ...free(cushion(-0.14)))
    .key(T.hold, ...cushion(-0.14))
    .key(T.round, ...cushion(-0.14))
    .key(T.grab - 0.1, ...c.m(IN.reach).toArray(), 0, 0.2, 1, 0.3, -1, 0.3, 1);
  b.hands[1].key(0, ...free(cushion(0.2))).key(T.hold, ...cushion(0.2));
  b.onto
    .key(T.footwell, 0, 0, 0, 0)
    .key(T.pedals, 1, 0.5, 0, 0.6)
    .key(T.pedals + 0.3, 1, 1, 0, 1)
    .key(T.grab - 0.1, 1, 1, 0, 1)
    .key(T.grab + 0.9, 1, 1, 1, 1);
  b.look
    .key(0, (D + 0.6) * s, 0.4 * s, 0.4 * s)
    .key(T.sill, (D + 0.2) * s, 0.4 * s, 0.6 * s)
    .key(T.pedals, (D + 0.5) * s, 0.9 * s, 0.6 * s)
    .key(T.shut, (D + 0.5) * s, 0.9 * s, 0.4 * s)
    .key(T.wheel, D * s, 1.1 * s, 4 * s);
  b.carry.key(0, 0.3, 0).key(T.footwell, 0.95, 0).key(T.wheel, 1, 0);
  return b;
}
