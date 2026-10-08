import { Quaternion, Vector3 } from 'three';
import type { Box, Ladder as LadderInput } from '../input';
import type { HandTask } from '../intent/tasks';
import { forwardOf, hypot, leftOf, wrapAngle } from '../math';
import type { Proportions } from '../proportions';
import { footYaw, stanceFeet, type Stance } from '../stance';
import type { GaitFoot } from './foot';
import type { Gait, Root } from './gait';
import { entering, groundUnder } from './obstacles';
import { footTracks, handRotation, Track, type Move } from './sequence';

/** a ladder's rung spacing and stile spacing by default, and how far its stiles reach on above its top (m) */
const SPACING = 0.3;
const WIDTH = 0.46;
const RAILS = 1;
/** where the body stands to mount it: its support centre out from the rungs (m, default body) */
const STAND = 0.45;
/**
 * On the ladder (m, default body): the hip joints out from the rungs and above the lower
 * foot's rung; the ankles out from the rungs (the ball of the foot on them), apart; the
 * wrists behind the rungs and above them, apart; limbs moving between rungs swing this far out
 */
const PELVIS = { out: 0.48, up: 0.72 };
const FOOT = { out: 0.13, across: 0.08, clear: 0.12 };
const HAND = { out: 0.04, up: 0.03, across: 0.17, clear: 0.1 };
/** the hands hold this many rungs above the lower foot and one fewer: about shoulder height and above */
const REACH = 4;
/**
 * Times (s, default body): a hand and the opposite foot move up two rungs each half-cycle,
 * the hand leading; mounting, the hands take hold first; stepping off, one foot then the other
 * steps onto the top as the hands let go, and the body stands up
 */
const TIME = { half: 0.75, hand: 0.35, footAt: 0.37, foot: 0.36, mount: 0.7, step: 0.55, stand: 0.8 };
/** the eyes look at the rungs this far above the hip joints (m, default body): a little above eye level */
const LOOK = 0.95;
/** stepping off, the feet land this far in from the top edge (m, default body) */
const ON_TOP = 0.3;

type Phase = 'approach' | 'climb';

const _a = new Vector3();
const _b = new Vector3();
const _c = new Vector3();
const _up = new Vector3(0, 1, 0);
const _fingers = new Vector3();
const _palm = new Vector3();

/** a hand's way through the climb: wrist out from the rungs, up, across */
const handTracks = () => ({ along: new Track(), up: new Track(), across: new Track(), hold: new Track() });

/**
 * Climbing a ladder up to the ground it leads to (a goal there): the walk stops facing it at
 * its foot; the hands take hold of the rungs at shoulder height and above, and the climb goes
 * hand and opposite foot together (the contralateral pattern), each up two rungs as the body
 * rises one, the trunk close to the ladder; near the top the hands move onto the stiles, one
 * foot steps through onto the top, the other follows as the hands let go, and the body stands
 * up and walks on. From the mount on it owns the root, the feet and the hands.
 */
export class LadderClimb implements Move {
  phase: Phase | null = null;
  lean = 0;
  readonly roll = 0;
  readonly arm = 0;
  readonly heel = 0;
  readonly look = new Vector3();
  private readonly rots = [new Quaternion(), new Quaternion()];
  private readonly holds: [HandTask, HandTask] = [
    { pos: new Vector3(), rot: this.rots[0], weight: 0 },
    { pos: new Vector3(), rot: this.rots[1], weight: 0 },
  ];
  private ladder: LadderInput | null = null;
  /** its foot (on the rungs' line), facing into it, across it; the facing; rung spacing, rungs, stiles' half spacing */
  private readonly base = new Vector3();
  private readonly dir = new Vector3();
  private readonly left = new Vector3();
  private yaw = 0;
  private spacing = SPACING;
  private rungs = 0;
  private rail = WIDTH / 2;
  private readonly spot = new Vector3();
  private readonly aimAt: Root = { x: 0, y: 0, z: 0, yaw: 0 };
  private t = 0;
  private end = 0;
  /** when each foot first steps up, and is set down on the top */
  private readonly steps = [0, 0];
  private readonly onTop = [0, 0];
  private readonly hips = new Vector3();
  private readonly off = new Vector3();
  private readonly pelvis = { along: new Track(), up: new Track(), across: new Track() };
  private readonly leanTrack = new Track();
  private readonly feet = [footTracks(), footTracks()];
  private readonly hands = [handTracks(), handTracks()];
  /** where the feet stand on the top, and their centre */
  private readonly tops: [Vector3, Vector3] = [new Vector3(), new Vector3()];
  private readonly centre = new Vector3();

  constructor(
    private d: Proportions,
    private stance: Stance,
  ) {}

  get owns() {
    return this.phase === 'climb';
  }

  hold(s: number): HandTask | null {
    return this.holds[s].weight > 0 ? this.holds[s] : null;
  }

  reset() {
    this.phase = null;
    this.ladder = null;
    this.lean = 0;
    for (const h of this.holds) h.weight = 0;
  }

  /** The target to walk to: `target`, or, with it on ground a ladder leads up to, the foot of the ladder; standing there, the climb begins. */
  aim(g: Gait, target: Root): Root {
    if (this.phase === null) this.find(g, target);
    if (this.phase !== 'approach') return target;
    const ladder = this.ladder;
    if (!ladder || !this.leadsTo(g, ladder, target)) {
      this.reset();
      return target;
    }
    const [a, b] = g.feet;
    const there = hypot(g.root.x - this.spot.x, g.root.z - this.spot.z) < 0.06 * this.d.scale;
    const settled = !g.moving && a.phase === 'planted' && b.phase === 'planted' && Math.min(a.plantedTime, b.plantedTime) > 0.25 && g.speed < 0.05;
    if (there && settled && Math.abs(wrapAngle(g.root.yaw - this.yaw)) < 0.15) this.start(g);
    return Object.assign(this.aimAt, { x: this.spot.x, y: target.y, z: this.spot.z, yaw: this.yaw });
  }

  /** the ground at a ladder's top, if the goal is on it or on its way onto it */
  private leadsTo(g: Gait, ladder: LadderInput, target: Root): Box | null {
    const ground = g.steer.ground;
    const f = forwardOf(ladder.yaw, _a);
    const top = groundUnder(ground, ladder.position.x + f.x * 0.2, ladder.position.z + f.z * 0.2);
    if (!top || Math.abs(top.max.y - ladder.height) > 0.05) return null;
    const goal = _b.set(target.x, 0, target.z);
    const on = groundUnder(ground, goal.x, goal.z) === top || groundUnder(ground, g.ahead.x, g.ahead.z) === top || entering(top, goal, g.ahead, _c) < Infinity;
    return on ? top : null;
  }

  /** a ladder up to where the goal is: approach its foot, facing it */
  private find(g: Gait, target: Root) {
    const { d } = this;
    // (standing on its top already: nothing to climb)
    const ladder = g.steer.ladders.find((l) => this.leadsTo(g, l, target) && g.root.y < l.height - 0.5);
    if (!ladder) return;
    this.ladder = ladder;
    this.yaw = ladder.yaw;
    forwardOf(this.yaw, this.dir);
    leftOf(this.yaw, this.left);
    this.base.set(ladder.position.x, ladder.position.y, ladder.position.z);
    this.spacing = ladder.spacing ?? SPACING;
    this.rungs = Math.round((ladder.height - ladder.position.y) / this.spacing);
    this.rail = (ladder.width ?? WIDTH) / 2;
    this.spot.copy(this.base).addScaledVector(this.dir, -STAND * d.scale).setY(0);
    this.phase = 'approach';
  }

  /** standing at its foot: plan the climb */
  private start(g: Gait) {
    const { d, stance } = this;
    const s = d.scale;
    const sp = this.spacing;
    const n = this.rungs;
    const top = this.base.y + n * sp;
    this.off.set(g.root.x, g.root.y, g.root.z).sub(this.hips);
    const pv = this.pelvis;
    const pelvisAt = (low: number) => this.base.y + low * sp + d.ankleHeight + PELVIS.up * s;
    pv.along.clear().key(0, this.along(this.hips));
    pv.up.clear().key(0, this.hips.y);
    pv.across.clear().key(0, this.across(this.hips));
    this.leanTrack.clear().key(0, 0);
    // the limbs: where each is, as a rung index (0: the floor), and its tracks from now
    const rungY = (i: number) => this.base.y + i * sp;
    const feet = [0, 0];
    const hands = [0, 0];
    for (let i = 0; i < 2; i++) {
      const f = g.feet[i];
      const k = this.feet[i];
      const a = f.pose.ankle;
      k.along.clear().key(0, this.along(a));
      k.up.clear().key(0, a.y);
      k.across.clear().key(0, this.across(a));
      k.pitch.clear().key(0, f.pose.pitch);
      k.toes.clear().key(0, f.pose.toePitch);
      k.out.clear().key(0, 0);
      const h = this.hands[i];
      h.along.clear();
      h.up.clear();
      h.across.clear();
      h.hold.clear().key(0, 0);
    }
    /** a foot (0 left) up onto rung `to` from `t0` to `t1`: out from the ladder and up, then onto it */
    const footTo = (i: number, to: number, t0: number, t1: number) => {
      const k = this.feet[i];
      const side = g.feet[i].side;
      const y = rungY(to) + d.ankleHeight;
      k.along.key(t0, k.along.at(t0)).key(0.5 * (t0 + t1), -(FOOT.out + FOOT.clear) * s).key(t1, -FOOT.out * s);
      k.up.key(t0, k.up.at(t0)).key(0.6 * t0 + 0.4 * t1, Math.max(k.up.at(t0), y) + 0.03 * s).key(t1, y);
      k.across.key(t0, k.across.at(t0)).key(t1, side * FOOT.across * s);
      k.pitch.key(t0, k.pitch.at(t0)).key(0.5 * (t0 + t1), -0.3).key(t1, 0.05);
      k.toes.key(t0, k.toes.at(t0)).key(t1, 0.05);
      if (feet[i] === 0) this.steps[i] = t0;
      feet[i] = to;
    };
    /** a hand (0 left) onto rung `to` (a stile above the top) from `t0` to `t1`, off its hold and over */
    const handTo = (i: number, to: number, t0: number, t1: number) => {
      const h = this.hands[i];
      const side = g.feet[i].side;
      const y = Math.min(rungY(to), top + RAILS - 0.1) + HAND.up * s;
      const across = side * (rungY(to) > top - 0.05 ? this.rail : HAND.across * s);
      const holding = !h.along.empty;
      if (holding) h.along.key(t0, h.along.at(t0)).key(0.5 * (t0 + t1), -(HAND.out + HAND.clear) * s);
      h.along.key(t1, -HAND.out * s);
      if (holding) h.up.key(t0, h.up.at(t0));
      h.up.key(t1, y);
      if (holding) h.across.key(t0, h.across.at(t0));
      h.across.key(t1, across);
      if (!holding) h.hold.key(t0, 0);
      h.hold.key(t1, 1);
      hands[i] = to;
    };
    // mounting: the hands take hold at shoulder height and above; the pelvis comes in to the ladder
    const lead = 1;
    // (the hand that moves first a rung lower: the hands stay four and five rungs above the lower foot)
    handTo(1 - lead, REACH - 1, 0.05, 0.45);
    handTo(lead, REACH, 0.2, TIME.mount);
    pv.along.key(TIME.mount, -PELVIS.out * s);
    pv.across.key(TIME.mount, 0);
    this.leanTrack.key(TIME.mount, 0.3);
    // climbing: the lower foot and the opposite hand, up two rungs, the body rising one
    let t = TIME.mount;
    let foot = lead;
    let first = true;
    while (Math.max(feet[0], feet[1]) < n - 1) {
      const to = first ? 1 : feet[foot] + 2;
      handTo(1 - foot, hands[1 - foot] + 2, t, t + TIME.hand);
      footTo(foot, to, t + TIME.footAt, t + TIME.footAt + TIME.foot);
      t += TIME.half;
      pv.along.key(t, -PELVIS.out * s);
      pv.up.key(t, pelvisAt(Math.min(feet[0], feet[1])));
      foot = 1 - foot;
      first = false;
    }
    // stepping off: the upper foot through onto the top, the pelvis over it, the other foot up beside it as the hands let go
    this.centre.copy(this.base).addScaledVector(this.dir, ON_TOP * s);
    stanceFeet(this.centre.x, this.centre.z, this.dir, this.left, d, stance, this.tops);
    for (const p of this.tops) p.y += top;
    this.centre.y = top;
    const upper = feet[0] > feet[1] ? 0 : 1;
    const steps: [number, number, number][] = [
      [upper, t, t + TIME.step],
      [1 - upper, t + TIME.step, t + 2 * TIME.step],
    ];
    for (const [i, t0, t1] of steps) {
      const k = this.feet[i];
      const p = this.tops[i];
      k.along.key(t0, k.along.at(t0)).key(0.5 * (t0 + t1), -FOOT.out * s).key(t1, this.along(p));
      k.up.key(t0, k.up.at(t0)).key(0.5 * (t0 + t1), top + d.ankleHeight + FOOT.clear * s).key(t1, p.y);
      k.across.key(t0, k.across.at(t0)).key(t1, this.across(p));
      k.pitch.key(t0, k.pitch.at(t0)).key(0.5 * (t0 + t1), -0.2).key(t1, 0);
      k.toes.key(t0, k.toes.at(t0)).key(t1, 0);
      this.onTop[i] = t1;
    }
    const over = t + TIME.step;
    const both = t + 2 * TIME.step;
    this.end = both + TIME.stand;
    pv.along.key(over, -0.1 * s).key(both, this.along(this.centre) - 0.12 * s).key(this.end, this.along(_a.copy(this.centre).sub(this.off)));
    pv.up.key(over, top + d.ankleHeight + 0.62 * s).key(both, top + d.ankleHeight + 0.72 * s).key(this.end, top - this.off.y);
    pv.across.key(this.end, this.across(_a.copy(this.centre).sub(this.off)));
    this.leanTrack.key(over, 0.25).key(both, 0.2).key(this.end, 0);
    // (letting go as the body passes the stiles: the first hand as the foot comes down on top, the other as the body follows)
    for (let i = 0; i < 2; i++) this.hands[i].hold.key(over - 0.1 + 0.15 * i, 1).key(over + 0.15 + 0.15 * i, 0);
    this.phase = 'climb';
    this.t = 0;
  }

  update(g: Gait, dt: number): boolean {
    if (this.phase !== 'climb') return false;
    this.t += dt;
    const t = this.t;
    for (let i = 0; i < 2; i++) {
      if (t >= this.steps[i] && t < this.onTop[i]) this.lift(g.feet[i]);
      if (t >= this.onTop[i]) this.plant(g.feet[i], i);
    }
    if (t >= this.end) {
      this.finish(g);
      return false;
    }
    g.walk -= g.walk * Math.min(1, 6 * dt);
    const { root } = g;
    const p = this.point(this.pelvis.along.at(t), this.pelvis.up.at(t), this.pelvis.across.at(t), _a).add(this.off);
    root.x = p.x;
    root.y = p.y;
    root.z = p.z;
    g.velocity.set(0, 0, 0);
    this.lean = this.leanTrack.at(t);
    // (the eyes on the rungs ahead, a little above eye level; over the top as it comes up)
    const top = this.base.y + this.rungs * this.spacing;
    this.point(1, Math.min(this.pelvis.up.at(t) + LOOK * this.d.scale, top + 0.5), 0, this.look);
    // the hands wrapped over the rungs, the palms toward the ladder
    _fingers.copy(this.dir).multiplyScalar(0.6).addScaledVector(_up, 0.8);
    _palm.copy(this.dir).multiplyScalar(0.8).addScaledVector(_up, -0.6);
    for (let i = 0; i < 2; i++) {
      const h = this.hands[i];
      const hold = this.holds[i];
      hold.weight = h.hold.at(t);
      if (!h.along.empty) this.point(h.along.at(t), h.up.at(t), h.across.at(t), hold.pos);
      handRotation(_fingers, _palm, i === 0 ? 1 : -1, this.rots[i]);
    }
    return true;
  }

  /** a foot leaves the floor: the climb carries it */
  private lift(f: GaitFoot) {
    if (f.phase !== 'planted') return;
    const w = f.swing;
    f.phase = 'swing';
    w.s = 0;
    w.from.copy(f.pose.ankle);
    w.fromYaw = f.yaw;
    w.to.copy(this.tops[f.side > 0 ? 0 : 1]);
    w.toYaw = footYaw(this.yaw, f.side, this.stance);
    w.lift = w.clear = w.over = 0;
    w.pace = Infinity;
  }

  /** a foot set down on the top */
  private plant(f: GaitFoot, i: number) {
    if (f.phase !== 'swing') return;
    f.phase = 'planted';
    f.anchor.copy(this.tops[i]);
    f.yaw = f.swing.toYaw;
    f.landPitch = f.pose.pitch = f.pose.toePitch = f.kneeOut = 0;
    f.plantedTime = 0;
  }

  /** standing on the top: the gait takes over */
  private finish(g: Gait) {
    const { root } = g;
    root.x = this.centre.x;
    root.y = this.centre.y;
    root.z = this.centre.z;
    g.velocity.set(0, 0, 0);
    g.moving = false;
    this.reset();
  }

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
      f.kneeOut = 0;
      f.yaw = f.swing.toYaw;
      f.orient();
    }
  }

  private point(along: number, y: number, across: number, out: Vector3): Vector3 {
    return out.copy(this.base).addScaledVector(this.dir, along).addScaledVector(this.left, across).setY(y);
  }

  private along(p: Vector3): number {
    return (p.x - this.base.x) * this.dir.x + (p.z - this.base.z) * this.dir.z;
  }

  private across(p: Vector3): number {
    return (p.x - this.base.x) * this.left.x + (p.z - this.base.z) * this.left.z;
  }
}
