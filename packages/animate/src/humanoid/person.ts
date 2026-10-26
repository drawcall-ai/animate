import { Object3D, Quaternion, Vector3 } from 'three';
import type { Frame } from '../core/frame';
import { Pose } from '../core/pose';
import type { Carrier } from '../core/carrier';
import { solveChain } from '../core/chain';
import { REACHED, type Target } from '../core/goal';
import { ChainTip } from '../core/tip';
import { forwardOf, leftOf } from '../core/math';
import { looking, type Gazer } from '../core/gaze';
import { Self, type Behaviours, type Hold, type SelfOptions } from '../body/self';
import { resolve } from '../body/resolve';
import { bear, bodyOf, checkParents, inHand, move, supported, worn } from '../body/hold';
import type { Thing } from '../body/things';
import { INDEX, SIDES, type Side } from './bones';
import type { Proportions } from './proportions';
import { pointsOf, type BonePoint, type PointName } from './landmarks';
import { footRotation, type Foot } from './posture/foot';
import { legOf } from './posture/leg';
import { STANDING_REACH } from './posture/posture';
import { relaxedPose } from './profile/relaxed';
import { defaultStance, footYaw, stanceFeet } from './stance';
import { driven } from './driven';
import { stride } from './stride';
import { hanging, handStep } from './arms';
import { lookAround } from './look';
import type { AnySpecies } from '../core/species';

/**
 * A person as it moves: a body whose balance walks and stands it on its legs (or keeps its legs under a root its app drives), whose
 * eyes look about when nothing asks for them, whose free arms hang and swing, and whose hands keep to what they hold. It starts standing
 * relaxed in its stance where it is put.
 */
export class Person extends Self {
  declare readonly gazer: Gazer;
  /** where the feet stand or, stepping, land [left, right]: balance's */
  readonly feet: [Foot, Foot];
  /** what its hands carry this sub-step and along which aim: fitted to the wrists after the hands */
  readonly carrying = new Map<Object3D, Carrier>();
  readonly proportions: Proportions;
  /** its named points: landmarks, eyes, wrists, palms */
  readonly points: Record<PointName, BonePoint>;

  constructor(species: AnySpecies, options: SelfOptions) {
    const p = species.person;
    if (!p || !species.gaze) throw new Error('a person is made of a humanoid species');
    let feet: [Foot, Foot] | null = null;
    super(species, options, (skeleton) => {
      const start = standing(p, new Pose(skeleton), options.at ?? new Vector3(), options.face ?? 0);
      feet = start.feet;
      return start.pose;
    });
    if (!feet) throw new Error('a person stands where it is made');
    this.feet = feet;
    this.proportions = p;
    this.points = pointsOf(p);
  }

  protected behave(): Behaviours {
    const seed = this.life.seed;
    const arms = { left: new ChainTip('leftArm'), right: new ChainTip('rightArm') };
    const held = { left: keptOnBody(this, 'left'), right: keptOnBody(this, 'right') };
    const taking: Partial<Record<Side, readonly [Thing, string]>> = {}, noted = new WeakSet<object>();
    return {
      balance: this.drive ? driven(this, seed) : stride(this, { seed }),
      gaze: looking(this, lookAround(this, seed)),
      hands: hanging(this),
      keep: (f, hand) => {
        const side = sideOf(hand), hold = this.holding[side];
        if (!hold) return;
        const thing = hold.thing;
        // (what hangs from the hand stays where the hand holds it on the body; what rests where it lies the body comes down to keep its
        // hand on; what it carries in both, or another moves, the hands follow)
        if (inHand(this, thing)) handStep(this, f, side, held[side](f), { ...HOLD, lead: false }, arms[side]);
        else handStep(this, f, side, hold.goal, { on: this.track(thing.object), thing, ...HOLD, lead: supported(thing) }, arms[side]);
      },
      things: (f) => {
        checkParents(this, f);
        if (f.dev) checkTaking(this, f, taking);
        move(this, f, this.carrying);
        if (f.dev) checkHeld(this, f, noted);
        this.carrying.clear();
        bear(this, f, this.worn, this.borne);
      },
    };
  }
}

/**
 * where hand `side` is kept on the body while nothing asks for it: where it was relative to the root bone when it was last let be (a
 * mug held before the chest stays there as the body walks and turns)
 */
function keptOnBody(h: Person, side: Side): (f: Frame) => Target {
  const bone = h.hands[side];
  let time = -Infinity;
  const kept = { position: new Vector3(), quaternion: new Quaternion() };
  return (f) => {
    // (let be since the last sub-step it was kept: from where it is now)
    if (f.time - time > 1.5 * f.dt) {
      const back = _q.copy(f.prev.rotation(0)).invert();
      kept.position.copy(f.prev.position(bone)).sub(f.prev.position(0)).applyQuaternion(back);
      kept.quaternion.copy(back).multiply(f.prev.rotation(bone));
    }
    time = f.time;
    const turn = f.current.rotation(0);
    return { position: kept.position.clone().applyQuaternion(turn).add(f.current.position(0)), quaternion: turn.clone().multiply(kept.quaternion) };
  };
}

/** `self` as the person it is */
export function personOf(self: Self): Person {
  if (!(self instanceof Person)) throw new Error('not a person');
  return self;
}

/** `hand` as a person's side: a person's hands are `left` and `right` */
export function sideOf(hand: string): Side {
  const side = SIDES.find((s) => s === hand);
  if (!side) throw new Error(`a person's hands are left and right, not "${hand}"`);
  return side;
}

/** Tuned: how briskly a holding hand keeps to its grip as the thing or the body moves (m/s², m/s, rad/s², rad/s): a firm hold, far
 * quicker than a reach, so it never trails what it holds */
export const HOLD = { accel: 30, speed: 3, turnAccel: 200, turnSpeed: 15 };

/**
 * How far a hand may be from a grip it starts holding (m): a reach ends once the wrist is within `REACHED.distance`, and the same
 * frame's hold step and fit may pull it up to ~2 cm more (tuned against the scenes' grabs, none of which comes closer than 1 cm to this
 * limit).
 */
const GRIP_TAKEN = REACHED.distance + 0.02;
/** How far a wrist may be from the grip it holds on what the body carries (m; tuned: a load carried at the body as it walks and turns
 * lags its turn, the wrists up to ~4 cm off their grips) */
const HELD = 0.05;

/** where `hold`'s grip is as the body is posed now (read afresh: a thing hanging from a hand moves with it after the hands) */
function gripIn(h: Person, hold: Hold): Vector3 {
  const at = resolve(h, hold.thing.object, _placed);
  return _grip.copy(hold.goal.position).applyQuaternion(at.quaternion).add(at.position);
}

/** development: each grip a hand has just taken, its wrist as near it as a grip taken is */
function checkTaking(h: Person, f: Frame, taking: Partial<Record<Side, readonly [Thing, string]>>): void {
  for (const side of SIDES) {
    const hold = h.holding[side], was = taking[side];
    taking[side] = hold ? [hold.thing, hold.grip] : undefined;
    if (!hold || (was?.[0] === hold.thing && was[1] === hold.grip)) continue;
    const at = gripIn(h, hold);
    const value = f.current.position(h.hands[side]).distanceTo(at);
    if (value > GRIP_TAKEN) f.dev?.append(f.time, { check: 'grip activation distance (m)', value, limit: GRIP_TAKEN, where: `${hold.thing.object.name} ${side} ${hold.grip}` });
  }
}

/**
 * development: a hand on something worn (on a bone) keeps to its grip, one rigid owner moving it; one on what the body carries stays
 * within `HELD` of its grip as the thing is fitted to the wrists (said once a hold: arms falling short of where a carry aims it draw the
 * wrists together, off the grips)
 */
function checkHeld(h: Person, f: Frame, noted: WeakSet<object>): void {
  for (const side of SIDES) {
    const hold = h.holding[side];
    if (!hold) continue;
    if (!bodyOf(hold.thing.object)) continue;
    const carried = !worn(hold.thing);
    const at = gripIn(h, hold);
    const value = f.current.position(h.hands[side]).distanceTo(at), limit = carried ? HELD : REACHED.distance;
    if (value <= limit || (carried && noted.has(hold))) continue;
    if (carried) noted.add(hold);
    f.dev?.append(f.time, { check: 'held grip distance (m)', value, limit, where: `${hold.thing.object.name} ${side}` });
  }
}

/**
 * `pose` standing relaxed at `floor` facing `yaw`: the feet flat where the default stance puts them,
 * the pelvis as high as they reach, the legs solved down to them; and the feet
 */
function standing(p: Proportions, pose: Pose, floor: Vector3, yaw: number): { pose: Pose; feet: [Foot, Foot] } {
  for (const { bone, rotation } of relaxedPose()) pose.setLocal(bone, rotation);
  pose.setLocal(0, new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw));
  pose.setRoot(new Vector3(floor.x, p.hipHeight, floor.z));
  pose.facing = yaw;
  const stance = defaultStance(p);
  const ankles: [Vector3, Vector3] = [new Vector3(), new Vector3()];
  stanceFeet(floor.x, floor.z, forwardOf(yaw), leftOf(yaw), p, stance, ankles);
  // (no higher than the legs reach)
  const reach = STANDING_REACH * p.legLength;
  let y = p.hipHeight;
  SIDES.forEach((side, s) => {
    const hip = pose.position(INDEX[`${side}UpperLeg`]);
    y = Math.min(y, ankles[s].y + Math.sqrt(reach * reach - (hip.x - ankles[s].x) ** 2 - (hip.z - ankles[s].z) ** 2) + p.hipHeight - hip.y);
  });
  pose.setRoot(new Vector3(floor.x, y, floor.z));
  const feet = SIDES.map((side, s): Foot => {
    const heading = footYaw(yaw, s === 0 ? 1 : -1, stance);
    const foot = footRotation(heading, 0);
    const knee = forwardOf(heading).add(pose.position(INDEX[`${side}UpperLeg`]));
    solveChain({ current: pose }, legOf(side), { tip: { position: ankles[s], quaternion: foot }, pole: knee });
    return { position: ankles[s], yaw: heading, phase: 'planted' };
  });
  return { pose, feet: [feet[0], feet[1]] };
}

const _q = new Quaternion(), _grip = new Vector3(), _placed = { position: new Vector3(), quaternion: new Quaternion() };
