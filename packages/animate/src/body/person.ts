import { Object3D, Quaternion, Vector3 } from 'three';
import type { Frame } from '../kernel/frame';
import { Pose, type ReadonlyPose } from '../kernel/pose';
import { gazeAsks } from '../hands/person/bend';
import { personHands } from '../hands/person/handling';
import type { Handling } from '../hands/handling';
import { looking } from '../look/gaze';
import type { AnySpecies, Gazer } from '../species/define';
import type { Carrier } from '../kernel/carrier';
import { solveChain } from '../kernel/chain';
import { REACHED, type Goal } from '../kernel/goal';
import { ChainTip } from '../kernel/tip';
import { forwardOf } from '../kernel/math';
import { Self, type Behaviours, type SelfOptions } from './runtime';
import type { Binding } from './model';
import { resolve, type Hold } from '../things/resolve';
import { bear, bodyOf, checkParents, inHand, move, worn } from '../things/hold';
import type { Thing } from '../things/thing';
import { INDEX, SIDES, sideOf, type Side } from '../species/humanoid/bones';
import type { Proportions } from '../species/humanoid/proportions';
import { footRotation } from '../legs/person/foot';
import { legOf } from '../legs/person/leg';
import { STANDING_REACH } from '../legs/person/posture';
import { relaxedPose } from '../species/humanoid/relaxed';
import { standingFeet } from '../species/humanoid/stance';
import { driven } from '../legs/person/balance';
import { stride } from '../legs/person/stride';
import { hanging, handStep, HOLD } from '../hands/person/arms';
import { lookAround } from '../look/around';

/**
 * A person as it moves: a body whose balance walks and stands it on its legs (or keeps its legs under a root its app drives), whose
 * eyes look about when nothing asks for them, whose free arms hang and swing, and whose hands keep to what they hold. It starts standing
 * relaxed in its stance where it is put.
 */
export class Person extends Self {
  declare readonly gazer: Gazer;
  /** what its hands carry this sub-step and along which aim: fitted to the wrists after the hands */
  readonly carrying = new Map<Object3D, Carrier>();
  readonly proportions: Proportions;

  constructor(species: AnySpecies, options: SelfOptions, binding: Binding) {
    const proportions = species.person;
    if (!proportions || !species.gaze) throw new Error('a person is made of a humanoid species');
    super(species, options, binding, (skeleton) => relaxed(proportions, new Pose(skeleton), options.at ?? new Vector3(), options.face ?? 0));
    this.proportions = proportions;
  }

  /** a person's hands: both at once, the right leading */
  protected handle(): Handling {
    return personHands(this);
  }

  /** before the head aims at `point`: the body bows and lowers to see low down */
  lead(pose: ReadonlyPose, point: Readonly<Vector3>): void {
    gazeAsks(this, pose, point);
  }

  protected behave(): Behaviours {
    const seed = this.life.seed;
    const arms = { left: new ChainTip('leftArm'), right: new ChainTip('rightArm') }, held = { left: keptOnBody(this, 'left'), right: keptOnBody(this, 'right') };
    const taking: Partial<Record<Side, readonly [Thing, string]>> = {}, noted = new WeakSet<object>();
    return {
      balance: this.drive ? driven(this, seed) : stride(this, { seed }),
      gaze: looking(this, lookAround(this, seed)),
      hands: hanging(this),
      keep: (f, hand) => {
        const side = sideOf(hand), hold = this.holding[side];
        if (!hold) return;
        const thing = hold.thing;
        // (what hangs from the hand stays where the hand holds it on the body; what the body wears or carries in both hands the hands
        // follow; to keep a hand on what rests where it lies, or on another body, the body comes along — down to it, or after it)
        if (inHand(this, thing)) handStep(this, f, side, held[side](f), { ...HOLD, lead: false }, arms[side]);
        else handStep(this, f, side, hold.goal, { on: this.track(thing.object), thing, ...HOLD, lead: bodyOf(thing.object) !== this }, arms[side]);
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
function keptOnBody(person: Person, side: Side): (f: Frame) => Goal {
  const bone = person.hands[side], kept = { position: new Vector3(), quaternion: new Quaternion() };
  let time = -Infinity;
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

/**
 * How far a hand may be from a grip it starts holding (m): a reach ends once the wrist is within `REACHED.distance`, and the same frame's
 * hold step and fit may pull it up to ~2 cm more (tuned against the scenes' grabs, none of which comes closer than 1 cm to this limit).
 */
const GRIP_TAKEN = REACHED.distance + 0.02;
/** How far a wrist may be from the grip it holds on what the body carries (m; tuned: a load carried at the body as it walks and turns
 * lags its turn, the wrists up to ~4 cm off their grips) */
const HELD = 0.05;

/** how far hand `side` is from `hold`'s grip as the body is posed now (read afresh: a thing hanging from a hand moves with it after the hands) */
function gripGap(person: Person, f: Frame, side: Side, hold: Hold): number {
  const at = resolve(person, hold.thing.object, _placed);
  return f.current.position(person.hands[side]).distanceTo(_grip.copy(hold.goal.position).applyQuaternion(at.quaternion).add(at.position));
}

/** development: each grip a hand has just taken, its wrist as near it as a grip taken is */
function checkTaking(person: Person, f: Frame, taking: Partial<Record<Side, readonly [Thing, string]>>): void {
  for (const side of SIDES) {
    const hold = person.holding[side], was = taking[side];
    taking[side] = hold ? [hold.thing, hold.grip] : undefined;
    if (!hold || (was?.[0] === hold.thing && was[1] === hold.grip)) continue;
    const value = gripGap(person, f, side, hold);
    if (value > GRIP_TAKEN) f.dev?.append(f.time, { check: 'grip activation distance (m)', value, limit: GRIP_TAKEN, where: `${hold.thing.object.name} ${side} ${hold.grip}` });
  }
}

/**
 * development: a hand on something worn (on a bone) keeps to its grip, one rigid owner moving it; one on what the body carries stays
 * within `HELD` of its grip as the thing is fitted to the wrists (said once a hold: arms falling short of where a carry aims it draw the
 * wrists together, off the grips)
 */
function checkHeld(person: Person, f: Frame, noted: WeakSet<object>): void {
  for (const side of SIDES) {
    const hold = person.holding[side];
    if (!hold || !bodyOf(hold.thing.object)) continue;
    const carried = !worn(hold.thing), value = gripGap(person, f, side, hold), limit = carried ? HELD : REACHED.distance;
    if (value <= limit || (carried && noted.has(hold))) continue;
    if (carried) noted.add(hold);
    f.dev?.append(f.time, { check: 'held grip distance (m)', value, limit, where: `${hold.thing.object.name} ${side}` });
  }
}

/**
 * `pose` standing relaxed at `floor` facing `yaw`: the feet flat where the default stance puts them, the pelvis as high as they reach,
 * the legs solved down to them
 */
function relaxed(proportions: Proportions, pose: Pose, floor: Vector3, yaw: number): Pose {
  for (const { bone, rotation } of relaxedPose()) pose.setLocal(bone, rotation);
  pose.setLocal(0, new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw));
  pose.setRoot(new Vector3(floor.x, proportions.hipHeight, floor.z));
  pose.facing = yaw;
  const feet = standingFeet(proportions, floor.x, floor.z, yaw), reach = STANDING_REACH * proportions.legLength;
  // (no higher than the legs reach)
  let y = proportions.hipHeight;
  SIDES.forEach((side, s) => {
    const hip = pose.position(INDEX[`${side}UpperLeg`]), ankle = feet[s].position;
    y = Math.min(y, ankle.y + Math.sqrt(reach * reach - (hip.x - ankle.x) ** 2 - (hip.z - ankle.z) ** 2) + proportions.hipHeight - hip.y);
  });
  pose.setRoot(new Vector3(floor.x, y, floor.z));
  SIDES.forEach((side, s) => {
    const { position, yaw: heading } = feet[s];
    const knee = forwardOf(heading).add(pose.position(INDEX[`${side}UpperLeg`]));
    solveChain({ current: pose }, legOf(side), { tip: { position, quaternion: footRotation(heading, 0) }, pole: knee });
  });
  return pose;
}

const _q = new Quaternion(), _grip = new Vector3(), _placed = { position: new Vector3(), quaternion: new Quaternion() };
