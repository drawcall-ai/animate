import { Vector3 } from 'three';
import { eyesOf, jointOf } from './actor';
import { Peak, type Frame } from './frame';
import { aroundTheTrunk } from './clearance';

/**
 * How closely the eyes are on what the script asks them to look at, and the hands stay on what
 * they hold or track: each palm off its grip (the item's grip in the world as the item is now), each wrist off
 * its tracked target (`leftWrist`, `rightWrist`), while that is within reach (the arm's length +
 * 0.35 m of the shoulder: one further off is walked to, by design); the eyes' midpoint off a
 * tracked head's (`head`: a headset).
 */
export class Targets {
  private readonly wristPeak = new Peak();
  /** the most the eyes turn in the head to the gaze target (°), and the longest the target stays past the comfortable turn by `PAST` (s) */
  readonly eyesPeak = new Peak();
  readonly pastPeak = new Peak();
  private past = NaN;
  /** how far a tracked target's error goes past the bound its course sets (m; see `judge`), and on which target and course */
  readonly over = { value: -Infinity, at: 0, what: '' };
  private readonly wrists = { left: new Course(), right: new Course() };
  private readonly heads = new Course();
  /** frames a gaze was asked, and frames it was judged in */
  asked = 0;
  judged = 0;
  /** frames a tracked wrist target was asked (per wrist), and judged (within reach); frames a tracked head was asked (all judged) */
  tracked = { asked: 0, judged: 0, head: 0 };
  /** the gaze target asked (as it was last step), and since when (s) */
  private goal: { target: Vector3; since: number } | null = null;
  /** the largest error of a hand off the grip of what it holds (m) */
  get wrist() {
    return this.wristPeak.value;
  }
  get wristAt() {
    return this.wristPeak.at;
  }

  see({ t, h, asked }: Frame) {
    const gaze = asked.get('gaze');
    if (!(gaze instanceof Vector3)) this.goal = null;
    else {
      // (a target that jumps is a new one, settled on afresh; one moving smoothly is followed and judged)
      if (!this.goal || this.goal.target.distanceTo(gaze) > JUMP) this.goal = { target: gaze.clone(), since: t };
      else this.goal.target.copy(gaze);
      const head = h.turn('head');
      const forward = new Vector3(0, 0, 1).applyQuaternion(head);
      // (judged unless truly behind the body: behind the frontal plane through the hips — a bowed body's
      // own buckle, below and behind its eyes, is judged)
      const toward = gaze.clone().sub(eyesOf(h));
      const seen = ahead(h, gaze);
      this.asked++;
      if (seen && t - this.goal.since > SETTLE) {
        this.judged++;
        const off = (forward.angleTo(toward) * 180) / Math.PI;
        const beyond = beyondEyes(toward.applyQuaternion(head.invert()), off);
        this.eyesPeak.see(off, t);
        // (how long on end the target lies past the comfortable turn by more than `PAST`: a brief eccentric glance as the head comes
        // round is normal, a held one is not)
        this.past = beyond > PAST ? (Number.isNaN(this.past) ? t : this.past) : NaN;
        if (!Number.isNaN(this.past)) this.pastPeak.see(t - this.past + DT, t);
      }
    }
    const head = positionOf(asked.get('head'));
    if (head) {
      this.tracked.head++;
      const error = eyesOf(h).distanceTo(head);
      this.judge(this.heads, head, error, false, t, 'head');
    } else this.heads.reset();
    for (const s of ['left', 'right'] as const) {
      const target = positionOf(asked.get(`${s}Wrist`));
      const course = this.wrists[s];
      // (one behind the frontal plane through the hips is not yet asked of the hand, as the gaze above: the hand goes round the front
      // of the trunk as the body turns to it, not straight for it through or round the back)
      if (!target || !ahead(h, target)) { course.reset(); continue; }
      this.tracked.asked++;
      const shoulder = jointOf(h, `${s}UpperArm`).distanceTo(target), arm = h.proportions.armLength;
      if (shoulder >= arm + 0.35) { course.reset(); continue; }
      this.tracked.judged++;
      jointOf(h, `${s}Hand`, _v);
      // (judged on as much of it as a hand reaches standing: no lower than the floor lets the wrist, no higher than the arm raised flat-footed)
      const p = h.proportions, reached = _r.copy(target).setY(Math.min(Math.max(target.y, FLOOR * p.scale), p.shoulderHeight + p.armLength));
      const stepping = h.locomotion.moving || h.feet.some((foot) => foot.phase === 'swing');
      this.judge(course, target, _v.distanceTo(reached), shoulder <= REACHABLE * arm, t, `${s}Wrist`, Math.max(0, shoulder - REACHABLE * arm), aroundTheTrunk(h, s, reached), stepping);
    }
    for (const s of ['left', 'right'] as const) {
      const grip = h.holding[s]?.grip;
      if (!grip) continue;
      if (jointOf(h, `${s}UpperArm`).distanceTo(grip) >= h.proportions.armLength + 0.35) continue;
      this.wristPeak.see(jointOf(h, `${s}Palm`, _v).distanceTo(grip), t);
    }
  }

  /**
   * A tracked target judged by its course, not by one fixed bound: at a hold (still for `HOLD.after` s) within `HOLD.within`; moving or
   * just stopped, behind it at most as far as it goes in `LAG.time` plus `LAG.within` (the hand or head lags a moving target, more so
   * while the body steps after it) plus, for a wrist whose straight reach would cut its own trunk, how much longer its way round the
   * front is (`around`: the hand goes round, not through); within `REACHABLE` of the arm's length of its shoulder — a wrist's, reached without a step —
   * within `LAG.within` too once it has been there `LAG.settle` s; held out of that reach, as near as the arm goes plus `LAG.within`.
   * A tracked head is placed by the whole body, bowing and turning: held, within `HOLD.head`.
   */
  private judge(course: Course, target: Vector3, error: number, reachable: boolean, t: number, what: string, beyond = 0, around = 0, stepping = false) {
    const held = what === 'head' ? HOLD.head : reachable ? HOLD.within : undefined;
    // (one that appears or jumps is a new one: reached for afresh, judged once a reach's time is up)
    if (!course.at || course.at.distanceTo(target) > JUMP) [course.fresh, course.still, course.reachable, course.walked] = [t, t, NaN, false];
    const speed = course.at ? course.at.distanceTo(target) / Math.max(1e-6, t - course.t) : 0;
    course.at ??= new Vector3();
    course.at.copy(target);
    course.t = t;
    if (t - course.fresh < MOVE) return;
    if (speed > STILL) course.still = NaN;
    else if (Number.isNaN(course.still)) course.still = t;
    if (!reachable) course.reachable = NaN;
    else if (Number.isNaN(course.reachable)) course.reachable = t;
    // (one held still that the body steps toward is walked to: the hand sets off for it in the last step — read, abstracts only: reach
    // onset after an ipsilateral heel contact, the last step before the grasp the one it changes; Rinaldi & Moraes 2015, Hum Mov Sci
    // 40:38, and later work — and it is judged once the body has stood `HOLD.after` s, as a hold is once its target stops)
    if (stepping) [course.stood, course.walked] = [NaN, true];
    else if (Number.isNaN(course.stood)) course.stood = t;
    if (course.walked && !Number.isNaN(course.still) && !(t - course.stood >= HOLD.after)) return;
    let bound = speed * LAG.time + LAG.within + around, kind = 'lag';
    if (t - course.reachable >= LAG.settle) [bound, kind] = [LAG.within, 'reachable'];
    // (held still out of reach without a step, it is reached for as far as the arm goes while the body comes)
    if (t - course.still >= HOLD.after) [bound, kind] = held === undefined ? [beyond + LAG.within, 'held out of reach'] : [held, 'hold'];
    if (error - bound > this.over.value) Object.assign(this.over, { value: error - bound, at: t, what: `${what} ${kind}` });
  }
}

/** whether `point` is in front of the frontal plane through the hips */
function ahead(h: Frame['h'], point: Vector3): boolean {
  const facing = new Vector3(0, 0, 1).applyQuaternion(h.turn('hips')).setY(0);
  return point.clone().sub(h.joint('hips')).dot(facing) > 0;
}

/** where a goal asked is: a point, or a placement's */
function positionOf(goal: unknown): Vector3 | null {
  if (goal instanceof Vector3) return goal;
  if (typeof goal === 'object' && goal !== null && 'position' in goal && goal.position instanceof Vector3) return goal.position;
  return null;
}

const _v = new Vector3(), _r = new Vector3();
/** the lowest a wrist comes to the floor, the hand flat on it (m, at scale 1) */
const FLOOR = 0.05;

/** a tracked target's course as last seen: where and when, since when it has stood still and been within reach without a step (NaN: not) */
class Course {
  at: Vector3 | null = null;
  t = 0;
  fresh = NaN;
  still = NaN;
  reachable = NaN;
  /** since when the body has stood, no foot stepping (NaN: stepping), and whether it has stepped since the target was asked */
  stood = NaN;
  walked = false;
  reset() { [this.at, this.still, this.reachable, this.stood, this.walked] = [null, NaN, NaN, NaN, false]; }
}

/**
 * How closely a tracked target is followed (see `Targets.judge`): a target moving at v is followed at most
 * v × `LAG.time` + `LAG.within` behind — `LAG.time` the reach
 * scene's own glance lead, about a visuomotor delay plus a step (recalled: gait initiation ~0.5 s, visuomotor ~0.15–0.25 s);
 * within `REACHABLE` × the arm's length of the shoulder (reached without a step) within `LAG.within` once `LAG.settle` s there; a held
 * target (slower than `STILL` m/s) within `HOLD.within` once `HOLD.after` s still (a reach's homing phase ends ~0.5 s after the
 * target stops: recalled, minimum-jerk corrective submovements). Tuned values, not read from a source.
 */
const LAG = { time: 0.35, within: 0.05, settle: 0.3 }, HOLD = { within: 0.03, head: 0.05, after: 0.6 }, REACHABLE = 0.9, STILL = 0.02;
/** how long a reach for a target that appears or jumps takes before it is judged (s): a calm reach's own (the scenes ask 1 s) */
const MOVE = 1;
/**
 * How far the eyes turn in the head comfortably (°): down to the preferred declination of the line
 * of sight below the head's (29° sitting upright, 34° over all postures: Hill & Kroemer 1986, Human
 * Factors 28:127); up and to the side about half the eye-only range of head-free gaze shifts (36°
 * wide on average: Stahl 1999, Exp Brain Res 126:41; measured horizontally, taken for up as well)
 * — an ellipse round the head's forward.
 */
const EYES = { down: 30, up: 20, side: 20 };

/**
 * how far (°) a target the head faces `off` (°) away from, at `local` in the head's frame (+z
 * ahead, +y up), lies beyond what the eyes turn comfortably (`EYES`): 0 within it
 */
export function beyondEyes(local: Vector3, off: number): number {
  if (local.z <= 0) return off - EYES.side;
  const side = (Math.atan2(local.x, local.z) * 180) / Math.PI;
  const down = (Math.atan2(-local.y, Math.hypot(local.x, local.z)) * 180) / Math.PI;
  const s = Math.hypot(side / EYES.side, down / (down > 0 ? EYES.down : EYES.up));
  return s > 1 ? off * (1 - 1 / s) : 0;
}

/** how far past the eyes' comfortable turn a gaze target may lie for a moment (°), and the length of a frame (s) */
export const PAST = 5;
const DT = 1 / 60;

/** how long a gaze target stays put before the eyes are judged on it (s): a gaze shift takes ~0.3–0.5 s */
const SETTLE = 0.6;
/** how far a gaze target moves in one step to count as a new one (m): a jump, not a motion (5 cm in 1/60 s is 3 m/s) */
const JUMP = 0.05;
