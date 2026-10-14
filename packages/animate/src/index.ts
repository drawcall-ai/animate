// The generic core: an articulated body whose behaviour timeline writes its pose, layer by layer.
export { Skeleton, type BoneDef, type Limit, type SkeletonOptions } from './core/skeleton';
export { Pose, type ReadonlyPose } from './core/pose';
export { Body, STEP, type BodyOptions, type Frame } from './core/body';
export { solveChain, type ChainGoal } from './core/chain';
export { follow, followRotation } from './core/follow';
export { live, REACHED, type Behaviour, type FollowOptions, type Live, type Motion, type Placement, type Target, type Until } from './core/goal';
export { Carrier, Item, onItem, type ItemOptions } from './core/carrier';
export { ChainTip, chainTo, reached, type TipOptions } from './core/tip';
export { TrackedPoint, TrackedRotation } from './core/track';
export { GLANCE, lookAt, type Gazer } from './core/gaze';
export { clampRotation, beyond } from './core/limits';

// The humanoid layer: a viverse character model as a body.
export { BONES, INDEX, PARENT, SIDES, type BoneName, type ChildBone, type Side } from './humanoid/bones';
export { Humanoid, type HumanoidOptions } from './humanoid/humanoid';
export { ask, createAsks, type Asks, type Go } from './humanoid/asks';
export { balance, type Gait } from './humanoid/balance/balance';
export type { Foot, FootPhase } from './humanoid/balance/foot';
export { CALM, handTo, hangArms, type HandOptions } from './humanoid/arms';
export { approach, CARRYING, carry, closeHand, grab, hold, openHand, reachFor, release, type Grips, type Holds, type Stand } from './humanoid/hands';
export { onBone } from './humanoid/goal';
export { takeOff, wear, type Bearing, type Dressed, type Wearing } from './humanoid/worn';
export { HEADSET, headTo, type HeadOptions } from './humanoid/head';
export { pelvisTo, trunkTo } from './humanoid/trunk';
export { lookAround, withGaze } from './humanoid/look';
export { idle } from './humanoid/idle';
export { walkTo, type WalkOptions } from './humanoid/walk';
export { defaultStance, type Stance } from './humanoid/stance';
export { createSkeletonModel } from './humanoid/model';
export { landmarksOf, pointsOf, type BonePoint, type Landmark, type LandmarkName, type PointName } from './humanoid/landmarks';
export { ranges } from './humanoid/profile/limits';
export { relaxedPose } from './humanoid/profile/relaxed';
export { DEFAULT_HEIGHT, type Proportions } from './humanoid/proportions';
export { Rig, yawOf } from './humanoid/rig';
export { headingOf } from './humanoid/math';
export { CHAINS, massFor, skeletonOf, type Chain } from './humanoid/skeleton';
export { createWorld, type World } from './humanoid/world';
