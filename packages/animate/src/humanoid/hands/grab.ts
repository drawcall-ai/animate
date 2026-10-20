import { Quaternion, Vector3 } from 'three';
import { action, parallel } from '@pmndrs/timeline';
import type { Frame } from '../../core/body';
import { live, type Behaviour, type Live, type Placement, type Target } from '../../core/goal';
import type { World } from '../world';
import { loadFactor } from '../../core/load';
import { when } from '../../core/when';
import { ARM_REACH, handTo } from '../arms';
import { INDEX, SIDES, type Side } from '../bones';
import type { Humanoid } from '../humanoid';
import { gazeLead, pathAhead, withGaze } from '../look';
import { forwardOf, headingOf, leftOf, pointSegmentDistance, wrapAngle } from '../../core/math';
import { arriving, route } from '../walk';
import { gripOf, held, type Holds } from './grips';
import { reachFor } from './reach';
import { bringShoulder } from '../reach-posture';

// Taking hold of things: walking up to them, the eyes and hands going ahead.

/** Where the body stands to take something: its grips' middle `ahead` of it (m) and `aside` to its left (m; negative: its right). */
export interface Spot {
  /** Metres before the target, or the library's full arm reach for a deep object approached around its grips. */
  ahead?: number;
  aside?: number;
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
 * them (`approach`); once they are in view (IN_VIEW), one gaze notices them, follows the path during a long approach, and returns within two steps or LOOKING s before arrival to
 * them (`withGaze`: on the grips' middle, or `look`; `false`: not); within the last estimated second, the hands set off toward them; the body bows and bends with the reach (`reachFor`). It ends with the hands on the grips: hold on with
 * `hold` or `carry`. Reach waits until the final approach; `first: true` lets the eyes lead.
 */
export function grab<W extends World>(h: Humanoid<W>, holds: Holds, options: { face?: number; spot?: Spot; look?: boolean | Live<Vector3, W>; bow?: number; first?: boolean } = {}): Behaviour<W> {
  const { look = true, bow } = options;
  return function* () {
    let stood = false;
    const reach = function* () {
      if (options.first && look !== false) yield* gazeLead(h, look === true ? () => middleOf(holds) : look)();
      yield* reachFor(h, holds)();
    };
    const preparing = arriving(h, LOWERING);
    const hands = () => parallel<Frame<W>>('race', reach, function* () {
      yield* when((f: Frame<W>) => stood || preparing(f));
      yield* action<Frame<W>>({ update: (f) => held(holds).forEach(({ side, item, grip }) =>
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
    const close = (f: Frame<W>) => flat(f.prev.com(com), middleOf(holds)) < 1.6 * h.scale;
    const seen = (f: Frame<W>) => {
      const at = middleOf(holds);
      f.prev.com(com);
      return Math.abs(wrapAngle(headingOf(at.x - com.x, at.z - com.z) - h.locomotion.facing)) < IN_VIEW;
    };
    const target = look === true ? () => middleOf(holds) : look;
    const waitingHands = function* () {
      yield* when((f: Frame<W>) => stood || (seen(f) && raising(f)));
      yield* parallel<Frame<W>>('race', when((f: Frame<W>) => stood || near(f)),
        () => parallel<Frame<W>>('all', ...held(holds).map(({ side, item, grip }) => handTo(h, side, (f) => ({
          position: f.prev.position(INDEX[`${side}UpperArm`]).clone().lerp(item.toWorld(gripOf(item, grip), _world).position, 0.5),
        }), { lead: false }))));
      yield* hands();
    };
    yield* parallel<Frame<W>>('all', walk, function* () {
      if (target === false) { yield* waitingHands(); return; }
      yield* when((f: Frame<W>) => stood || seen(f));
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
/** Prepare the knees during the last landing (s before arrival). */
const LOWERING = 0.3;
/**
 * Walking up to grips or a placing point: to stand facing `face` with the grips' middle `spot` before
 * the body (default: in reach, squarely; facing so the left hand's grip is on the left, or toward a
 * single grip) — no step if every grip is in reach of its shoulder already. The last leg arrives
 * clear of the support and, for a rigid two-hand placement, within a cone of its facing
 * (lateral offset at most ROUND_ASIDE of forward distance). A waypoint ROUND beside the
 * final leg opens that approach when the direct path would cut through the support or across the load. It ends there, turned and come to rest (or
 * stood still on planted feet a while: a step of a few cm `balance` may not take). The first half
 * of `grab`. A placing point is measured from the middle of the shoulders, rather than either
 * hand. A point must be within ARM_REACH of that middle at the requested stand (at the
 * shoulders' standing height); an impossible stand throws before walking. Grips may recruit
 * bowing and lowering during the reach. A destination placement uses the held grips at its
 * orientation to choose the facing, so both hands can reach it; a blocked explicit `face` throws; translation and rotation are followed live.
 */
export function approach<W extends World>(h: Humanoid<W>, holds: Holds | Vector3 | Live<Placement, W>, options: { face?: number; spot?: Spot } = {}): Behaviour<W> {
  const { aside = 0 } = options.spot ?? {};
  return function* () {
    const moving = typeof holds === 'function' ? holds : null;
    const source = live(holds, h.frame);
    const start = moving && 'position' in source ? source : null;
    const grips: { side?: Side; at: Vector3 }[] = [];
    const point = source instanceof Vector3 || 'position' in source;
    if (source instanceof Vector3) grips.push({ at: source.clone() });
    else if ('position' in source) {
      const { position, quaternion } = source;
      if (quaternion) for (const side of SIDES) {
        const held = h.holding[side];
        if (held) grips.push({ side, at: gripOf(held.item, held.grip).position.clone().applyQuaternion(quaternion).add(position) });
      }
      if (!grips.length) grips.push({ at: position.clone() });
    } else for (const { side, item, grip } of held(source)) grips.push({ side, at: item.toWorld(gripOf(item, grip), _world).position.clone() });
    const mass = !point ? Math.max(...held(source).map(({ item }) => item.mass)) : 0;
    let face = options.face ?? facingFor(h, grips);
    const p = h.proportions;
    const height = grips.reduce((sum, g) => sum + g.at.y, 0) / grips.length;
    const shoulders = (h.feet[0].position.y + h.feet[1].position.y) / 2 + p.shoulderHeight;
    const reach = ARM_REACH * p.armLength;
    const available = point ? Math.sqrt(Math.max(0, reach ** 2 - (height - shoulders) ** 2 - aside ** 2)) : Infinity;
    // Tuned: bring heavier low grips closer as the load strategy caps trunk bow.
    const distance = !point && grips.length === 2 && height < p.hipHeight ? LOW_STAND / Math.sqrt(loadFactor(mass)) : WITHIN;
    const ahead = options.spot?.ahead ?? Math.min(distance * p.armLength, available, p.toeFront + Math.max(0, height - p.ankleHeight));
    const shoulder = (side?: Side) => side
      ? h.pose.position(INDEX[`${side}UpperArm`])
      : h.pose.position(INDEX.leftUpperArm).clone().add(h.pose.position(INDEX.rightUpperArm)).multiplyScalar(0.5);
    const middle = grips.reduce((sum, g) => sum.add(g.at), new Vector3()).divideScalar(grips.length);
    if (point) {
      const distance = Math.hypot(ahead, aside, height - shoulders);
      if (options.spot ? distance > reach : Math.hypot(aside, height - shoulders) > reach) throw new Error(`approach: point ${distance.toFixed(3)} m from shoulder middle at requested stand exceeds arm reach ${(ARM_REACH * p.armLength).toFixed(3)} m`);
    }
    const to = new Vector3(), there = new Vector3();
    const standAt = (yaw: number) => {
      to.copy(middle).addScaledVector(leftOf(yaw), -aside);
      there.copy(to).addScaledVector(forwardOf(yaw), -ahead);
    };
    const clear = () => h.frame.world.bodies.every((body) => {
      if (body.skeleton === h.pose.skeleton) return true;
      return body.skeleton.bones.every((bone, b) => {
        if (!b) return true;
        const a = body.position(bone.parent), end = body.position(b);
        // Low segments, including any crouched trunk, bound the space occupied near the feet.
        return Math.min(a.y, end.y) > p.hipHeight || pointSegmentDistance(there, a, end) >= p.hipHalfWidth + p.toeFront + SEGMENT_RADIUS;
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
    if (yaw === undefined) throw new Error(options.face === undefined
      ? 'approach: no stand clear of nearby low segments' : 'approach: explicit face has a blocked stand');
    face = yaw;
    const turned = (yaw = face) => Math.abs(wrapAngle(yaw - h.locomotion.facing)) < SQUARE;
    if (options.spot === undefined && turned() && grips.every(({ side, at }) => flat(shoulder(side), at) < IN_REACH * p.armLength)) return;
    const rotation = (f: Frame<W>) => {
      const current = moving ? live(moving, f) : null;
      return start?.quaternion && current?.quaternion
        ? current.quaternion.clone().multiply(start.quaternion.clone().invert())
        : new Quaternion();
    };
    const facing = (f: Frame<W>) => {
      const forward = forwardOf(face).applyQuaternion(rotation(f));
      return headingOf(forward.x, forward.z);
    };
    const moved = (point: Vector3, f: Frame<W>) => moving && start
      ? point.clone().sub(start.position).applyQuaternion(rotation(f)).add(live(moving, f).position)
      : point;
    const destination = (f: Frame<W>) => moved(to, f);
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
    const via: Live<Vector3, W>[] = [];
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
    } }, via)();
  };
}

/** the middle of the grips `holds` take, where they are now */
function middleOf(holds: Holds | Vector3): Vector3 {
  if (holds instanceof Vector3) return holds.clone();
  const hands = held(holds);
  return hands.reduce((sum, { item, grip }) => sum.add(item.toWorld(gripOf(item, grip), _world).position), new Vector3()).divideScalar(hands.length);
}

/** the facing to take grips `grips` with: the left hand's to the left of the right's, or toward a single one from where the body stands */
function facingFor<W>(h: Humanoid<W>, grips: { side?: Side; at: Vector3 }[]): number {
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
