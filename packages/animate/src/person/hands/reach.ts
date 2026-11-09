import { Quaternion, Vector3 } from 'three';
import { action, parallel } from '@pmndrs/timeline';
import type { Frame } from '../../kernel/frame';
import type { MovingFrame } from '../../kernel/moving-frame';
import { REACHED, REACHING, type Goal } from '../../kernel/goal';
import { lerp, pointSegmentDistance } from '../../kernel/math';
import { seeded, seedOf } from '../../kernel/random';
import { closeTo, lateReach, Progress, REACH, reached, unmet } from '../../kernel/limb';
import { during, type Miss, type Request } from '../../kernel/requests';
import { PointVelocity } from '../../kernel/follow';
import { CALM, HOLD, reaching } from './arms';
import { ARM_REACH } from './shoulder';
import { armReaches, footing, walkingToReach } from './standing-spot';
import { noticing } from '../../look/gaze';
import { INDEX, SIDES, type Side } from '../anatomy/bones';
import { paceAt, type HandOptions } from '../../body/hand-staging';
import { BODY_RADIUS } from './load-clearance';
import type { Person } from '../person';

/**
 * how long a calm reach `distance` away to take something takes (s; m, default body): Fitts' law, MT = a + b · log2(2 D / W) (recalled,
 * not checked: a ~0.25 s, b ~0.15 s/bit at everyday precision, a grip ~4 cm wide), varied ±10% (seeded by `seed`) — a 50 cm reach ~0.95
 * s peaking ~1 m/s, a 10 cm one ~0.6 s
 */
export function reachTime(distance: number, seed: number): number {
  const bits = Math.log2(Math.max(1, (2 * distance) / FITTS.width));
  return (FITTS.a + FITTS.b * bits) * (1 + FITTS.vary * (2 * seeded(seed)() - 1));
}

const FITTS = { a: 0.25, b: 0.15, width: 0.04, vary: 0.1 };

/** the hand that leads where both work (a right-handed body): the other goes a moment after it, a little slower */
export const LEADING: Side = 'right';
/** how much later (s) and slower (share of its pace) the other hand goes: not the leading hand's mirror image. (Hands reaching together
 * start within a few tens of ms of each other — Kelso, Southard & Goodman 1979, recalled, not checked; this is a little more, so the two
 * read apart.) */
const FOLLOWING = { delay: [0.06, 0.12], slower: [0.05, 0.1] };

/** how much later and slower the other hand goes for a thing `at` a place by its grips (seeded by them and where it is: the same each run) */
export function following(at: Readonly<Vector3>, grips: Partial<Record<Side, string>>) {
  const rand = seeded(seedOf(...SIDES.map((s) => grips[s] ?? ''), Math.round(at.x * 1000), Math.round(at.y * 1000), Math.round(at.z * 1000)));
  return { delay: lerp(FOLLOWING.delay[0], FOLLOWING.delay[1], rand()), slower: lerp(FOLLOWING.slower[0], FOLLOWING.slower[1], rand()) };
}

/** Follow targets with borrowed walking; replan after movement while keeping each hand's motion history. */
export function* reachingTo(person: Person, request: Request, targets: readonly { side: Side; target: (f: Frame) => Goal }[], pace: HandOptions) {
  const motion = paceAt(pace.speed, CALM);
  targets = targets.map(({ side, target }) => {
    const sample = new PointVelocity();
    let velocity = new Vector3();
    let time = NaN;
    return { side, target: (f: Frame) => {
      const goal = target(f);
      if (time !== f.time) {
        velocity = sample.read(goal.position, f.time - time, motion.speed);
        time = f.time;
      }
      // (an object's turn is only preferred: as far as the wrist goes, the hand's point on it from wherever the arm comes. `track` holds it exactly)
      return { ...goal, preferred: goal.quaternion !== undefined, velocity: goal.velocity ?? velocity };
    } };
  });
  const middleOf = (some: typeof targets) => (f: Frame) => some.reduce((sum, { target }) => sum.add(target(f).position), _middle.set(0, 0, 0)).divideScalar(some.length);
  const middle = middleOf(targets);
  // (the eyes on what does not ride with the body)
  const seen = targets.filter(({ target }) => target(person.frame).carriedBy !== person), eyes = () => noticing(person, request, middleOf(seen), { own: !seen.length });
  const there = (f: Frame) => targets.every(({ side, target }) => reached(f, person.hands[side], target(f)));
  // (the verdict as its story ends it, moving or not: as near as a stopped hand counts as there)
  request.there = () => targets.every(({ side, target }) => closeTo(person.frame, person.hands[side], target(person.frame)));
  let going: ReturnType<typeof handsGoing> | null = null, lasts = 0, stalled: Miss | null = null;
  let setOff = NaN, stirred = -Infinity;
  // (given `until`, a target on the move is followed till then, as a walk's is: a hand behind it has failed nothing, one off a target that
  // has stood still this long has)
  const moving = (f: Frame) => {
    if (pace.until === undefined) return false;
    if (targets.some(({ target }) => target(f).velocity!.length() > REACHED.speed)) stirred = f.time;
    return f.time - stirred < STILL;
  };
  yield* parallel<Frame>('all', function* () {
    for (;;) {
      // (each plan watched afresh: a stop close to a target gone since says nothing of the new place)
      let close = false;
      const late = lateWatch(person, request, targets.map(({ side, target }) => ({ side, goal: target, where: side })));
      const eta = (f: Frame) => {
        // Balance can interrupt the final reach with a support step; its time is not time spent failing to reach — a step's own, not the
        // whole of a stance that never settles
        if (stepping(person)) setOff += f.dt;
        request.eta = Math.max(0, setOff + lasts - f.time);
        moving(f);
        close = late(f, Math.max(setOff, stirred) + lasts);
      };
      const planned = targets.map(({ target }) => target(person.frame).position.clone());
      const moved = (f: Frame) => targets.some(({ target }, i) => target(f).position.distanceTo(planned[i]) > MOVED * person.scale);
      const inReach = targets.every(({ side }, i) => armReaches(person, planned[i], side, true));
      const held = targets.map(({ side }, i) => ({ side, at: planned[i].clone().sub(middle(person.frame)) }));
      const plan = inReach ? 'there' : footing(person, { place: (f) => ({ position: middle(f).clone(), quaternion: _turn }), held }, pace.step ?? true);
      const reachWalk = plan !== 'there' && 'walk' in plan ? plan : null;
      stalled = plan !== 'there' && 'nowhere' in plan ? plan.nowhere : null;
      let arrived = false;
      // (no stand in reach: the arm goes as far as it can as the body stands, the eyes on it, at the pace of a reach that far)
      if (stalled && Number.isNaN(setOff)) setOff = person.frame.time;
      if (!going) {
        going = handsGoing(person, targets.map(({ side, target }) => ({ side, target: (f: Frame) => stalled ? withinArm(person, f, side, target(f)) : target(f) })), pace.speed);
        lasts = Math.max(...going.map((hand) => hand.lasts));
      }
      const setsOff = (f: Frame) => {
        if (Number.isNaN(setOff) && (plan === 'there' || (reachWalk && reachWalk.walk.eta <= NEAR))) setOff = f.time;
        return !Number.isNaN(setOff);
      };
      if (!stalled) yield* parallel<Frame>('race', eyes(), function* () {
        yield* parallel<Frame>('all', action<Frame>({ until: setsOff }), function* () {
          if (!reachWalk) return;
          yield* parallel<Frame>('race', function* () {
            stalled = yield* walkingToReach(request, reachWalk, Math.max(0, lasts - NEAR));
          }, action<Frame>({ until: moved }));
        });
        if (!stalled) yield* action<Frame>({ update: eta, until: (f) => moved(f) || (arrived = close || there(f)) });
      });
      const stuck = (f: Frame) => { if (stalled && f.time >= setOff + lasts && !moving(f)) request.fail(stalled); };
      stuck(person.frame);
      if (arrived) request.met();
      if (arrived) yield* action<Frame>({ until: moved });
      else if (stalled) yield* parallel<Frame>('race', eyes(), action<Frame>({ update: stuck, until: moved }));
    }
  }, function* () {
    yield* action<Frame>({ until: () => !Number.isNaN(setOff) });
    yield* parallel<Frame>('all', ...(going ?? []).map(({ side, step }) => during(request, `hand.${side}`, 'asked', step)));
  });
}

/** `goal`, if further from hand `side`'s shoulder than the arm holds out, as far as the arm goes along the way to it: where a hand trying for what is out of reach goes */
export function withinArm(person: Person, f: Frame, side: Side, goal: Goal): Goal {
  const shoulder = f.prev.position(INDEX[`${side}UpperArm`]), way = goal.position.clone().sub(shoulder), most = ARM_REACH * person.proportions.armLength;
  return way.length() <= most ? goal : { ...goal, position: way.setLength(most).add(shoulder), velocity: undefined };
}

/** `targets`' hands going there at `speed` (none: as a calm reach that far), and how long each takes (s) */
export function handsGoing(person: Person, targets: readonly { side: Side; target: (f: Frame) => Goal }[], speed?: number) {
  const { accel } = paceAt(speed, CALM);
  return targets.map(({ side, target }) => {
    const distance = person.pose.position(person.hands[side]).distanceTo(target(person.frame).position);
    // (at an explicit hand speed, its joints keep to the moving point as briskly as to a held grip)
    if (speed !== undefined) return { side, step: reaching(person, side, target, { ...HOLD, accel, speed }), lasts: distance / speed + speed / accel };
    const seconds = reachTime(distance / person.scale, seedOf(side, Math.round(distance * 1000))) / person.tempo;
    return { side, step: reaching(person, side, target, { seconds }), lasts: seconds };
  });
}

/**
 * A reach's lateness, watched each sub-step against when it was planned to end (`ends`, s): past it, a hand off its goal that has
 * stopped closing on it makes the reach late at once, one still moving `REACHING` s on — the reach missed if a hand
 * is off its goal. While the legs are still stepping or settling under the hands, each is watched afresh: the body carrying a hand past
 * its goal and back is not the hand's own lack of progress. Returns whether every hand has stopped as near as counts as there.
 */
export function lateWatch(person: Person, request: Request, hands: readonly { side: Side; goal: (f: Frame) => Goal; on?: () => MovingFrame; where: string }[]) {
  const progress = hands.map(() => new Progress());
  let late = false, close = false;
  const within = (f: Frame) => hands.every(({ side, goal, on }) => closeTo(f, person.hands[side], goal(f), on?.()));
  return (f: Frame, ends: number): boolean => {
    if (close) return within(f);
    if (!person.locomotion.settled) progress.forEach((hand) => hand.reset());
    if (late || f.time <= ends) return false;
    const stopped = hands.some(({ side, goal, on }, k) => {
      const off = unmet(f, person.hands[side], goal(f), on?.());
      return (off.distance > REACHED.distance || off.angle > REACHED.angle) && progress[k].stopped(f, off);
    });
    if (!stopped && f.time <= ends + REACHING) return false;
    late = true;
    for (const { side, goal, on, where } of hands) {
      const miss = lateReach(f, person.hands[side], goal(f), where, on?.(), limitOf(person, side));
      if (miss) request.fail(miss);
    }
    return close = stopped && within(f);
  };
}

/**
 * what held hand `side` off a point `at` (world) it reached for, as the body stands: further than the arm held out straight from the
 * shoulder, or nearer the trunk than the arm is kept clear of it; else something within reach (a joint's range, the other hand, the
 * body's balance)
 */
export function limitOf(person: Person, side: Side): (at: Vector3) => string {
  return (at) => {
    const pose = person.pose, arm = person.proportions.armLength, shoulder = pose.position(INDEX[`${side}UpperArm`]).distanceTo(at);
    if (shoulder > REACH * arm) return `beyond the arm’s reach: the shoulder ${shoulder.toFixed(2)} m from it, the arm ${arm.toFixed(2)} m`;
    const hips = pose.position(0), chest = pose.position(INDEX.chest), clear = BODY_RADIUS * person.proportions.height;
    const trunk = pointSegmentDistance(at, hips, chest);
    if (trunk < 2 * clear) return `trunk clearance: it is ${trunk.toFixed(2)} m from the trunk’s axis, the arm kept ${clear.toFixed(2)} m clear of it`;
    return 'within reach: held off by a joint’s range, the other hand or the body’s balance';
  };
}

/** Artistic calibration: 0.6 s overlaps hand preparation with arrival without starting the reach a full stride away. */
const NEAR = 0.6;
/** Tuned: a target moved this far (m, default body) from where it was planned for is planned for again */
const MOVED = 0.1;
/** Tuned: how long (s) a target followed to `until` must stand still before a hand off it has failed */
const STILL = 2;
const _middle = new Vector3(), _turn = new Quaternion();

/** whether a foot is in the air under `person`: a support step under way */
const stepping = (person: Person) => person.stepper?.legs.some((leg) => leg.swing) ?? false;
