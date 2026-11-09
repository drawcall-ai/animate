import { Object3D, Quaternion, Vector3 } from 'three';
import type { Frame } from '../kernel/frame';
import { BonePose, type ReadonlyBonePose } from '../kernel/bone-pose';
import { gazeAsks } from './hands/shoulder';
import { limitOf } from './hands/reach';
import { personHands } from './hands/staging';
import type { HandStaging } from '../body/hand-staging';
import { looking } from '../look/gaze';
import type { AnySpecies, Gazer } from '../species/define';
import type { MovingFrame } from '../kernel/moving-frame';
import { solveChain } from '../kernel/chain';
import { REACHED, type Goal } from '../kernel/goal';
import { LimbMover } from '../kernel/limb';
import { forwardOf } from '../kernel/math';
import { seedOf } from '../kernel/random';
import { Self, type Behaviours } from '../body/self';
import type { Binding } from '../body/binding';
import { placedFor } from '../things/placed';
import { bear, bodyOf, carryAlong, checkParents, inHand, move, type Hold } from '../things/hold';
import type { Thing } from '../things/thing';
import { INDEX, SIDES, sideOf, type Side } from './anatomy/bones';
import type { Proportions } from './anatomy/proportions';
import type { Stride } from './anatomy/humanoid';
import { footRotation } from './legs/foot';
import { legOf } from './legs/leg';
import { STANDING_REACH } from './legs/walk-pose';
import { relaxedPose } from './anatomy/relaxed';
import { standingFeet } from './anatomy/stance';
import { driven } from './legs/balance';
import type { Trunk } from './legs/trunk';
import { walking } from './legs/walking';
import { handStep, HOLD, placeArm } from './hands/arms';
import { armClear } from './hands/arm-clearance';
import { hanging } from './hands/hang';
import { steadied } from './hands/plan';
import { lookAround } from './look/around';
import type { Floor } from '../step/floor';
import type { ArmPosture } from '../kernel/asks';
import { Impact } from './legs/impact';
import { trunkOf } from './springs';
import type { Seat } from './legs/seat';
import type { SelfOptions } from '../body/setup';

/** an arm posed nowhere off its hang */
const still = (): Required<ArmPosture> => ({ shrug: 0, forward: 0, out: 0, twist: 0, elbow: 0 });

/** How a person's stride carries its trunk, as its arms and eyes follow it (`Trunk.settle`, each sub-step). */
export interface GaitState {
  /** the stride's phase (rad): 0 as the left foot lifts, π as the right does */
  phase: number;
  /** 0 standing … 1 walking, 0 walking … 1 running */
  walk: number; run: number;
  /** the pelvis's and the thorax's turn with the stride (rad, + to the left) */
  pelvisYaw: number; thoraxYaw: number;
  /** how far the trunk bows forward as the legs carry it (rad, + forward; − arched back): a story's, a reach's, a look's and a crouch's */
  bow: number;
  /** how far its arms swing walking, as its legs have it (1: as tuned) */
  arms: number;
}

/** Humanoid balance, idle gaze and arms, and held-object fitting. */
export class Person extends Self {
  readonly impact = new Impact();
  readonly gaitState: GaitState = { phase: 0, walk: 0, run: 0, pelvisYaw: 0, thoraxYaw: 0, bow: 0, arms: 1 };
  /** its trunk over its root, made with its balance */
  trunk: Trunk | null = null;
  seat: Seat | null = null;
  declare readonly gazer: Gazer;
  /** what its hands carry this sub-step and along which guide: fitted to the wrists after the hands */
  readonly carrying = new Map<Object3D, MovingFrame>();
  readonly proportions: Proportions;
  readonly stride: Stride;
  /** each arm's pose asked this sub-step (`pose`): the free arm's hang takes it, and clears it */
  readonly armPose: Record<Side, Required<ArmPosture>> = { left: still(), right: still() };
  readonly drawingBack: Record<Side, number> = { left: -Infinity, right: -Infinity };
  /** a pose to try an arm on (`canHold`) */
  private readonly scratch = new BonePose(this.skeleton);
  /** poses to try an arm on: as the arm brings the hand to a carry's end, and each grasp tried from there */
  readonly trials = { brought: new BonePose(this.skeleton), trial: new BonePose(this.skeleton) };
  /** where each arm hangs from as a frame its hand is carried in (`shoulderOf`): made when first read */
  shoulders: Record<Side, MovingFrame> | null = null;

  constructor(species: AnySpecies, options: SelfOptions, binding: Binding) {
    const proportions = species.person;
    if (!proportions || !species.gaze) throw new Error('a person is made of a humanoid species');
    super(species, options, binding, (skeleton, floor) => relaxed(proportions, new BonePose(skeleton), floor, options.at ?? new Vector3(), options.face ?? 0), trunkOf(proportions, binding));
    this.proportions = proportions;
    this.stride = species.stride ?? {};
  }

  /** a person's: if its arm, posed onto it afresh, keeps clear of its trunk */
  canHold(f: Frame, hand: string, wrist: Goal): boolean {
    const side = sideOf(hand), frame = { current: this.scratch.copy(f.current) };
    placeArm(this, frame, side, wrist);
    return armClear(frame.current, this.proportions, side);
  }

  /** a person's hands: both at once, the right leading */
  protected stageHands(): HandStaging {
    return personHands(this);
  }

  /** before the head aims at `point`: the body bows and lowers to see low down */
  gazeAsks(pose: ReadonlyBonePose, point: Readonly<Vector3>): void {
    gazeAsks(this, pose, point);
  }

  protected behave(): Behaviours {
    const seed = this.life.seed;
    const arms = { left: new LimbMover('leftArm'), right: new LimbMover('rightArm') }, held = { left: keptOnBody(this, 'left'), right: keptOnBody(this, 'right') };
    const taking: Partial<Record<Side, readonly [Thing, string]>> = {}, noted = new WeakSet<object>();
    return {
      balance: this.drive ? driven(this, seed) : walking(this, { seed }),
      // (unseeded, glances vary with where the body was made, as its balance does: a crowd does not look aside in step)
      gaze: looking(this, lookAround(this, seed ?? seedOf('gaze', this.proportions.height, this.pose.position(0).x, this.pose.position(0).z))),
      hands: hanging(this),
      idleHold: (f, hand) => {
        const side = sideOf(hand), hold = this.holding[side];
        if (!hold) return;
        if (hold.idle) return hold.idle(f);
        const thing = hold.thing;
        // (what hangs from the hand stays where the hand holds it on the body; what the body wears or carries in both hands the hands
        // follow; to keep a hand on what rests where it lies, or on another body, the body comes along — down to it, or after it)
        if (inHand(this, thing)) return handStep(this, f, side, held[side](f), { ...HOLD, bodyFollows: false }, arms[side]);
        // (what both hands hold before the body goes with the chest they hang from, not the hips: the arms hang from the chest, so it stays
        // in the hands as the trunk bows or straightens)
        if (!this.carrying.has(thing.object)) carryAlong(this, f, thing.object, INDEX.chest);
        handStep(this, f, side, steadied(this, side, hold), { on: this.movingFrameOf(thing.object), thing, ...HOLD, bodyFollows: bodyOf(thing.object) !== this }, arms[side]);
      },
      things: (f) => {
        checkParents(this);
        checkTaking(this, f, taking);
        move(this, f, this.carrying);
        checkHeld(this, f, noted);
        this.carrying.clear();
        bear(this, f, this.worn, this.borne);
      },
    };
  }
}

/** An idle holding hand keeps its last root-relative pose while the body walks and turns. */
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

/**
 * How far a hand may be from a grip it starts holding (m): a reach ends once the wrist is within `REACHED.distance`, and the same frame's
 * hold step and fit have an additional 2 cm allowance: artistic calibration for apparent contact during acquisition, not measured anatomy.
 */
const GRIP_TAKEN = REACHED.distance + 0.02;
/** How far a hand may be from the grip it holds on what is on the body (m): a hand on what the body carries or turns briskly lags it by
 * its own braking, a few centimetres, before it closes up again */
const HELD = 0.05;
/** Tuned: how far (m) a hand may lag a thing off the body the app moves before it has been left behind (a door walked with lags 5 cm) */
const LEFT_BEHIND = 0.15;

/** how far hand `side`'s wrist is from where `hold` puts it as the body is posed now (read afresh: a thing hanging from a hand moves with
 * it after the hands): its goal on the grip (a palm short of the turn its placement asks is put where the turn would have it) */
function gripGap(person: Person, f: Frame, side: Side, hold: Hold): number {
  return f.current.position(person.hands[side]).distanceTo(gripWorld(person, hold));
}

/** where `hold` puts its hand's wrist on its thing as the body is posed now (world) */
function gripWorld(person: Person, hold: Hold): Vector3 {
  const at = placedFor(person, hold.thing.object, _placed);
  return _grip.copy(hold.goal.position).applyQuaternion(at.quaternion).add(at.position);
}

/** each grip a hand has just taken, its palm as near it as a grip taken is: else what took it misses */
function checkTaking(person: Person, f: Frame, taking: Partial<Record<Side, readonly [Thing, string]>>): void {
  for (const side of SIDES) {
    const hold = person.holding[side], was = taking[side];
    taking[side] = hold ? [hold.thing, hold.grip] : undefined;
    if (!hold || (was?.[0] === hold.thing && was[1] === hold.grip)) continue;
    const value = gripGap(person, f, side, hold);
    if (value > GRIP_TAKEN) hold.by?.fail({ where: `${hold.thing.object.name} ${side} ${hold.grip}`, off: value, limit: GRIP_TAKEN, why: `the palm closed ${(100 * value).toFixed(1)} cm off its grip` });
  }
}

/** Check final grip distance after fitting, once per hold (not of what hangs from its hand, which goes with it): unreachable carries draw
 * the wrists together and off their grips, a hand on what the body wears is held off it by its joints, and a thing the app moves (a door
 * swung) leaves a body standing behind. The verb moving that hand then misses; a hand no verb moves has nothing to miss: on what the body
 * wears, it is in the dev log, as a jump's lag is; on what the app moves, it is said on the console. */
function checkHeld(person: Person, f: Frame, noted: WeakSet<object>): void {
  for (const side of SIDES) {
    const hold = person.holding[side];
    if (!hold || inHand(person, hold.thing) || noted.has(hold)) continue;
    const value = gripGap(person, f, side, hold);
    const worn = bodyOf(hold.thing.object) !== null, limit = worn ? HELD : LEFT_BEHIND;
    if (value <= limit) continue;
    noted.add(hold);
    const name = hold.thing.object.name, off = (100 * value).toFixed(1), mover = person.claims.owner(`hand.${side}`)?.request;
    if (mover?.kind === 'mover') mover.fail({ where: `${name} ${side}`, off: value, limit, why: `the hand was drawn ${off} cm off its grip, ${limitOf(person, side)(gripWorld(person, hold))}: ask for a place nearer the body, or less turned` });
    else if (worn) f.dev?.append(f.time, { check: 'held grip distance (m)', value, limit, where: `${name} ${side}` });
    else person.warn(`held ${name} ${side} ${f.time}`, `the ${side} hand holding "${name}" has fallen ${off} cm off its grip, and it keeps its hold: walk the body with what moves it, or release it`);
  }
}

/** Start relaxed on `floor` at `at` (its x and z), facing `yaw`, with flat feet each on the floor under it and the pelvis within standing reach. */
function relaxed(proportions: Proportions, pose: BonePose, floor: Floor, at: Vector3, yaw: number): BonePose {
  for (const { bone, rotation } of relaxedPose()) pose.setLocal(bone, rotation);
  pose.setLocal(0, new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw));
  const standing = floor(at.x, at.z) + proportions.hipHeight;
  pose.setRoot(new Vector3(at.x, standing, at.z));
  pose.facing = yaw;
  const feet = standingFeet(proportions, at.x, at.z, yaw), reach = STANDING_REACH * proportions.legLength;
  for (const foot of feet) foot.position.y += floor(foot.position.x, foot.position.z);
  // (no higher than the legs reach)
  let y = standing;
  SIDES.forEach((side, s) => {
    const hip = pose.position(INDEX[`${side}UpperLeg`]), ankle = feet[s].position;
    y = Math.min(y, ankle.y + Math.sqrt(reach * reach - (hip.x - ankle.x) ** 2 - (hip.z - ankle.z) ** 2) + standing - hip.y);
  });
  pose.setRoot(new Vector3(at.x, y, at.z));
  SIDES.forEach((side, s) => {
    const { position, yaw: heading } = feet[s];
    const knee = forwardOf(heading).add(pose.position(INDEX[`${side}UpperLeg`]));
    solveChain({ current: pose }, legOf(side), { tip: { position, quaternion: footRotation(heading, 0) }, pole: knee });
  });
  return pose;
}

const _q = new Quaternion(), _grip = new Vector3(), _placed = { position: new Vector3(), quaternion: new Quaternion() };
