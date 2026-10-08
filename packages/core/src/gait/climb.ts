import { Quaternion, Vector3 } from 'three';
import type { Box } from '../input';
import type { HandTask } from '../intent/tasks';
import { GRAVITY, hypot, leftOf, lerp, wrapAngle, yawOf } from '../math';
import type { Proportions } from '../proportions';
import { footYaw, stanceFeet, type Stance } from '../stance';
import type { GaitFoot } from './foot';
import type { Gait, Root } from './gait';
import { ARM_LEAD, ARMS, BOTTOM, HEEL_UP, LOAD, PUSH } from './jump';
import { entering, faceAt, groundUnder } from './obstacles';
import { footTracks, handRotation, Track, type Move } from './sequence';

/** rises (× height) climbed onto: beyond a step or a mantle, within a hop's reach */
const RISE = { min: 0.6, max: 1.35 };
/** where the body stands to hop for the edge, and on the top once up: its support centre out from the face, in from the edge (m, default body) */
const STAND = 0.5;
const ON_TOP = 0.3;
/** the hop: countermovement depth (× height); the pelvis's rise on the toes at takeoff, and the flight's least rise above that (m, default body) */
const DIP = 0.09;
const TOES = 0.04;
const HOP = 0.1;
/** the hang sinks at most this far below the catch (m, default body) */
const SINK = 0.1;
/** reaching for the edge, how far the hold bows out toward the wall early on (m, default body): the hands pass well in front of the shoulders, short of the wall */
const REACH = 0.7;
/** the hands grip this far out from the middle (m, default body): shoulder width */
const GRIP = 0.2;
/**
 * the wrist off the edge (m along, up; default body) hanging (fingers hooked over it) and
 * pressing (palm flat on the top, fingers ahead)
 */
const HANG_GRIP = { along: -0.035, up: -0.01, tilt: 0.5 };
const PRESS_GRIP = { along: 0.045, up: 0.035, tilt: Math.PI / 2 };
/**
 * Key poses along the face: the pelvis (hip joints' midpoint: m out from the face, − = in
 * front; up from the edge, default body) and the trunk's lean (rad). Hanging, the feet push
 * the hips out from the wall; the pull brings the chest up to the edge; the press, the
 * arms straight, lifts the hips over it; the knee comes up with the trunk bent over the
 * hands; the weight goes onto it as the other comes up (the parkour climb-up; UE5 Game Animation
 * Sample traversal).
 */
const HANG = { along: -0.5, lean: 0.45 };
const PULL = { along: -0.45, chest: 0.08, lean: 0.55 };
const PRESS = { along: -0.15, up: 0.14, lean: 0.7 };
const KNEE = { along: -0.1, up: 0.24, lean: 0.8 };
const OVER = { along: 0.02, up: 0.34, lean: 0.75 };
/**
 * A foot on the face: its ankle out from it (m, default body), below the pelvis (× leg
 * length), pitched toes up (rad), the toes bent up against the wall further (rad).
 */
const WALL = { out: 0.2, below: 0.72, pitch: 0.3, toes: 0.9, knee: 0.45 };
/**
 * A foot coming up onto the top: out from the face and up past the edge (m from it, default
 * body; at a share of its way), the knee turned out beside the body (rad), the foot this much
 * wider than where it lands (m)
 */
const UP_THE_FACE = { up: { at: 0.45, along: -0.25, y: -0.3, knee: 1.3 }, over: { at: 0.75, along: -0.15, y: 0.1, knee: 1 }, wide: 0.05 };
/** the knees of the legs hanging in the press turn out (rad): ready to come up beside the body */
const HANG_KNEE = 0.8;
/** the first foot up lands this much wider, beside the hand (m, default body): the leg comes up beside the body, not folded under it */
const BESIDE = 0.2;
/** the durations after the catch (s, default body): hang, a beat before the pull, the pull, press, knee up, weight over, stand */
const TIME = { hang: 0.35, hold: 0.15, pull: 0.8, press: 0.5, knee: 0.5, over: 0.5, stand: 0.8 };
/** the feet step up the wall twice each through the pull: [foot, from, to] as shares of it */
const STEPS: readonly (readonly [number, number, number])[] = [
  [0, 0.02, 0.24],
  [1, 0.22, 0.44],
  [0, 0.46, 0.68],
  [1, 0.66, 0.88],
];
/** the foot that comes up first (right) */
const LEAD = 1;

type Phase = 'approach' | 'climb';

const _a = new Vector3();
const _b = new Vector3();
const _v = new Vector3();
const _x = new Vector3();
const _y = new Vector3();

/**
 * Climbing onto ground too high to step or hop onto (a wall about the body's height): the
 * walk stops facing the wall about an arm's length out; a small countermovement hop, the arms
 * swinging up, catches the top edge with both hands; the body hangs with the feet on the
 * face, pulls up as the feet walk up it until the chest is at the edge, rolls the hands over
 * onto the top and presses up to straight arms, brings one foot up beside the hands, puts
 * its weight on it, brings the other up and stands. From the hop on it owns the root, the
 * feet and the hands (which count as holds); its trunk lean and free-arm swing are layered
 * on by the gait overlay and the arms. The key poses are warped to the edge and the body.
 */
export class Climb implements Move {
  phase: Phase | null = null;
  /** trunk lean and roll (rad) and free-arm shoulder flexion (rad) it adds; how far the planted heels are raised (rad) */
  lean = 0;
  readonly roll = 0;
  arm = 0;
  heel = 0;
  /** where the eyes are on */
  readonly look = new Vector3();
  /** the hands' holds on the edge [left, right] (weight 0: free), and their rotations */
  private readonly rots = [new Quaternion(), new Quaternion()];
  private readonly holds: [HandTask, HandTask] = [
    { pos: new Vector3(), rot: this.rots[0], weight: 0 },
    { pos: new Vector3(), rot: this.rots[1], weight: 0 },
  ];
  private box: Box | null = null;
  /** the edge: where the approach meets the face, at the top; into the box, across the face; the facing */
  private readonly edge = new Vector3();
  private readonly dir = new Vector3();
  private readonly left = new Vector3();
  private yaw = 0;
  private readonly spot = new Vector3();
  private readonly aimAt: Root = { x: 0, y: 0, z: 0, yaw: 0 };
  /** time into the climb (s) and when it lifts off, plants each foot on top, ends */
  private t = 0;
  private readonly at = { lift: 0, catch: 0, pull: 0, press: 0, knee: 0, over: 0, end: 0 };
  /** the hip joints' midpoint as last posed, and the root's offset from it as the climb began */
  private readonly hips = new Vector3();
  private readonly off = new Vector3();
  private readonly pelvis = { along: new Track(), up: new Track(), across: new Track() };
  private readonly tracks = { lean: new Track(), arm: new Track(), heel: new Track(), hold: new Track(), grip: new Track(), look: new Track(), gaze: new Track() };
  private readonly feet = [footTracks(), footTracks()];
  /** where the feet stand on top, and the support centre between */
  private readonly tops: [Vector3, Vector3] = [new Vector3(), new Vector3()];
  private readonly centre = new Vector3();

  constructor(
    private d: Proportions,
    private stance: Stance,
  ) {}

  /** the climb owns the root, feet and hands */
  get owns() {
    return this.phase === 'climb';
  }

  /** a hand's hold on the edge, or null while it is free */
  hold(s: number): HandTask | null {
    return this.holds[s].weight > 0 ? this.holds[s] : null;
  }

  reset() {
    this.phase = null;
    this.box = null;
    this.lean = this.arm = this.heel = 0;
    for (const h of this.holds) h.weight = 0;
  }

  /** The target to walk to: `target`, or, with it on ground to climb onto, the spot in front of the wall; standing there, the climb begins. */
  aim(g: Gait, target: Root): Root {
    // (a wall on the way is seen before the goal gets there)
    const ahead = g.ahead;
    const ground = g.steer.ground;
    // (a ladder up there is climbed instead)
    if (this.phase === null && g.ladder.phase === null) this.find(g, groundUnder(ground, target.x, target.z) ?? groundUnder(ground, ahead.x, ahead.z));
    if (this.phase !== 'approach') return target;
    // (the goal isn't going onto the box after all: no climb)
    const box = this.box;
    if (!box || (groundUnder(ground, target.x, target.z) !== box && entering(box, _a.set(target.x, 0, target.z), ahead, _v) === Infinity)) {
      this.reset();
      return target;
    }
    const [a, b] = g.feet;
    const there = hypot(g.root.x - this.spot.x, g.root.z - this.spot.z) < 0.06 * this.d.scale;
    const settled = !g.moving && a.phase === 'planted' && b.phase === 'planted' && Math.min(a.plantedTime, b.plantedTime) > 0.25 && g.speed < 0.05;
    if (there && settled && Math.abs(wrapAngle(g.root.yaw - this.yaw)) < 0.15) this.start(g);
    return Object.assign(this.aimAt, { x: this.spot.x, y: target.y, z: this.spot.z, yaw: this.yaw });
  }

  /** the goal goes onto `box`: if it is too high to step onto and within a hop's reach, approach its face squarely */
  private find(g: Gait, box: Box | null) {
    const { d, root } = g;
    if (!box) return;
    const rise = box.max.y - root.y;
    if (rise < RISE.min * d.height || rise > RISE.max * d.height) return;
    const from = _a.set(root.x, 0, root.z);
    const enter = entering(box, from, _b.set((box.min.x + box.max.x) / 2, 0, (box.min.z + box.max.z) / 2), _v);
    if (enter === Infinity) return;
    const p = from.addScaledVector(_v, enter);
    // the face it enters through: the one it meets (its inward normal is the facing)
    const f = faceAt(box, p, this.dir);
    this.yaw = yawOf(this.dir.x, this.dir.z);
    leftOf(this.yaw, this.left);
    // (the hands' span within the face)
    const m = (GRIP + 0.1) * d.scale;
    if (f < 2) p.z = Math.min(Math.max(p.z, box.min.z + m), box.max.z - m);
    else p.x = Math.min(Math.max(p.x, box.min.x + m), box.max.x - m);
    this.edge.set(p.x, box.max.y, p.z);
    this.spot.copy(this.edge).addScaledVector(this.dir, -STAND * d.scale).setY(0);
    this.box = box;
    this.phase = 'approach';
  }

  /** standing at the wall: plan the climb from the pose it starts in */
  private start(g: Gait) {
    const { d, stance } = this;
    const s = d.scale;
    const H = d.height;
    const e = this.edge.y;
    const o = d.offsets;
    const trunk = o.spine.y + o.chest.y + o.leftShoulder.y;
    const shrug = 0.03 * H;
    const L = d.armLength;
    const ts = Math.sqrt(s);
    this.off.set(g.root.x, g.root.y, g.root.z).sub(this.hips);
    const a0 = this.along(this.hips);
    const x0 = this.across(this.hips);
    const y0 = this.hips.y;
    // the hang: arms out to the edge (95%), the hips pushed out from the wall
    const wristA = HANG_GRIP.along * s;
    const wristY = e + HANG_GRIP.up * s;
    const gap = wristA - (HANG.along * s + trunk * Math.sin(HANG.lean));
    const hang = wristY - Math.sqrt(Math.max(0, (0.95 * L) ** 2 - gap * gap)) - shrug - trunk * Math.cos(HANG.lean);
    // the hop: up on the toes, then flying until the hands, reaching up, catch the edge
    const toes = y0 + TOES * s;
    const apex = Math.max(wristY - 0.97 * L - shrug - trunk, toes + HOP * s);
    const yH = Math.max(hang, apex - SINK * s);
    const vy = Math.sqrt(2 * GRAVITY * (apex - toes));
    const at = this.at;
    const dip = LOAD;
    at.lift = LOAD + PUSH;
    at.catch = at.lift + vy / GRAVITY;
    const hung = at.catch + TIME.hang * ts;
    at.pull = hung + TIME.hold * ts;
    const top = at.pull + TIME.pull * ts;
    at.press = top + TIME.press * ts;
    at.knee = at.press + TIME.knee * ts;
    at.over = at.knee + TIME.over * ts;
    at.end = at.over + TIME.stand * ts;
    // where the feet stand on top, and the pelvis over them then (as it stood at the start)
    const centre = this.centre.copy(this.edge).addScaledVector(this.dir, ON_TOP * s);
    stanceFeet(centre.x, centre.z, this.dir, this.left, d, stance, this.tops);
    for (const p of this.tops) p.y += e;
    this.tops[LEAD].addScaledVector(this.left, g.feet[LEAD].side * BESIDE * s);
    const pv = this.pelvis;
    pv.along
      .clear()
      .key(0, a0)
      .key(dip, a0 - 0.02 * s)
      .key(at.lift, a0 + 0.02 * s)
      .key(at.catch, a0 + 0.05 * s)
      .key(hung, HANG.along * s)
      .key(at.pull, HANG.along * s)
      .key(top, PULL.along * s)
      .key(at.press, PRESS.along * s)
      .key(at.knee, KNEE.along * s)
      .key(at.over, OVER.along * s)
      .key(at.end, this.along(_a.copy(centre).sub(this.off)));
    pv.up
      .clear()
      .key(0, y0)
      .key(dip, y0 - DIP * H, 0, BOTTOM)
      .key(at.lift, toes, vy, -GRAVITY)
      .key(at.catch, apex, 0, -GRAVITY)
      .key(hung, yH)
      .key(at.pull, yH)
      .key(top, e + PULL.chest * s - trunk * Math.cos(PULL.lean))
      .key(at.press, e + PRESS.up * s)
      .key(at.knee, e + KNEE.up * s)
      .key(at.over, e + OVER.up * s)
      .key(at.end, e - this.off.y);
    const lead = this.across(this.tops[LEAD]);
    pv.across
      .clear()
      .key(0, x0)
      .key(at.catch, 0)
      .key(at.press, 0)
      .key(at.knee, 0.3 * lead)
      .key(at.over, 0.6 * lead)
      .key(at.end, this.across(_a.copy(centre).sub(this.off)));
    const k = this.tracks;
    k.lean
      .clear()
      .key(0, 0)
      .key(dip, 0.45)
      .key(at.lift, 0.15)
      .key(at.catch, 0.05)
      .key(hung, HANG.lean)
      .key(at.pull, HANG.lean)
      .key(at.pull + 0.5 * (top - at.pull), 0.35)
      .key(top, PULL.lean)
      .key(at.press, PRESS.lean)
      .key(at.knee, KNEE.lean)
      .key(at.over, OVER.lean)
      .key(at.end, 0);
    // (the arms swing back, then reach straight for the edge: no swing forward into the wall)
    k.arm
      .clear()
      .key(0, 0)
      .key(dip - ARM_LEAD, 0.3 * ARMS.back)
      .key(at.catch, 0);
    k.heel.clear().key(dip + 0.2 * PUSH, 0).key(at.lift, HEEL_UP).key(at.catch, 0);
    k.hold
      .clear()
      .key(dip - ARM_LEAD, 0)
      .key(at.catch, 1)
      .key(at.over, 1)
      .key(at.over + 0.3 * ts, 0);
    k.grip
      .clear()
      .key(at.pull + 0.5 * (top - at.pull), 0)
      .key(at.press, 1);
    // the eyes on the edge, then over the top, then ahead
    k.look.clear().key(0, 0.05).key(at.pull, 0.05).key(top, 0.5).key(at.press, 1.2).key(at.over, 2).key(at.end, 3);
    k.gaze.clear().key(0, 0).key(at.press, 0).key(at.end, 0.75 * H);
    this.phase = 'climb';
    this.t = 0;
  }

  /** Advance a climb under way; false when there is none (the gait walks). */
  update(g: Gait, dt: number): boolean {
    if (this.phase !== 'climb') return false;
    this.t += dt;
    const t = this.t;
    const at = this.at;
    const [lf, rf] = g.feet;
    if (t >= at.lift && lf.phase === 'planted' && rf.phase === 'planted' && t < at.knee) this.liftOff(g);
    if (t >= at.knee) this.plant(g.feet[LEAD], LEAD);
    if (t >= at.over) this.plant(g.feet[1 - LEAD], 1 - LEAD);
    if (t >= at.end) {
      this.finish(g);
      return false;
    }
    g.walk -= g.walk * Math.min(1, 6 * dt);
    const { root } = g;
    const p = this.point(this.pelvis.along.at(t), this.pelvis.up.at(t), this.pelvis.across.at(t), _a).add(this.off);
    root.x = p.x;
    root.y = p.y;
    root.z = p.z;
    const k = this.tracks;
    this.lean = k.lean.at(t);
    this.arm = k.arm.at(t);
    this.heel = k.heel.at(t);
    this.point(k.look.at(t), this.edge.y + k.gaze.at(t), 0, this.look);
    this.grip(k.hold.at(t), k.grip.at(t), t < this.at.catch);
    return true;
  }

  /** the hands on the edge: hooked over it hanging, rolled over onto the top pressing (`roll` 0 → 1); `reaching` for it yet */
  private grip(weight: number, roll: number, reaching: boolean) {
    const s = this.d.scale;
    const along = lerp(HANG_GRIP.along, PRESS_GRIP.along, roll) * s;
    const up = lerp(HANG_GRIP.up, PRESS_GRIP.up, roll) * s;
    const tilt = lerp(HANG_GRIP.tilt, PRESS_GRIP.tilt, roll);
    // the fingers over the edge, the palm on it
    const fingers = _x.copy(this.dir).multiplyScalar(Math.sin(tilt));
    fingers.y = Math.cos(tilt);
    const palm = _y.copy(this.dir).multiplyScalar(Math.cos(tilt));
    palm.y = -Math.sin(tilt);
    for (let i = 0; i < 2; i++) {
      const h = this.holds[i];
      const side = i === 0 ? 1 : -1;
      h.weight = weight;
      // (reaching for it, the hands come up well in front of the shoulders, then up to the edge: the
      // arms blend to the hold by its weight, so the bow leads early and is gone before the wall)
      const bow = reaching ? REACH * s * Math.sin(Math.PI * weight) * (1 - weight) ** 2 : 0;
      this.point(along + bow, this.edge.y + up, side * GRIP * s, h.pos);
      handRotation(fingers, palm, side, this.rots[i]);
    }
  }

  /** off the floor: plan the feet's way up the face and onto the top */
  private liftOff(g: Gait) {
    const { d } = this;
    const s = d.scale;
    const at = this.at;
    const ts = Math.sqrt(s);
    const e = this.edge.y;
    const pv = this.pelvis;
    const onWall = at.catch + 0.3 * ts;
    const top = at.pull + TIME.pull * ts;
    const wallA = -WALL.out * s;
    const below = WALL.below * d.legLength;
    const hangA = PRESS.along * s - 0.01 * s;
    const hangBelow = 0.97 * d.legLength;
    for (let i = 0; i < 2; i++) {
      const f = g.feet[i];
      const w = f.swing;
      f.phase = 'swing';
      w.s = 0;
      w.from.copy(f.pose.ankle);
      w.fromYaw = f.yaw;
      w.to.copy(this.tops[i]);
      w.toYaw = footYaw(this.yaw, f.side, this.stance);
      w.lift = w.clear = w.over = 0;
      w.pace = Infinity;
      w.strikePitch = 0;
      const k = this.feet[i];
      const across = this.across(f.pose.ankle);
      const onTop = this.across(this.tops[i]);
      k.along.clear().key(at.lift, this.along(f.pose.ankle)).key(onWall, wallA);
      k.up.clear().key(at.lift, f.pose.ankle.y).key(onWall, pv.up.at(at.pull) - below);
      k.across.clear().key(at.lift, across);
      k.pitch.clear().key(at.lift, f.pose.pitch).key(onWall, WALL.pitch);
      k.toes.clear().key(at.lift, f.pose.toePitch).key(onWall, WALL.toes);
      k.out.clear().key(at.lift, 0).key(onWall, WALL.knee);
      // walking up the face through the pull: each step out from it and up, under the rising pelvis
      for (const [foot, a, b] of STEPS) {
        if (foot !== i) continue;
        const t0 = at.pull + a * (top - at.pull);
        const t1 = at.pull + b * (top - at.pull);
        k.along.key(t0, wallA).key(0.5 * (t0 + t1), wallA - 0.08 * s).key(t1, wallA);
        k.up.key(t0, k.up.at(t0)).key(t1, pv.up.at(t1 + 0.1) - below);
        k.pitch.key(t0, WALL.pitch).key(0.5 * (t0 + t1), 0).key(t1, WALL.pitch);
        k.toes.key(t0, WALL.toes).key(0.5 * (t0 + t1), 0).key(t1, WALL.toes);
      }
      // the press: the legs straighten and hang, the toes down the face
      const hang = (t: number) => {
        k.along.key(t, hangA);
        k.up.key(t, pv.up.at(t) - hangBelow);
        k.pitch.key(t, -0.7);
        k.toes.key(t, -0.7);
        k.out.key(t, HANG_KNEE);
      };
      k.along.key(top + 0.1, wallA);
      k.up.key(top + 0.1, k.up.at(top + 0.1));
      k.pitch.key(top + 0.1, WALL.pitch);
      k.toes.key(top + 0.1, WALL.toes);
      k.out.key(top + 0.1, WALL.knee);
      hang(at.press);
      // then up beside the body, the knee turned out, over the edge and onto the top
      const lead = i === LEAD;
      const from = lead ? at.press : at.knee;
      const to = lead ? at.knee : at.over;
      if (!lead) hang(from);
      const [up, over] = [lerp(from, to, UP_THE_FACE.up.at), lerp(from, to, UP_THE_FACE.over.at)];
      k.along.key(up, UP_THE_FACE.up.along * s).key(over, UP_THE_FACE.over.along * s).key(to, this.along(this.tops[i]));
      k.up.key(up, e + UP_THE_FACE.up.y * s).key(over, e + UP_THE_FACE.over.y * s).key(to, this.tops[i].y);
      k.across.key(from, across).key(up, onTop + f.side * UP_THE_FACE.wide * s).key(to, onTop);
      k.pitch.key(up, -0.2).key(over, 0.1).key(to, 0);
      k.toes.key(up, -0.2).key(over, 0.1).key(to, 0);
      k.out.key(up, UP_THE_FACE.up.knee).key(over, UP_THE_FACE.over.knee).key(to, 0);
    }
  }

  /** a foot set down on top: it bears weight there */
  private plant(f: GaitFoot, i: number) {
    if (f.phase !== 'swing') return;
    f.phase = 'planted';
    f.anchor.copy(this.tops[i]);
    f.yaw = f.swing.toYaw;
    f.landPitch = f.pose.pitch = f.pose.toePitch = f.kneeOut = 0;
    f.plantedTime = 0;
  }

  /** standing on top: the gait takes over */
  private finish(g: Gait) {
    const { root } = g;
    root.x = this.centre.x;
    root.y = this.edge.y;
    root.z = this.centre.z;
    g.velocity.set(0, 0, 0);
    g.moving = false;
    g.lastLanded = 1 - LEAD;
    this.reset();
  }

  /** The hip joints as posed this tick ([left, right]); climbing, the feet off the floor are posed on their way. */
  pose(g: Gait, hips: readonly [Vector3, Vector3]) {
    this.hips.addVectors(hips[0], hips[1]).multiplyScalar(0.5);
    if (this.phase !== 'climb') return;
    const t = this.t;
    for (let i = 0; i < 2; i++) {
      const f = g.feet[i];
      if (f.phase !== 'swing') continue;
      const k = this.feet[i];
      this.point(k.along.at(t), k.up.at(t), k.across.at(t), f.pose.ankle);
      f.pose.pitch = k.pitch.at(t);
      f.pose.toePitch = k.toes.at(t);
      f.kneeOut = k.out.at(t);
      // (the foot turns out with its knee)
      f.yaw = f.swing.toYaw + f.side * 0.75 * f.kneeOut;
      f.orient();
    }
  }

  /** the point `along` out from the edge's face (+ = over the top), at height `y`, `across` it (+ = left), into `out` */
  private point(along: number, y: number, across: number, out: Vector3): Vector3 {
    return out.copy(this.edge).addScaledVector(this.dir, along).addScaledVector(this.left, across).setY(y);
  }

  private along(p: Vector3): number {
    return (p.x - this.edge.x) * this.dir.x + (p.z - this.edge.z) * this.dir.z;
  }

  private across(p: Vector3): number {
    return (p.x - this.edge.x) * this.left.x + (p.z - this.edge.z) * this.left.z;
  }
}
