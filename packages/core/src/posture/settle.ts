import { Vector3 } from 'three';
import type { Gait } from '../gait/gait';
import type { GaitOverlay } from '../gait/overlay';
import { tracksBody, type Tasks } from '../intent/tasks';
import type { Tracker } from '../intent/tracker';
import { clamp, forwardOf, smoothstep, Spring, wrapAngle } from '../math';
import type { Proportions } from '../proportions';
import type { Stance } from '../stance';
import { PostureCost } from './cost';
import { SolveMemo } from './memo';
import type { Effort } from './lm';
import { createGiving, GIVE_WAY, giveWay, type Giving } from './giveway';
import { createTrunkFrame } from '../pose/frames';
import { NP, P, resetPosture, trunkCentre, trunkFK } from './trunk';

/** one warm-started step per tick, more while a step still lowers the cost by 10% */
const STEADY: Effort = { maxIterations: 3, minDecrease: 0.1 };
/** up to three steps when tracked targets jumped or the hands move fast */
const BURST: Effort = { maxIterations: 3, minDecrease: 0.01 };
/** smoothed hand-target speed that counts as fast (m/s) */
const FAST_HANDS = 1;
/** the posture parameters that follow the solution through springs */
const SMOOTHED = [P.YAW, P.DROP, P.SHIFT, P.HIP, P.SPINE, P.ROLL, P.TWIST, P.SIDE];
/** max speed per smoothed parameter (rad/s or m/s) — how fast a person moves each */
const MAX_RATE = [1.25, 0.55, 0.3, 1.25, 1.25, 1.0, 2.0, 0.25];
/**
 * how far the trunk's extrapolated centre of mass may run ahead of it (m): its speed over
 * ω0 = √(g / leg length); bending, twisting and shifting are paced to stay within it — or,
 * standing on both feet, within the base of support (a weight shift onto one foot)
 */
const TRUNK_LEAD = 0.114;
/** striding or striking, the pelvis turns at least this many times as fast as the facing turns */
const TURN_LEAD = 1.5;
/** turning fast, how far the pelvis turns ahead of the feet toward the facing turned to (rad) */
const PELVIS_LEAD = 0.4;
/** turning fast, how quickly the chest's facing follows the pelvis's, × the hands' pace (1/s) */
const CHEST_FOLLOW = 10;

const _c0 = new Vector3();
const _c1 = new Vector3();

/**
 * How do I hold myself where I am? One warm-started posture solve per tick with the root
 * where the gait put it, living with the gait's oscillations; then bodies have inertia:
 * the settled posture follows the solution through critically damped springs with human
 * speed limits — hands lead, the trunk follows; tracked bodies follow tightly, strikes and
 * kicks drive the trunk quickly — and gives way to body obstacles it lags into.
 */
export class Settle {
  /** the posture solution */
  private solved = new Float64Array(NP);
  /** the posture the body actually holds: the solved one, settled */
  readonly value = new Float64Array(NP);
  private springs = SMOOTHED.map(() => new Spring());
  private frame = createTrunkFrame();
  /** the settled posture a tick starts from */
  private start = new Float64Array(NP);
  /** scratch: a posture over the origin */
  private centred = new Float64Array(NP);
  private cost: PostureCost;
  /** solving again waits while the solution settled and its dependencies hold still */
  private memo = new SolveMemo();
  /** the facing last tick (rad) */
  private lastYaw = 0;
  /** the root's level last tick (m) */
  private lastLevel = 0;
  /** how far the chest's facing trails the posture's (rad, on the twist) */
  private chestLag = new Spring();
  /** what the settled posture gives way to */
  private giving: Giving;

  constructor(
    private d: Proportions,
    private stance: Stance,
    private gait: Gait,
    private tasks: Tasks,
    private overlay: GaitOverlay,
    private tracker: Tracker,
  ) {
    this.cost = new PostureCost(d, stance, tasks, gait.root, false, overlay.ridden, overlay);
    this.giving = createGiving(d, stance, overlay, tasks);
  }

  reset(x: number, z: number, yaw: number) {
    this.memo.forget();
    resetPosture(this.solved, x, z, yaw, this.stance.crouch);
    resetPosture(this.value, x, z, yaw, this.stance.crouch);
    SMOOTHED.forEach((k, i) => this.springs[i].reset(this.value[k]));
    this.lastYaw = yaw;
    this.chestLag.reset(0);
  }

  /** `legLift`: how far the legs lowered the pelvis last tick, for a tracked head to compensate */
  update(legLift: number, dt: number) {
    this.overlay.ride(this.tasks, this.gait, this.tracker.bob);
    // (a jump or climb holds the posture it set off with: its own curves shape it)
    if (!this.gait.jump.owns && !this.gait.move.owns) this.solve(legLift);
    this.follow(dt);
    // (the springs continue from where the body gave way)
    if (giveWay(this.value, this.giving, legLift + this.gait.root.y)) {
      for (let i = 0; i < SMOOTHED.length; i++) if (GIVE_WAY.includes(SMOOTHED[i])) this.springs[i].value = this.value[SMOOTHED[i]];
    }
  }

  private solve(legLift: number) {
    const { gait: g, tracker, cost } = this;
    const [left, right] = g.feet;
    const p = this.solved;
    p[P.X] = g.root.x;
    p[P.Z] = g.root.z;
    cost.footholds[0] = left.foothold();
    cost.footholds[1] = right.foothold();
    cost.ankles[0] = left.support();
    cost.ankles[1] = right.support();
    forwardOf(left.yaw, cost.toes[0]);
    forwardOf(right.yaw, cost.toes[1]);
    cost.walk = g.walk;
    cost.stepping = g.moving || left.phase === 'swing' || right.phase === 'swing';
    cost.lifted[0] = left.phase === 'lifted' ? left.liftWeight : 0;
    cost.lifted[1] = right.phase === 'lifted' ? right.liftWeight : 0;
    cost.legLift = legLift;
    cost.striking = smoothstep(1, 2, this.tracker.pace);
    cost.lunging = g.striding;
    // (turning fast, the pelvis leads the feet)
    cost.yawLead = PELVIS_LEAD * clamp(wrapAngle(g.goalYaw - g.root.yaw) / PELVIS_LEAD, -1, 1) * smoothstep(1, 2, g.turnPace);
    this.updateOneLeg();
    const burst = tracker.jumped || tracker.handSpeed > FAST_HANDS;
    cost.minimize(p, burst ? BURST : STEADY, this.memo);
  }

  /**
   * Standing on one leg puts the pelvis over that foot: with a foot target (a kick, a step
   * onto something) the pelvis is preferred over the other, planted foot, as far as the
   * lifted foot's weight goes. Zero with both feet down. Writes `oneLeg`.
   */
  private updateOneLeg() {
    const { tasks: t, gait: g } = this;
    const { oneLeg: out, footholds } = this.cost;
    out.shift = out.side = 0;
    const yaw = g.root.yaw + this.stance.blade;
    for (let s = 0; s < 2; s++) {
      // (a striding foot is falling forward onto: the pelvis goes along, not back over the other)
      const w = (t.feet[s]?.weight ?? 0) * (1 - g.feet[s].striding);
      if (w <= 0) continue;
      const foot = footholds[1 - s];
      const dx = foot.x - g.root.x;
      const dz = foot.z - g.root.z;
      out.shift += w * (dx * Math.sin(yaw) + dz * Math.cos(yaw));
      out.side += w * (dx * Math.cos(yaw) - dz * Math.sin(yaw));
    }
  }

  /** move toward the solution; the root position is the gait's */
  private follow(dt: number) {
    const { solved, tasks: t } = this;
    const settled = this.value;
    const lag = this.chestLag;
    settled[P.TWIST] -= lag.value;
    // (getting on or off a mount, the root moves from beside it onto it under the body: the pelvis stays where it was, but for the mount's travel)
    if (t.mount && t.mount.weight < 1) this.stay(settled);
    this.lastLevel = this.gait.root.y;
    const start = this.start;
    start.set(settled);
    const before = this.settledCentre(_c0);
    const tracked = tracksBody(t);
    // (a tracked head or chest is met by the whole trunk; a tracked pelvis position only by
    // where the pelvis is and faces — the trunk above it moves at its own pace)
    const trunkTracked = !!(t.head || t.chest || t.hips?.rot);
    // (a stride is no kick: the body goes along with it at its own pace)
    const [l, r] = this.gait.feet;
    const kicking = Math.max((t.feet[0]?.weight ?? 0) * (1 - l.striding), (t.feet[1]?.weight ?? 0) * (1 - r.striding));
    // (untracked bodies follow unhurriedly: ~0.3 s; strikes and kicks are the exception, and
    // ducking under something goes at twice the pace)
    const quick = 1 + this.cost.duck;
    const pace = this.gait.pace;
    const yaw = this.gait.root.yaw;
    const turning = dt > 0 ? Math.abs(wrapAngle(yaw - this.lastYaw)) / dt : 0;
    this.lastYaw = yaw;
    const unhurried = (4.5 + clamp(this.tracker.handSpeed * 5, 0, 14) + 12 * kicking) * quick * pace;
    const scale = this.d.scale;
    for (let i = 0; i < SMOOTHED.length; i++) {
      const k = SMOOTHED[i];
      const sp = this.springs[i];
      const linear = k === P.DROP || k === P.SHIFT || k === P.SIDE;
      // (riding, the pelvis faces as the mount carries it)
      const tight = (tracked && (trunkTracked || linear || k === P.YAW)) || (!!t.mount && k === P.YAW);
      const omega = tight ? 30 : unhurried;
      let target = k === P.YAW ? sp.value + wrapAngle(solved[k] - sp.value) : solved[k];
      // human speed limits per degree of freedom: cap the spring's pull (chasing a target
      // held `reach` ahead, a critically damped spring settles at ω·reach/2) rather than
      // clamping its output, so there's no velocity kink — this also rides out the
      // optimiser switching strategy (e.g. squat ↔ hinge)
      // (a kick shifts the weight onto the standing foot at once)
      const weightShift = k === P.SHIFT || k === P.SIDE ? 1 + 2 * kicking : 1;
      let maxRate = MAX_RATE[i] * (tight ? (k === P.DROP ? 4 : 2.5) : weightShift * quick * pace) * (linear ? scale : 1);
      // (striding or striking, the pelvis keeps up with the facing turning over the feet: the hips open)
      if (k === P.YAW && pace > 1) maxRate = Math.max(maxRate, TURN_LEAD * turning);
      const reach = (2 * maxRate) / omega;
      target = sp.value + clamp(target - sp.value, -reach, reach);
      settled[k] = sp.step(target, omega, dt);
    }
    // the trunk's centre of mass moves no faster than balance allows (riding, the mount and the hands on it hold it)
    const step = this.settledCentre(_c1).sub(before).setY(0);
    const moved = step.length();
    const max = this.trunkLead(before, step, moved) * this.gait.capture.omega * dt;
    if (dt > 0 && moved > max && !t.mount) {
      const k = max / moved;
      for (let i = 0; i < SMOOTHED.length; i++) {
        const dof = SMOOTHED[i];
        if (dof === P.YAW) continue;
        const sp = this.springs[i];
        sp.value = start[dof] + (sp.value - start[dof]) * k;
        sp.velocity *= k;
        settled[dof] = sp.value;
      }
    }
    // turning fast (a strike, a throw, a stride put down), proximal to distal: the pelvis
    // turns first and the chest's facing trails it, taking the turn up the quicker the hands
    // go — the hips lead, the shoulders follow, the arm whips last
    lag.value -= smoothstep(1, 2, this.gait.turnPace) * (settled[P.YAW] - start[P.YAW] + settled[P.TWIST] - start[P.TWIST]);
    settled[P.TWIST] += lag.step(0, CHEST_FOLLOW * this.tracker.pace, dt);
    settled[P.X] = this.gait.root.x;
    settled[P.Z] = this.gait.root.z;
  }

  /** the pelvis's offsets from the root moved by as much as the root moved since last tick (beyond the mount's own travel), the other way */
  private stay(settled: Float64Array) {
    const { root, mount } = this.gait;
    const dx = root.x - settled[P.X] - mount.moved.x;
    const dz = root.z - settled[P.Z] - mount.moved.z;
    const yaw = settled[P.YAW] + this.stance.blade;
    const back = (k: (typeof SMOOTHED)[number], by: number) => {
      settled[k] -= by;
      this.springs[SMOOTHED.indexOf(k)].value -= by;
    };
    back(P.SHIFT, dx * Math.sin(yaw) + dz * Math.cos(yaw));
    back(P.SIDE, dx * Math.cos(yaw) - dz * Math.sin(yaw));
    back(P.DROP, this.lastLevel + mount.moved.y - root.y);
  }

  /**
   * How far the trunk's extrapolated centre of mass may lead it, moving from `centre` (over
   * the root) by `step` (`moved` long): TRUNK_LEAD, or further while the feet reach further
   * that way (a weight shift across a stance) — on one foot, only as far as that foot reaches.
   */
  private trunkLead(centre: Vector3, step: Vector3, moved: number): number {
    const { root, feet, capture } = this.gait;
    const [a, b] = feet;
    if (moved <= 0 || a.phase === 'swing' || b.phase === 'swing') return TRUNK_LEAD;
    const x = root.x + centre.x;
    const z = root.z + centre.z;
    const dx = step.x / moved;
    const dz = step.z / moved;
    // (a striding foot holds the body where it is being put down)
    const pa = a.support();
    const pb = b.support();
    if (!pa) return pb ? capture.room(x, z, dx, dz, pb, b.yaw, null, 0) : TRUNK_LEAD;
    if (!pb) return capture.room(x, z, dx, dz, pa, a.yaw, null, 0);
    return Math.max(TRUNK_LEAD, capture.room(x, z, dx, dz, pa, a.yaw, pb, b.yaw));
  }

  /** the trunk's centre of mass with the settled posture placed over the origin */
  private settledCentre(out: Vector3): Vector3 {
    const p = this.centred;
    p.set(this.value);
    p[P.X] = p[P.Z] = 0;
    trunkFK(p, this.d, this.stance, this.frame);
    return trunkCentre(this.frame, out);
  }
}
