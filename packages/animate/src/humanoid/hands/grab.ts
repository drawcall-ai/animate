import { bringShoulder } from '../reach-posture';
import { Quaternion, Vector3 } from 'three';
import { action, parallel } from '@pmndrs/timeline';
import type { Frame } from '../../core/body';
import type { Item } from '../../core/carrier';
import { live, type Behaviour, type Live, type Placement, type Target } from '../../core/goal';
import { when } from '../../core/when';
import { ARM_REACH, handTo } from '../arms';
import { INDEX, SIDES, type Side } from '../bones';
import type { Humanoid } from '../humanoid';
import { withGaze } from '../look';
import { forwardOf, headingOf, leftOf, wrapAngle } from '../../core/math';
import { arriving, walkTo } from '../walk';
import { gripOf, held, type Holds } from './grips';
import { reachFor } from './reach';

// Taking hold of things: walking up to them, the eyes and hands going ahead.

/** Where the body stands to take something: its grips' middle `ahead` of it (m) and `aside` to its left (m; negative: its right). */
export interface Stand {
  /** Metres before the target, or the library's full arm reach for a deep object approached around its grips. */
  ahead?: number;
  aside?: number;
}

/** Comfortable stand distance as a share of arm length. */
const WITHIN = 0.8;
// Tuned clearance for the knees and free hands beside low two-hand supports (× arm length).
const LOW_STAND = 1.05;
/** in reach without a step: each grip this near its shoulder on the floor's plane (× the arm's length: lower down, the body bows for it), the body facing within SQUARE (rad) of the way asked */
const IN_REACH = 0.65;
const SQUARE = 0.3;
/** arrived where it stands to take something: this near (m, default body), and come to rest or stood still this long (s) */
const ARRIVED = 0.12;
/** how far round what it takes the body walks when the way passes it (m, default body): past a stand's foot */
const ROUND = 0.5;
/** the point beside what it walks round: how far on toward where it goes, and how near it the body comes before turning there (× ROUND) */
const ON = 0.5;
const NEAR = 0.3;
// Tuned frontal approach cone: a wide load rounds the support when its lateral offset exceeds half its forward offset.
const ROUND_ASIDE = 0.5;
const STILL = 0.5;

/**
 * Taking hold of things, each step under way before the last is over: the body walks up to take
 * them (`approach`); LOOKING s before it arrives, once they are in view (IN_VIEW), the eyes go to
 * them (`withGaze`: on the grips' middle, or `look`; `false`: not); REACHING_OUT s before, the hands set off toward them (to a point
 * halfway from its shoulder to its grip); LOWERING s before, as it plants its last step, the body
 * starts to bow and bend for them; once it stands they take hold (`reachFor`). It ends with the hands on the grips: hold on with
 * `hold` or `carry`. Gaze and reach prepare together once the grips enter view; `first: true` lets the eyes lead.
 */
export function grab<W>(h: Humanoid<W>, holds: Holds, options: { face?: number; stand?: Stand; look?: boolean | Live<Vector3, W>; bow?: number; first?: boolean } = {}): Behaviour<W> {
  const { look = true, bow } = options;
  return function* () {
    let stood = false;
    const arrivingForReach = arriving(h, LOWERING);
    const reach = function* () {
      yield* parallel<Frame<W>>('all', function* () {
        yield* parallel<Frame<W>>('race',
          when((f: Frame<W>) => stood || (!h.gait.moving && arrivingForReach(f)
            && held(holds).every(({ side, item, grip }) => {
              const height = item.toWorld(gripOf(item, grip), _world).position.y;
              return Math.abs(height - f.prev.position(INDEX[`${side}UpperArm`]).y) <= ARM_REACH * h.proportions.armLength;
            }))),
          function* () {
            yield* when(arriving(h, REACHING_OUT));
            yield* parallel<Frame<W>>('all', ...held(holds).map(({ side, item, grip }) => handTo(h, side, (f) => shortOf(f, side, item, grip), { lead: false })));
          },
        );
        yield* reachFor(h, holds)();
      }, function* () {
        yield* when((f: Frame<W>) => stood || arrivingForReach(f));
        // Keep preparing the low grip through foot settling even after the full reach starts.
        yield* action<Frame<W>>({ until: () => stood, update: (f) => held(holds).forEach(({ side, item, grip }) => {
          const at = shortOf(f, side, item, grip).position;
          at.y = item.toWorld(gripOf(item, grip), _world).position.y;
          bringShoulder(h, f, side, at);
        }) });
      });
    };
    const walk = function* () {
      yield* approach(h, holds, options)();
      stood = true;
    };
    // (the eyes go once it is near and the head turns far enough to see it: turning to it, the body faces it first)
    const near = arriving(h, LOOKING);
    const seen = (f: Frame<W>) => near(f) && Math.abs(wrapAngle(headingOf(...flatTo(f, middleOf(holds))) - h.gait.facing)) < IN_VIEW;
    yield* parallel<Frame<W>>('all', walk, function* () {
      yield* when((f: Frame<W>) => stood || seen(f));
      yield* (look === false ? reach : withGaze(h, look === true ? middleOf(holds) : look, reach, { bow, first: options.first }))();
    });
  };
}

/**
 * how far aside of the way the body faces something may be for the eyes to go to it (rad, ~80°):
 * about as far as the head turns on the trunk (the neck's and the head's ranges, ~75° together), the
 * eyes taking the rest without strain. What it takes further aside — beside the way it walks, the
 * body coming up to it sideways on — the eyes go to only as the body turns to it in its last steps:
 * held there, the head would be turned past what it turns comfortably.
 */
const IN_VIEW = 1.4;

/** the way from the body to `at` on the floor's plane (x, z) */
const flatTo = <W>(f: Frame<W>, at: Readonly<Vector3>): [number, number] => {
  const body = f.prev.com(_com);
  return [at.x - body.x, at.z - body.z];
};

/** how long before the body arrives to take something the eyes go to it, and the hands set off toward it (s): the eyes ~0.5–1 s ahead of the hands (Land & Hayhoe 2001) */
const LOOKING = 0.6;
const REACHING_OUT = 0.5;
/** how long before the body arrives it starts to come down for what it takes (s): as it plants its last step, not once it has stood still */
const LOWERING = 0.3;
/** how far toward its grip a hand reaches out while the body still comes up to it (share of the way from its shoulder) */
const SHORT = 0.5;

/** A point SHORT of the way from shoulder to grip (world). */
function shortOf<W>(f: Frame<W>, side: Side, item: Item, grip: string): Target {
  const shoulder = f.current.position(INDEX[`${side}UpperArm`]);
  return { position: item.toWorld(gripOf(item, grip), _world).position.sub(shoulder).multiplyScalar(SHORT).add(shoulder).clone() };
}

/**
 * Walking up to grips or a placing point: to stand facing `face` with the grips' middle `stand` before
 * the body (default: in reach, squarely; facing so the left hand's grip is on the left, or toward a
 * single grip) — no step if every grip is in reach of its shoulder already; round what it takes if
 * the way there passes it (by a point ROUND beside it, on the side the way runs); it ends there, turned and come to rest (or
 * stood still on planted feet a while: a step of a few cm `balance` may not take). The first half
 * of `grab`. A placing point is measured from the middle of the shoulders, rather than either
 * hand. A point must be within ARM_REACH of that middle at the requested stand (at the
 * shoulders' standing height); an impossible stand throws before walking. Grips may recruit
 * bowing and lowering during the reach. A destination placement uses the held grips at its
 * orientation to choose the facing, so both hands can reach it; translation and rotation are followed live.
 */
export function approach<W>(h: Humanoid<W>, holds: Holds | Vector3 | Live<Placement, W>, options: { face?: number; stand?: Stand } = {}): Behaviour<W> {
  const { aside = 0 } = options.stand ?? {};
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
    const face = options.face ?? facingFor(h, grips);
    const p = h.proportions;
    const height = grips.reduce((sum, g) => sum + g.at.y, 0) / grips.length;
    const shoulders = (h.feet[0].position.y + h.feet[1].position.y) / 2 + p.shoulderHeight;
    const reach = ARM_REACH * p.armLength;
    const available = point ? Math.sqrt(Math.max(0, reach ** 2 - (height - shoulders) ** 2 - aside ** 2)) : Infinity;
    // Leave room beside a low support while the body bends to its grips.
    const distance = !point && grips.length === 2 && height < p.hipHeight ? LOW_STAND : WITHIN;
    const ahead = options.stand?.ahead ?? Math.min(distance * p.armLength, available, p.toeFront + Math.max(0, height - p.ankleHeight));
    const shoulder = (side?: Side) => side
      ? h.pose.position(INDEX[`${side}UpperArm`])
      : h.pose.position(INDEX.leftUpperArm).clone().add(h.pose.position(INDEX.rightUpperArm)).multiplyScalar(0.5);
    const middle = grips.reduce((sum, g) => sum.add(g.at), new Vector3()).divideScalar(grips.length);
    if (point && options.stand) {
      const distance = Math.hypot(ahead, aside, height - shoulders);
      if (distance > ARM_REACH * p.armLength) throw new Error(`approach: point ${distance.toFixed(3)} m from shoulder middle at requested stand exceeds arm reach ${(ARM_REACH * p.armLength).toFixed(3)} m`);
    }
    const turned = (yaw = face) => Math.abs(wrapAngle(yaw - h.gait.facing)) < SQUARE;
    if (options.stand === undefined && turned() && grips.every(({ side, at }) => flat(shoulder(side), at) < IN_REACH * p.armLength)) {
      return;
    }
    const to = middle.clone().addScaledVector(leftOf(face), -aside);
    const there = to.clone().addScaledVector(forwardOf(face), -ahead);
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
    // (round it: the way from where the body stands to there passing nearer its grips than ROUND)
    const body = h.pose.com(new Vector3()).setY(0);
    middle.setY(0);
    const lateral = body.clone().sub(there).dot(leftOf(face));
    const frontal = Math.abs(body.clone().sub(there).dot(forwardOf(face)));
    if (point && grips.length > 1 && Math.abs(lateral) > Math.max(ROUND * p.scale, ROUND_ASIDE * frontal)) {
      // A wide held load approaches beside its support before turning in, rather than cutting its corner.
      const beside = there.clone().addScaledVector(leftOf(face), Math.sign(lateral) * ROUND * p.scale);
      yield* walkTo(h, { to: (f) => moved(beside, f), until: (f) => flat(f.prev.com(_com), moved(beside, f)) < NEAR * ROUND * p.scale })();
      body.copy(h.pose.com(new Vector3())).setY(0);
    }
    const way = _d.subVectors(there, body).setY(0);
    const length = way.length();
    const along = length > 1e-6 ? _e.subVectors(middle, body).dot(way) / length : 0;
    const nearest = body.clone().addScaledVector(way, along / Math.max(length, 1e-6));
    // (it is in the way: passed on the way there, more than ROUND before its end, nearer the line than ROUND)
    if (along > 0 && along < length - ROUND * p.scale && flat(nearest, middle) < ROUND * p.scale) {
      // (on the side of it the way runs, by a point ROUND beside it and a little on toward there,
      // walked to until near it: the last leg does not cut back in past it)
      const across = new Vector3(-way.z, 0, way.x).normalize();
      const side = Math.sign(_e.subVectors(nearest, middle).dot(across)) || 1;
      const beside = middle.clone().addScaledVector(across, side * ROUND * p.scale).addScaledVector(way, (ON * ROUND * p.scale) / length);
      yield* walkTo(h, { to: (f) => moved(beside, f), until: (f) => flat(f.prev.com(_com), moved(beside, f)) < NEAR * ROUND * p.scale })();
    }
    yield* walkTo(h, { to: destination, face: facing, within: ahead, until: (f) => {
      const there = destination(f).clone().addScaledVector(forwardOf(facing(f)), -ahead);
      return turned(facing(f)) && flat(f.prev.com(_com), there) < ARRIVED * p.scale && (h.gait.settled || h.gait.planted > STILL);
    } })();
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
const _d = new Vector3();
const _e = new Vector3();
const _world: Target & { velocity: Vector3; spin: Vector3 } = { position: new Vector3(), velocity: new Vector3(), spin: new Vector3() };
