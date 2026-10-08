import { Quaternion, Vector3 } from 'three';
import type { HandTask } from '../intent/tasks';
import { clamp, leftOf, lerp, yawOf } from '../math';
import type { Proportions } from '../proportions';
import { footYaw, type Stance } from '../stance';
import type { GaitFoot } from './foot';
import type { Gait, Root } from './gait';
import { HEEL_UP } from './jump';
import { crossing, faceAt, groundAt, steppable, type Crossing } from './obstacles';
import { footTracks, handRotation, Track, type Move } from './sequence';

/** walls vaulted: their tops (× height) beyond a hop onto, up to the chest; their depth at most (m, default body) */
const HEIGHT = { min: 0.4, max: 0.75 };
const DEPTH = 1;
/** the last footfall before the wall at least `near` from it takes off, if not more than `far` (m, default body); `last`: one closer still, as a last resort */
const TAKEOFF = { near: 0.7, far: 2, last: 0.35 };
/** the vault is judged over at least this speed (m/s, default body) */
const MIN_SPEED = 1.2;
/** the hand plants on the top this far past its near edge and out to its side, the wrist this far up (m, default body) */
const HAND = { along: 0.12, across: 0.16, up: 0.035 };
/** the hip joints pass this far over the top, the feet's soles this far (m, default body) */
const OVER = { hips: 0.16, feet: 0.08 };
/** the stance on the takeoff foot (s, walking → running), and the least time from takeoff to touchdown: a flight the hand helps along */
const STANCE = { walk: 0.28, run: 0.16 };
const FLIGHT = 0.42;
/** the least time the hips take to rise from takeoff to over the wall, and to fall from there to touchdown (s) */
const RISE = 0.2;
const FALL = 0.3;
/** the hand plants as the hip joints come this close to the wall (m, default body; − = before it): the shoulders within reach of the top */
const REACH = -0.6;
/** the lead foot lands this far ahead of the hip joints (m, default body); the pelvis then sinks (× height) over ABSORB s as the leg takes the weight */
const LEAD = 0.2;
const SINK = 0.035;
const ABSORB = 0.25;
/**
 * The legs sweep over the top to the side away from the hand (m, default body), the hips a
 * little that way; the trunk rolls onto the hand (rad); over the top the lead foot is ahead
 * of the hips and the takeoff foot tucked under them (m, default body); the lead knee turns out
 * over its side (rad)
 */
const SWEEP = { across: 0.25, hips: 0.06, roll: 0.35, lead: 0.35, trail: 0.15, knee: 0.9 };

type Phase = 'approach' | 'vault';

const _a = new Vector3();
const _b = new Vector3();
const _down = new Vector3(0, -1, 0);

/**
 * A speed vault over a wall too tall to step over and within reach of a hand (a floor
 * obstacle about waist high, as in parkour and third-person games): the walk or run goes on
 * toward it, a footfall within reach takes off, the hand on the near side plants on the top as
 * the other arm swings up, the hips pass just over it with the trunk leaning onto the hand and
 * the legs swept over to the far side, knees tucked, and the lead leg reaches down beyond it,
 * lands and runs on. From the takeoff footfall to just after the landing it owns the root, the
 * feet and the planted hand, along key poses warped to the wall and the body's speed.
 */
export class Vault implements Move {
  phase: Phase | null = null;
  lean = 0;
  roll = 0;
  arm = 0;
  heel = 0;
  readonly look = new Vector3();
  private readonly rot = new Quaternion();
  private readonly holds: [HandTask, HandTask] = [
    { pos: new Vector3(), rot: this.rot, weight: 0 },
    { pos: new Vector3(), rot: this.rot, weight: 0 },
  ];
  private readonly gap: Crossing = { box: null, enter: 0, exit: 0, dir: new Vector3() };
  /** the wall: its near top edge where the way meets it, into it (the facing), across it; its depth (m) */
  private readonly edge = new Vector3();
  private readonly dir = new Vector3();
  private readonly left = new Vector3();
  private yaw = 0;
  private depth = 0;
  /** time into the vault (s); its takeoff, touchdown, end; the speed carried (m/s); the takeoff foot */
  private t = 0;
  /** started this tick (its root moved on as walking) */
  private fresh = false;
  /** the takeoff, the lead foot's touchdown, the end (the gait takes over), the takeoff foot's footfall after it (s) */
  private readonly at = { takeoff: 0, touchdown: 0, end: 0, next: 0 };
  private speed = 0;
  private foot = 0;
  /** the side of the hand that plants (+1 left) */
  private side = 1;
  /** the hip joints' midpoint as last posed, and the root's offset from it as the vault began */
  private readonly hips = new Vector3();
  private readonly off = new Vector3();
  private readonly pelvis = { along: new Track(), up: new Track(), across: new Track() };
  private readonly tracks = { lean: new Track(), roll: new Track(), arm: new Track(), heel: new Track(), hold: new Track() };
  private readonly feet = [footTracks(), footTracks()];
  /** where the lead foot lands, and the takeoff foot after it */
  private readonly landing = new Vector3();
  private readonly next = new Vector3();

  constructor(
    private d: Proportions,
    private stance: Stance,
  ) {}

  get owns() {
    return this.phase === 'vault';
  }

  hold(s: number): HandTask | null {
    return this.holds[s].weight > 0 ? this.holds[s] : null;
  }

  reset() {
    this.phase = null;
    this.lean = this.roll = this.arm = this.heel = 0;
    for (const h of this.holds) h.weight = 0;
  }

  /** The target to walk to (as given): with a wall to vault on the way, a footfall within reach of it takes off. */
  aim(g: Gait, target: Root): Root {
    if (this.phase === null) this.find(g);
    if (this.phase !== 'approach') return target;
    const s = this.d.scale;
    // (the way no longer crosses it, or the body got past the takeoff: no vault)
    const ahead = g.ahead;
    const past = (ahead.x - this.edge.x) * this.dir.x + (ahead.z - this.edge.z) * this.dir.z < this.depth;
    if (past || this.along(_a.set(g.root.x, 0, g.root.z)) > -TAKEOFF.last * s) {
      this.reset();
      return target;
    }
    // (the next footfall, a step on, would be too close)
    const step = Math.max(g.speed, MIN_SPEED * s) * g.timing().stepT;
    for (let i = 0; i < 2; i++) {
      const f = g.feet[i];
      const a = this.along(f.anchor);
      if (f.phase !== 'planted' || f.plantedTime !== 0 || a > -TAKEOFF.last * s || a < -TAKEOFF.far * s) continue;
      if (a + step > -TAKEOFF.near * s) this.start(g, i);
    }
    return target;
  }

  /** a wall on the way to where the goal is heading, too tall to step over and low and thin enough to vault: go on toward it */
  private find(g: Gait) {
    const { d, root } = g;
    // (hands holding something: not over it, whatever it is)
    if (g.steer.handsBusy) return;
    const walls = g.steer.floorObstacles.filter((o) => !steppable(o, d) && o.max.y >= HEIGHT.min * d.height && o.max.y <= HEIGHT.max * d.height);
    const from = _a.set(root.x, 0, root.z);
    if (!walls.length || !crossing(walls, from, g.ahead, this.gap)) return;
    const box = this.gap.box;
    if (!box || this.gap.exit - this.gap.enter > DEPTH * d.scale) return;
    const p = from.addScaledVector(this.gap.dir, this.gap.enter);
    const f = faceAt(box, p, this.dir);
    this.depth = f < 2 ? box.max.x - box.min.x : box.max.z - box.min.z;
    this.yaw = yawOf(this.dir.x, this.dir.z);
    leftOf(this.yaw, this.left);
    this.edge.set(p.x, box.max.y, p.z);
    this.phase = 'approach';
  }

  /** a footfall within reach of the wall: plan the vault from the pose and speed it starts from */
  private start(g: Gait, foot: number) {
    const { d, stance } = this;
    const s = d.scale;
    const H = d.height;
    const h = this.edge.y;
    const D = this.depth;
    const run = g.run;
    const lead = 1 - foot;
    // (the hand on the takeoff foot's side plants; the legs pass over on the other)
    const side = (this.side = g.feet[foot].side);
    this.foot = foot;
    this.off.set(g.root.x, g.root.y, g.root.z).sub(this.hips);
    const a0 = this.along(this.hips);
    const y0 = this.hips.y;
    const u = (this.speed = Math.max(MIN_SPEED * s, g.velocity.x * this.dir.x + g.velocity.z * this.dir.z));
    const at = this.at;
    at.takeoff = lerp(STANCE.walk, STANCE.run, run);
    const t1 = at.takeoff;
    // (the hips highest over the wall's middle, the hand planted as the shoulders come within
    // reach of the top; touching down a fall after, clear of the far side)
    const tApex = Math.max(t1 + RISE, (0.5 * D - a0) / u);
    const plant = clamp((REACH * s - a0) / u, t1 - 0.05, tApex - 0.1);
    const clear = D + d.heelBack + 0.1 * s - LEAD * s;
    at.touchdown = Math.max(t1 + FLIGHT, tApex + FALL, (clear - a0) / u);
    at.end = at.touchdown + ABSORB;
    // (the takeoff foot comes down a step after the landing, as running on at this speed)
    at.next = Math.max(at.end + 0.08, at.touchdown + g.timing().stepT);
    const { touchdown: td, end } = at;
    const fly = td - t1;
    const apex = Math.max(y0 + 0.05 * s, h + OVER.hips * s);
    // (letting go as the hips pass over the wall's middle: the hand never trails behind the body)
    const release = Math.min(tApex - 0.02, td - 0.1);
    const pv = this.pelvis;
    pv.along.clear().key(0, a0, u).key(end, a0 + u * end, u);
    pv.up
      .clear()
      .key(0, y0)
      .key(0.5 * t1, y0 - 0.03 * s)
      .key(t1, y0 + 0.02 * s)
      .key(tApex, apex, 0)
      .key(td, y0 - 0.01 * s)
      .key(end, y0 - SINK * H, 0);
    pv.across.clear().key(0, this.across(this.hips)).key(tApex, -side * SWEEP.hips * s).key(td, 0);
    const k = this.tracks;
    k.lean.clear().key(0, 0).key(t1, 0.3).key(tApex, 0.35).key(td, 0.15).key(end, 0);
    // (the trunk leans onto the hand, the legs' side up)
    k.roll.clear().key(0, 0).key(t1, 0).key(tApex, -side * SWEEP.roll).key(td, 0);
    k.arm.clear().key(0, 0).key(t1, 0.8).key(tApex, 1.2).key(td, 0.6).key(end, 0);
    k.heel.clear().key(0.4 * t1, 0).key(t1, HEEL_UP).key(t1 + 0.1, 0);
    k.hold.clear().key(plant - 0.25, 0).key(plant, 1).key(release, 1).key(release + 0.1, 0);
    // the feet: over the top swept to the legs' side, the lead one ahead of the hips, the
    // takeoff one tucked under them; the lead lands beyond, the other comes through for the next step
    const floor = (p: Vector3) => groundAt(g.steer.ground, p.x, p.z) + d.ankleHeight;
    // (the hips go on at the speed carried, past the vault too)
    const hipsAt = (t: number) => a0 + u * t;
    // (when the hips are at `a`: they go at the speed carried)
    const when = (a: number, lo: number, hi: number) => clamp((a - a0) / u, lo, hi);
    const top = h + d.ankleHeight + OVER.feet * s;
    const near = -d.toeFront - 0.05 * s;
    const far = D + d.heelBack + 0.05 * s;
    this.point(hipsAt(td) + LEAD * s, 0, -side * stance.width, this.landing);
    this.landing.y = floor(this.landing);
    this.point(hipsAt(at.next) + LEAD * s, 0, side * stance.width, this.next);
    this.next.y = floor(this.next);
    for (const i of [lead, foot]) {
      const f = g.feet[i];
      const k = this.feet[i];
      const first = i === lead;
      const sweep = -side * SWEEP.across * s;
      // (the lead foot from where it is now, the takeoff foot from its push-off)
      const t0 = first ? 0 : t1;
      const ankle = first ? f.pose.ankle : f.ankleFor(f.anchor, f.yaw, -HEEL_UP, _b);
      const ahead = (first ? SWEEP.lead : SWEEP.trail) * s;
      const over = when(near - ahead, t1 + (first ? 0.04 : 0.1), td - 0.2);
      const beyond = when(far - ahead, over + 0.08, td - (first ? 0.1 : 0.04));
      const tuck = lerp(t0, over, 0.5);
      k.along.clear().key(t0, this.along(ankle)).key(tuck, hipsAt(tuck) + ahead - 0.1 * s).key(over, near).key(beyond, far);
      k.up.clear().key(t0, ankle.y).key(tuck, lerp(ankle.y, top, 0.7)).key(over, top).key(beyond, top);
      // (the lead foot out over its side, the takeoff foot under the body)
      const across = first ? f.side * stance.width + sweep : 0.2 * sweep;
      k.across.clear().key(t0, this.across(ankle)).key(over, across).key(beyond, across);
      k.pitch.clear().key(t0, first ? f.pose.pitch : -HEEL_UP).key(over, -0.3).key(beyond, -0.2);
      k.toes.clear().key(t0, first ? f.pose.toePitch : 0).key(over, -0.3).key(beyond, -0.2);
      // (the lead knee turned out over its side)
      const out = first ? SWEEP.knee : 0;
      k.out.clear().key(t0, first ? f.kneeOut : 0).key(over, out).key(beyond, out);
      const land = first ? this.landing : this.next;
      if (first) {
        k.along.key(td, this.along(land));
        k.up.key(td, land.y);
        k.across.key(td, this.across(land));
        k.pitch.key(td, 0.15);
        k.toes.key(td, 0.15);
        k.out.key(td, 0);
      } else {
        // (then down under the hips as they come down, and through, the knee forward: a running stride's recovery)
        const under = beyond + 0.5 * (end - beyond);
        k.along.key(under, Math.max(far + 0.05 * s, hipsAt(under) - 0.15 * s));
        k.up.key(under, land.y + 0.4 * s);
        k.along.key(end, Math.max(far + 0.1 * s, hipsAt(end)));
        k.up.key(end, land.y + 0.25 * s);
        k.across.key(end, this.across(land));
        k.pitch.key(end, 0);
        k.toes.key(end, 0);
        k.out.key(end, 0);
      }
    }
    this.lift(g.feet[lead], this.landing);
    this.phase = 'vault';
    this.t = 0;
    this.fresh = true;
  }

  update(g: Gait, dt: number): boolean {
    if (this.phase !== 'vault') return false;
    // (the tick it started on, the root still went on its way: the plan's clock counts it)
    this.t += this.fresh ? 2 * dt : dt;
    this.fresh = false;
    const { t, at } = this;
    const lead = g.feet[1 - this.foot];
    if (t >= at.takeoff) this.lift(g.feet[this.foot], this.next);
    if (t >= at.touchdown && lead.phase === 'swing') this.plant(g, lead);
    if (t >= at.end) {
      this.finish(g);
      return false;
    }
    const { root } = g;
    const p = this.point(this.pelvis.along.at(t), this.pelvis.up.at(t), this.pelvis.across.at(t), _a).add(this.off);
    if (dt > 0) g.velocity.set((p.x - root.x) / dt, 0, (p.z - root.z) / dt);
    root.x = p.x;
    root.y = p.y;
    root.z = p.z;
    const k = this.tracks;
    this.lean = k.lean.at(t);
    this.roll = k.roll.at(t);
    this.arm = k.arm.at(t);
    this.heel = k.heel.at(t);
    // the eyes on the top, then on where it lands and beyond
    this.point(lerp(0.1 * this.d.scale, this.depth + 3 * this.d.scale, clamp(t / at.touchdown, 0, 1)), 0.4 * this.d.height, 0, this.look);
    // the hand on the top, palm down, fingers ahead
    const h = this.holds[this.side > 0 ? 0 : 1];
    h.weight = k.hold.at(t);
    this.point(HAND.along * this.d.scale, this.edge.y + HAND.up * this.d.scale, this.side * HAND.across * this.d.scale, h.pos);
    handRotation(this.dir, _down, this.side, this.rot);
    return true;
  }

  /** a foot leaves the floor: the vault carries it to `to` */
  private lift(f: GaitFoot, to: Vector3) {
    if (f.phase !== 'planted') return;
    const w = f.swing;
    f.phase = 'swing';
    w.s = 0;
    w.from.copy(f.pose.ankle);
    w.fromYaw = f.yaw;
    w.to.copy(to);
    w.toYaw = footYaw(this.yaw, f.side, this.stance);
    w.lift = w.clear = w.over = 0;
    w.pace = Infinity;
  }

  /** the lead foot comes down beyond the wall */
  private plant(g: Gait, f: GaitFoot) {
    f.phase = 'planted';
    f.anchor.copy(this.landing);
    f.yaw = footYaw(this.yaw, f.side, this.stance);
    f.landPitch = f.pose.pitch = 0.15;
    f.kneeOut = 0;
    f.plantedTime = 0;
    g.lastLanded = g.feet.indexOf(f);
  }

  /** over and landed: the gait runs on, the takeoff foot swinging to its next footfall */
  private finish(g: Gait) {
    const { d } = this;
    const f = g.feet[this.foot];
    const w = f.swing;
    g.velocity.copy(this.dir).multiplyScalar(this.speed);
    g.moving = true;
    const t = g.timing();
    w.from.copy(f.pose.ankle);
    w.fromYaw = f.yaw;
    w.s = 0;
    w.duration = this.at.next - this.t;
    w.lift = 0.02 * d.scale;
    w.clear = w.over = 0;
    w.early = false;
    // (a planned footfall: not re-planned in the air)
    w.pace = this.speed;
    w.strikePitch = lerp(0.2, 0.12, t.run);
    f.kneeOut = 0;
    // (the step clock runs from the takeoff foot's push-off: the lead foot, landed, pushes off a
    // running stance after it came down, not a whole step after the vault)
    g.lastLift = this.foot;
    g.lastLiftAt = g.clock - (this.t - this.at.takeoff);
    this.reset();
  }

  pose(g: Gait, hips: readonly [Vector3, Vector3]) {
    this.hips.addVectors(hips[0], hips[1]).multiplyScalar(0.5);
    if (this.phase !== 'vault') return;
    const t = this.t;
    for (let i = 0; i < 2; i++) {
      const f = g.feet[i];
      if (f.phase !== 'swing') continue;
      const k = this.feet[i];
      this.point(k.along.at(t), k.up.at(t), k.across.at(t), f.pose.ankle);
      f.pose.pitch = k.pitch.at(t);
      f.pose.toePitch = k.toes.at(t);
      f.kneeOut = k.out.at(t);
      f.yaw = footYaw(this.yaw, f.side, this.stance) + f.side * 0.5 * f.kneeOut;
      f.orient();
    }
  }

  /** the point `along` out from the wall's near face (+ = over it), at height `y`, `across` it (+ = left), into `out` */
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
