import { Quaternion, Vector3 } from 'three';
import { action, parallel } from '@pmndrs/timeline';
import type { Frame } from '../../core/body';
import { live, type Behaviour, type Live, type Placement, type Target } from '../../core/goal';
import { loadFactor } from '../../core/load';
import { when } from '../../core/when';
import { ARM_REACH, handTo } from '../arms';
import { INDEX, SIDES, type Side } from '../bones';
import { isPerson, type Humanoid } from '../humanoid';
import type { Body } from '../../core/body';
import { personOnly, take } from '../../core/hands';
import { pathAhead } from '../look';
import { gazeLead, withGaze } from '../../core/gaze';
import { forwardOf, headingOf, leftOf, pointSegmentDistance, wrapAngle } from '../../core/math';
import { arriving, route } from '../../core/walk';
import { held } from './grips';
import { gripOf } from '../../core/carrier';
import type { Grips } from '../../core/hands';
import { reachFor } from './reach';
import { bringShoulder } from '../reach-posture';
import { bowLever, lowering, MOST_BOW, SQUAT } from '../posture/posture';
import { problemOnce } from '../../core/dev';
import { defaultStance } from '../stance';

// Taking hold of things: walking up to them, the eyes and hands going ahead.

/** Where the body stands to take something: its grips' middle `ahead` of it (m) and `aside` to its left (m; negative: its right). */
export interface Spot {
  /** how far before it (m; default: in comfortable reach, or a full arm's reach for a deep object approached round its grips) */
  ahead?: number;
  /** how far to its left (m; negative: its right) */
  aside?: number;
}

/** How `grab` goes about it. */
export interface GrabOptions {
  /** the yaw to stand at (rad); by default the one that faces the grips square */
  face?: number;
  /** where to stand */
  spot?: Spot;
  /** where the eyes go: the grips' middle (`true`, the default), a point, or nowhere (`false`) */
  look?: boolean | Live<Vector3>;
  /** bow at least this much while reaching (rad) */
  bow?: number;
  /** the eyes there before the hands set off */
  first?: boolean;
  /** `false`: take them from where the body stands */
  walk?: boolean;
}

/** Comfortable stand distance as a share of arm length. */
const WITHIN = 0.8;
// Inherited low two-hand stand distance: 1.05 arm lengths, leaving room to bend.
const LOW_STAND = 1.05;
/** in reach without a step: each grip this near its shoulder on the floor's plane (× the arm's length: lower down, the body bows for it), the body facing within SQUARE (rad) of the way asked */
const IN_REACH = 0.65;
const SQUARE = 0.3;
/** arrived where it stands to take something: this near (m, default body), and come to rest or stood still this long (s) */
const ARRIVED = 0.12;
/** how far round what it takes the body walks when the way passes it (m, default body): past a stand's foot */
const ROUND = 0.5;
// Tuned progress around a support before the final leg (share of ROUND).
const ON = 0.5;
// Tuned frontal approach cone: lateral offset at most half the forward distance to the target.
const ROUND_ASIDE = 0.5;
// Proxy radius for other bodies’ low segments, not measured (m).
export const SEGMENT_RADIUS = 0.06;

/**
 * Taking hold of things, each step under way before the last is over: the body walks up to take
 * them; once they are in view, the eyes notice them, follow the path during a long approach, and return to them
 * within two steps of arriving (on the grips' middle, or `look`; `false`: not); within the last second, the hands set off toward them, the body
 * bowing and bending with the reach. It ends with the hands on the grips: hold on with
 * `hold` or `carry`. Reach waits until the final approach; `first: true` lets the eyes lead. `walk: false` takes them from where it
 * stands: the hands go straight to them (on them already, they close at once). Another body takes hold with the chain its
 * species names for the hand, one at a time (`Species.hands`): it walks up, the chain's tip reaches the grip, the hand closes.
 */
export function grab<H extends string>(h: Body<H>, holds: Grips<H>, options: GrabOptions = {}): Behaviour {
  if (!isPerson(h)) {
    personOnly('grab', options, ['face', 'spot', 'bow', 'first']);
    return take(h, holds, { look: options.look, walk: options.walk });
  }
  const { look = true, bow } = options;
  if (options.walk === false) return look === false ? reachFor(h, holds) : withGaze(h, look === true ? () => middleOf(holds) : look, reachFor(h, holds), { bow });
  return function* () {
    let stood = false;
    const reach = function* () {
      if (options.first && look !== false) yield* gazeLead(h, look === true ? () => middleOf(holds) : look)();
      yield* reachFor(h, holds)();
    };
    const preparing = arriving(h, LOWERING);
    const hands = () => parallel<Frame>('race', reach, function* () {
      yield* when((f: Frame) => stood || preparing(f));
      yield* action<Frame>({ update: (f) => held(holds).forEach(({ side, item, grip }) =>
        bringShoulder(h, f, side, item.toWorld(gripOf(item, grip), _world).position, 1, item.mass)) });
    });
    const walk = function* () {
      yield* approach(h, holds, options)();
      stood = true;
    };
    const near = arriving(h, LOOKING);
    const raising = arriving(h, 1);
    const com = new Vector3();
    const ahead = new Vector3();
    let noticed = NaN;
    let returning = false;
    // Two-step gaze horizon (research-contact §3 [R-s]); default-body distance proxy: 1.6 m [D].
    const close = (f: Frame) => flat(f.prev.com(com), middleOf(holds)) < 1.6 * h.scale;
    const seen = (f: Frame) => {
      const at = middleOf(holds);
      f.prev.com(com);
      return Math.abs(wrapAngle(headingOf(at.x - com.x, at.z - com.z) - h.locomotion.facing)) < IN_VIEW;
    };
    const target = look === true ? () => middleOf(holds) : look;
    const waitingHands = function* () {
      yield* when((f: Frame) => stood || (seen(f) && raising(f)));
      yield* parallel<Frame>('race', when((f: Frame) => stood || near(f)),
        () => parallel<Frame>('all', ...held(holds).map(({ side, item, grip }) => handTo(h, side, (f) => ({
          position: f.prev.position(INDEX[`${side}UpperArm`]).clone().lerp(item.toWorld(gripOf(item, grip), _world).position, 0.5),
        }), { lead: false }))));
      yield* hands();
    };
    yield* parallel<Frame>('all', walk, function* () {
      if (target === false) { yield* waitingHands(); return; }
      yield* when((f: Frame) => stood || seen(f));
      yield* withGaze(h, (f) => {
        if (Number.isNaN(noticed)) noticed = f.time;
        returning ||= close(f) || near(f);
        return stood || returning || f.time - noticed < LOOKING
          ? live(target, f)
          : pathAhead(h, f.prev, ahead);
      },
      waitingHands, { bow })();
    });
  };
}

/** Horizontal view cone (rad, ~80°): neck and head turn ~75°, with the eyes taking the rest.
 * Further aside, wait for the approach to turn the body before looking. */
const IN_VIEW = 1.4;

/** Minimum final-approach gaze lead (s); distance also brings the eyes back within two steps. */
const LOOKING = 0.6;
/** Tuned: both hands low down, how far (× the arm's length) beyond its toes the grips' middle is as it stands to take them, or to set down what they hold */
const LOW_AHEAD = 0.3, LOW_SETTING = 0.2;
/** Tuned: a placing point lower than this share of the arm's reach below the shoulders, the body lowers and bows for */
const STOOPING = 0.7;

/** how far (m) the shoulders come down, and on, lowered and bowed for `want` (m) down: as far as a squat and the deepest bow let them */
function stoop(p: Humanoid['proportions'], want: number): { drop: number; forward: number } {
  const lever = bowLever(p, p.shoulderHeight), most = SQUAT * p.height + lever * (1 - Math.cos(MOST_BOW));
  const drop = Math.min(want, most), { bow } = lowering(p, { drop, ahead: 0, height: p.shoulderHeight });
  return { drop, forward: lever * Math.sin(bow) };
}


/** Prepare the knees during the last landing (s before arrival). */
const LOWERING = 0.3;
/**
 * Walking up to grips or a placing point: to stand facing `face` with the grips' middle `spot` before
 * the body (default: in reach, squarely; facing so the left hand's grip is on the left, or toward a
 * single grip) — no step if every grip is in reach of its shoulder already. The last leg arrives
 * clear of the support and, for a rigid two-hand placement, within a cone of its facing
 * (aside at most half as far as ahead). A waypoint beside the
 * final leg opens that approach when the direct path would cut through the support or across the load. It ends there, turned and come to rest (or
 * stood still on planted feet a while: a step of a few cm the base may not take). The first half
 * of `grab`. A placing point is measured from the middle of the shoulders, rather than either
 * hand. A point must be within the arms' comfortable reach of that middle at the requested stand, the shoulders lowered and bowed as far as
 * a low point needs (at most a squat and the deepest bow); one out of reach even so, or no stand clear, is a problem in the dev log
 * and the body stands where it is. Grips may recruit
 * bowing and lowering during the reach. A destination placement uses the held grips at its
 * orientation to choose the facing, so both hands can reach it; a blocked explicit `face` is logged too; translation and rotation are followed live.
 */
export function approach(h: Humanoid, holds: Grips | Vector3 | Live<Placement>, options: { face?: number; spot?: Spot } = {}): Behaviour {
  const { aside = 0 } = options.spot ?? {};
  return function* () {
    const moving = typeof holds === 'function' ? holds : null;
    const source = live(holds, h.frame);
    const placed = source instanceof Vector3 || !(source.position instanceof Vector3) ? null : source as Placement;
    const start = moving && placed;
    const grips: { side?: Side; at: Vector3 }[] = [];
    const point = source instanceof Vector3 || !!placed;
    if (source instanceof Vector3) grips.push({ at: source.clone() });
    else if (placed) {
      const { position, quaternion } = placed;
      if (quaternion) for (const side of SIDES) {
        const held = h.holding[side];
        if (held) grips.push({ side, at: gripOf(held.item, held.grip).position.clone().applyQuaternion(quaternion).add(position) });
      }
      if (!grips.length) grips.push({ at: position.clone() });
    } else for (const { side, item, grip } of held(source as Grips)) grips.push({ side, at: item.toWorld(gripOf(item, grip), _world).position.clone() });
    const mass = !point ? Math.max(...held(source as Grips).map(({ item }) => item.mass)) : 0;
    let face = options.face ?? facingFor(h, grips);
    const p = h.proportions;
    const height = grips.reduce((sum, g) => sum + g.at.y, 0) / grips.length;
    const standing = (h.feet[0].position.y + h.feet[1].position.y) / 2 + p.shoulderHeight;
    const reach = ARM_REACH * p.armLength;
    // (a placing point low down the body lowers and bows for, as it does for a grip — as far as it must, at most squatting and bowing
    // its most: its shoulders that much lower and, bowed, that much further on)
    const { drop, forward } = point ? stoop(p, Math.max(0, standing - height - STOOPING * reach)) : { drop: 0, forward: 0 };
    const shoulders = standing - drop;
    const available = point ? Math.sqrt(Math.max(0, reach ** 2 - (height - shoulders) ** 2 - aside ** 2)) + forward : Infinity;
    // Tuned: bring heavier low grips closer as the load strategy caps trunk bow.
    const distance = !point && grips.length === 2 && height < p.hipHeight ? LOW_STAND / Math.sqrt(loadFactor(mass)) : WITHIN;
    // (both hands well below the hips — taking or setting down — it stands up to the load: no further beyond its toes than `LOW_AHEAD`
    // taking and `LOW_SETTING` setting down, the load before the shins as the knees bend)
    const low = grips.length === 2 && height < p.hipHeight - p.thigh / 2;
    const beyond = Math.max(0, height - p.ankleHeight), up = low ? Math.min(beyond, (point ? LOW_SETTING : LOW_AHEAD) * p.armLength) : beyond;
    const ahead = options.spot?.ahead ?? Math.min(distance * p.armLength, available, p.toeFront + up);
    const shoulder = (side?: Side) => side
      ? h.pose.position(INDEX[`${side}UpperArm`])
      : h.pose.position(INDEX.leftUpperArm).clone().add(h.pose.position(INDEX.rightUpperArm)).multiplyScalar(0.5);
    const middle = grips.reduce((sum, g) => sum.add(g.at), new Vector3()).divideScalar(grips.length);
    // (a point out of reach from anywhere it could stand, lowered and bowed its most, is a problem in the dev log, once: the body stays
    // standing where it is)
    if (point) {
      const distance = Math.hypot(Math.max(0, ahead - forward), aside, height - shoulders);
      if (options.spot ? distance > reach : Math.hypot(aside, height - shoulders) > reach) {
        yield* problemOnce({ check: `approach: placing point from the shoulders' middle, lowered and bowed (m)`, value: distance, limit: reach, where: `${grips.length} grips` })();
        return;
      }
    }
    const to = new Vector3(), there = new Vector3();
    const standAt = (yaw: number) => {
      to.copy(middle).addScaledVector(leftOf(yaw), -aside);
      there.copy(to).addScaledVector(forwardOf(yaw), -ahead);
    };
    // (the feet stand as far out as the stance has them, or the hips: a foot, not the root, keeps clear of another body's legs)
    const feetOut = Math.max(p.hipHalfWidth, defaultStance(p).width);
    const clear = () => h.frame.world.others(h).every((body) => {
      return body.skeleton.bones.every((bone, b) => {
        if (!b) return true;
        const a = body.position(bone.parent), end = body.position(b);
        // Low segments, including any crouched trunk, bound the space occupied near the feet.
        return Math.min(a.y, end.y) > p.hipHeight || pointSegmentDistance(there, a, end) >= feetOut + p.toeFront + SEGMENT_RADIUS;
      });
    });
    // Check the actual stand, including aside, before searching the nearest other facing (π/16).
    const clearFacing = () => {
      for (let i = 0; i <= (options.face === undefined ? 32 : 0); i++) {
        const yaw = face + Math.ceil(i / 2) * (i % 2 ? 1 : -1) * Math.PI / 16;
        standAt(yaw);
        if (clear()) return yaw;
      }
      return undefined;
    };
    const yaw = clearFacing();
    if (yaw === undefined) {
      yield* problemOnce({ check: options.face === undefined ? 'approach: no stand clear of nearby low segments' : 'approach: explicit face has a blocked stand', value: 1, limit: 0, where: `${grips.length} grips` })();
      return;
    }
    face = yaw;
    const turned = (yaw = face) => Math.abs(wrapAngle(yaw - h.locomotion.facing)) < SQUARE;
    if (options.spot === undefined && turned() && grips.every(({ side, at }) => flat(shoulder(side), at) < IN_REACH * p.armLength)) return;
    const rotation = (f: Frame) => {
      const current = moving ? live(moving, f) : null;
      return start?.quaternion && current?.quaternion
        ? current.quaternion.clone().multiply(start.quaternion.clone().invert())
        : new Quaternion();
    };
    const facing = (f: Frame) => {
      const forward = forwardOf(face).applyQuaternion(rotation(f));
      return headingOf(forward.x, forward.z);
    };
    const moved = (point: Vector3, f: Frame) => moving && start
      ? point.clone().sub(start.position).applyQuaternion(rotation(f)).add(live(moving, f).position)
      : point;
    const destination = (f: Frame) => moved(to, f);
    const body = h.pose.com(new Vector3()).setY(0);
    const way = there.clone().sub(body).setY(0);
    const length = way.length();
    const along = length > 0 ? middle.clone().sub(body).setY(0).dot(way) / length : 0;
    const nearest = body.clone().addScaledVector(way, along / Math.max(length, Number.EPSILON));
    const offset = body.clone().sub(there);
    const lateral = offset.dot(leftOf(face));
    const frontal = Math.abs(offset.dot(forwardOf(face)));
    // A rigid two-hand destination fixes the load's facing; otherwise the last leg need
    // only clear the support when the straight path passes through it.
    const entry = point && grips.length > 1 && Math.abs(lateral) > Math.max(ROUND * p.scale, ROUND_ASIDE * frontal);
    const blocked = along > 0 && along < length - ROUND * p.scale && flat(nearest, middle) < ROUND * p.scale;
    const via: Live<Vector3>[] = [];
    if (entry || blocked) {
      const yaw = entry ? face : headingOf(way.x, way.z);
      const anchor = entry ? there : middle.clone().addScaledVector(way, ON * ROUND * p.scale / length);
      const side = Math.sign(body.clone().sub(anchor).dot(leftOf(yaw))) || 1;
      const beside = anchor.clone().addScaledVector(leftOf(yaw), side * ROUND * p.scale);
      via.push((f) => moved(beside, f));
    }
    yield* route(h, { to: destination, face: facing, within: ahead, until: (f) => {
      const there = destination(f).clone().addScaledVector(forwardOf(facing(f)), -ahead);
      return turned(facing(f)) && flat(f.prev.com(_com), there) < ARRIVED * p.scale && (!h.locomotion.moving && h.feet.some((foot) => foot.phase === 'planted'));
    } }, via, true)();
  };
}

/** the middle of the grips `holds` take, where they are now */
function middleOf(holds: Grips | Vector3): Vector3 {
  if (holds instanceof Vector3) return holds.clone();
  const hands = held(holds);
  return hands.reduce((sum, { item, grip }) => sum.add(item.toWorld(gripOf(item, grip), _world).position), new Vector3()).divideScalar(hands.length);
}

/** the facing to take grips `grips` with: the left hand's to the left of the right's, or toward a single one from where the body stands */
function facingFor(h: Humanoid, grips: { side?: Side; at: Vector3 }[]): number {
  const left = grips.find((g) => g.side === 'left');
  const right = grips.find((g) => g.side === 'right');
  if (left && right) return Math.atan2(-(left.at.z - right.at.z), left.at.x - right.at.x);
  const at = grips[0].at;
  const body = h.pose.com(_com);
  return headingOf(at.x - body.x, at.z - body.z);
}

/** the distance between `a` and `b` on the floor's plane */
const flat = (a: Readonly<Vector3>, b: Readonly<Vector3>) => Math.hypot(a.x - b.x, a.z - b.z);

const _com = new Vector3();
const _world: Target & { velocity: Vector3; spin: Vector3 } = { position: new Vector3(), velocity: new Vector3(), spin: new Vector3() };
