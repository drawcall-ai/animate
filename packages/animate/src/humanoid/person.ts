import { Object3D, Quaternion, Vector3 } from 'three';
import type { Frame } from '../core/frame';
import { Pose } from '../core/pose';
import type { Carrier } from '../core/carrier';
import { solveChain } from '../core/chain';
import { REACHED, type Target } from '../core/goal';
import { ChainTip } from '../core/tip';
import { forwardOf, leftOf } from '../core/math';
import { looking, type Gazer } from '../core/gaze';
import { Self, type Behaviours, type SelfOptions } from '../body/self';
import { bear, bodyOf, move, supported } from '../body/hold';
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
    const taking: Partial<Record<Side, readonly [Thing, string]>> = {};
    return {
      balance: this.drive ? driven(this, seed) : stride(this, { seed }),
      gaze: looking(this, lookAround(this, seed)),
      hands: hanging(this),
      keep: (f, hand) => {
        const side = sideOf(hand), hold = this.holding[side];
        if (!hold) return;
        const thing = hold.thing, frame = this.track(thing.object);
        // (what rests where it lies the body comes down to keep its hands on; what it carries, or another moves, they follow)
        handStep(this, f, side, { position: hold.at.position }, { on: frame, thing, ...HOLD, lead: supported(thing) }, arms[side]);
      },
      things: (f) => {
        if (f.dev) checkTaking(this, f, taking);
        move(this, f, this.carrying);
        if (f.dev) checkWorn(this, f);
        this.carrying.clear();
        bear(this, f, this.worn, this.borne);
      },
    };
  }
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

/** development: each grip a hand has just taken, its wrist as near it as a grip taken is */
function checkTaking(h: Person, f: Frame, taking: Partial<Record<Side, readonly [Thing, string]>>): void {
  for (const side of SIDES) {
    const hold = h.holding[side], was = taking[side];
    taking[side] = hold ? [hold.thing, hold.grip] : undefined;
    if (!hold || (was?.[0] === hold.thing && was[1] === hold.grip)) continue;
    const at = h.track(hold.thing.object).toWorld({ position: hold.at.position }, _target, f.time).position;
    const value = f.current.position(h.hands[side]).distanceTo(at);
    if (value > GRIP_TAKEN) f.dev?.append(f.time, { check: 'grip activation distance (m)', value, limit: GRIP_TAKEN, where: `${hold.thing.object.name} ${side} ${hold.grip}` });
  }
}

/** development: a hand on something worn (on a bone) keeps to its grip: one rigid owner moves it */
function checkWorn(h: Person, f: Frame): void {
  for (const side of SIDES) {
    const hold = h.holding[side];
    if (!hold || h.carried.has(hold.thing.object) || !bodyOf(hold.thing.object)) continue;
    const at = h.track(hold.thing.object).toWorld({ position: hold.at.position }, _target, f.time).position;
    const value = f.current.position(h.hands[side]).distanceTo(at);
    if (value > REACHED.distance) f.dev?.append(f.time, { check: 'held grip distance (m)', value, limit: REACHED.distance, where: `${hold.thing.object.name} ${side}` });
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

const _target: Target & { velocity: Vector3; spin: Vector3 } = { position: new Vector3(), velocity: new Vector3(), spin: new Vector3() };
