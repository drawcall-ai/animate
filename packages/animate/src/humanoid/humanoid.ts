import { NECK_PITCH } from './profile/limits';
import { Quaternion, Vector3 } from 'three';
import type { CharacterModel } from '@pmndrs/viverse';
import { Body, type Frame } from '../core/body';
import type { Item } from '../core/carrier';
import { solveChain } from '../core/chain';
import type { Gazer } from '../core/gaze';
import type { Behaviour } from '../core/goal';
import { Pose, type ReadonlyPose } from '../core/pose';
import { createAsks, type Asks } from './asks';
import { createGait, type Gait } from './balance/balance';
import { footRotation, type Foot } from './balance/foot';
import { legOf, STANDING_REACH } from './balance/legs';
import { INDEX, SIDES, type Side } from './bones';
import { forwardOf, leftOf, yawOf } from '../core/math';
import { relaxedPose } from './profile/relaxed';
import type { Proportions } from './proportions';
import { gazeAsks } from './reach-posture';
import { Rig } from './rig';
import { defaultStance, footYaw, stanceFeet } from './stance';
import { load, dress, type Bearing } from './worn';
import { followHeld } from './hands/hold';
import type { Dressed } from './worn';

export interface HumanoidOptions<W> {
  world?: W;
  /** Enable final-pose checks and read-only watchers. Default off. */
  dev?: boolean;
  /** where the body stands (on the floor, y = 0) */
  position?: { x: number; z: number };
  /** its facing about +Y (0 faces +Z) */
  yaw?: number;
  /** what it wears from the start, for its proportions (harness it stands in: worn and borne from the first sub-step, where each piece sits on its bone) */
  wearing?: (p: Proportions) => readonly Dressed[];
}

/**
 * A @pmndrs/viverse character model as a body stepping `behaviour` (made for this humanoid: it
 * may read the rig and the proportions), the model posed after every update. The body starts
 * standing relaxed in its stance where `options` puts it. After the behaviour, every sub-step, it
 * moves the items it wears and loads what it holds and wears onto its bones (their mass counts in
 * its centre of mass). One Humanoid per model.
 */
export class Humanoid<W = unknown> {
  readonly rig: Rig;
  /** measured from the model's rest pose */
  readonly proportions: Proportions;
  /** what the tasks ask of `balance` (see `Asks`) */
  readonly asks: Asks = createAsks();
  /** where the feet stand or, stepping, land [left, right]: `balance`'s output */
  readonly feet: [Foot, Foot];
  /** Shared walk state: balance reports motion, walkTo owns the arrival estimate. */
  readonly gait: Gait;
  /** the neck and the eyes, for `lookAt` */
  readonly gazer: Gazer;
  /** what it wears, each item and what it is worn on (`wear`, `takeOff`: change it through them) */
  get worn() { return this.body.worn; }
  /** how much of each item's weight it bears, held off its support or worn (taken up and given up over a moment), as its centre of mass counts it (kept by the body) */
  readonly borne = new Map<Item, Bearing>();
  /** what each hand holds, by which grip (`closeHand`, `openHand`) */
  readonly holding: Record<Side, { item: Item; grip: string } | null> = { left: null, right: null };
  private readonly body: Body<W>;
  private readonly ground = new Vector3();

  constructor(
    readonly model: CharacterModel,
    behaviour: (h: Humanoid<W>) => Behaviour<W>,
    options: HumanoidOptions<W> = {},
  ) {
    const rig = (this.rig = new Rig(model));
    const p = (this.proportions = rig.proportions);
    const yaw = options.yaw ?? 0;
    const start = standing(p, new Pose(rig.skeleton), options.position ?? { x: 0, z: 0 }, yaw);
    this.feet = start.feet;
    this.gait = createGait(yaw);
    const eyes = rig.points.eyes;
    this.gazer = { neck: 'neck', eyes: (pose, out) => pose.point(eyes.bone, eyes.at, out), range: EYES, pitch: NECK_PITCH * Math.PI / 180,
      lead: (pose, point) => gazeAsks(this, pose, point),
    };
    const worn = dress(this, start.pose, options.wearing?.(p) ?? []);
    const moveHeld = followHeld(this);
    const humanoid = this;
    this.body = new class extends Body<W> {
      protected afterWorn(f: Frame<W>) { moveHeld(f); load(humanoid, f); }
    }(
      rig.skeleton,
      behaviour(this),
      { world: options.world, pose: start.pose, dev: options.dev, scale: p.scale, worn },
    );
    rig.write(this.body.pose, 0);
  }

  get scale(): number { return this.proportions.scale; }

  /** Development problems from checks and watchers. */
  get log() { return this.body.log; }

  /** Current sub-step, for reading live goals when a behaviour starts. */
  get frame(): Frame<W> { return this.body.frame; }

  /** the last final pose */
  get pose(): ReadonlyPose {
    return this.body.pose;
  }

  /** the body's facing about +Y (0 faces +Z): the hips' */
  get yaw(): number {
    return yawOf(this.pose.local(0));
  }

  /** the body's ground velocity over the last sub-step: its centre of mass's, horizontal (m/s); read-only */
  get velocity(): Readonly<Vector3> {
    const { prev, prev2, dt } = this.body.frame;
    const v = prev.com(this.ground).sub(prev2.com(_v)).divideScalar(dt);
    return v.setY(0);
  }

  /** a copy of the last final pose, as other bodies read it */
  snapshot(): Pose {
    return new Pose(this.rig.skeleton).copy(this.pose);
  }

  /** Advances the body by `dt` seconds and poses the model; a VRM is updated by `dt` too. */
  update(dt: number) {
    this.body.update(dt);
    this.rig.write(this.body.pose, dt);
  }
}

const _v = new Vector3();

/**
 * How far the eyes turn in the head comfortably (rad): down, the preferred declination of the line
 * of sight below the head's (29° sitting upright, 34° over all postures, 38° for a near target: Hill
 * & Kroemer 1986, Human Factors 28:127); up and aside, where the eyes end a head-free gaze shift
 * (half the customary ocular motor range, 44° wide on average, and of the eye-only range, 36°:
 * Stahl 1999, Exp Brain Res 126:41; measured horizontally, taken for up as well)
 */
const EYES = { down: (30 * Math.PI) / 180, up: (20 * Math.PI) / 180, side: (20 * Math.PI) / 180 };

/**
 * `pose` standing relaxed at `floor` facing `yaw`: the feet flat where the default stance puts them,
 * the pelvis as high as they reach, the legs solved down to them; and the feet
 */
function standing(p: Proportions, pose: Pose, floor: { x: number; z: number }, yaw: number): { pose: Pose; feet: [Foot, Foot] } {
  for (const { bone, rotation } of relaxedPose()) pose.setLocal(bone, rotation);
  pose.setLocal(0, new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw));
  pose.setRoot(new Vector3(floor.x, p.hipHeight, floor.z));
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
