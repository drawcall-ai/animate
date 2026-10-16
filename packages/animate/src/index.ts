// The generic core: an articulated body whose behaviour timeline writes its pose, layer by layer.
export { Skeleton, type BoneDef, type Limit, type SkeletonOptions } from './core/skeleton';
export { Pose, type ReadonlyPose } from './core/pose';
export { Body, type BodyOptions, type Frame } from './core/body';
export { solveChain, type ChainGoal } from './core/chain';
export { follow, followRotation } from './core/follow';
export { live, type Behaviour, type FollowOptions, type Live, type Motion, type Placement, type Target, type Until } from './core/goal';
export { Carrier, Item, onItem, type ItemOptions } from './core/carrier';
export { ChainTip, chainTo, reached, type TipOptions } from './core/tip';
export { TrackedPoint, TrackedRotation } from './core/track';
export { GLANCE, lookAt, SHIFT, type Gazer } from './core/gaze';
export { beyond } from './core/limits';
export { when } from './core/when';

// The humanoid layer: a viverse character model as a body.
export { INDEX, SIDES, type BoneName, type ChildBone, type Side } from './humanoid/bones';
export { Humanoid, type HumanoidOptions } from './humanoid/humanoid';
export { ask, type Asks, type Go } from './humanoid/asks';
export { balance, type Gait } from './humanoid/balance/balance';
export type { Foot, FootPhase } from './humanoid/balance/foot';
export { CALM, handTo, type HandOptions } from './humanoid/arms';
export { approach, grab, type Stand } from './humanoid/hands/grab';
export { carry, carryTogether, hold } from './humanoid/hands/carry';
export { closeHand, type Grips, type Holds } from './humanoid/hands/grips';
export { reachFor } from './humanoid/hands/reach';
export { release } from './humanoid/hands/release';
export { course, still, type Course, type Leg } from './humanoid/course';
export { onBone, facingAt, carried } from './humanoid/goal';
export { takeOff, wear, type Wearing } from './core/worn';
export type { Bearing, Dressed } from './humanoid/worn';
export { headTo, type HeadOptions } from './humanoid/head';
export { lookAround, withGaze } from './humanoid/look';
export { idle } from './humanoid/idle';
export { arriving, walkTo, type WalkOptions } from './humanoid/walk';
export type { Stance } from './humanoid/stance';
export { createSkeletonModel } from './humanoid/model';
export type { BonePoint, Landmark, LandmarkName, PointName } from './humanoid/landmarks';
export { DEFAULT_HEIGHT, type Proportions } from './humanoid/proportions';
export { yawOf, headingOf, minimumJerk } from './core/math';
export { massFor, skeletonOf, type Chain } from './humanoid/skeleton';
export { createWorld, type World } from './humanoid/world';

export { named, watch, type Problem, type LogEntry, type WatchFrame } from './core/dev';
export { eyesOnBefore } from './humanoid/watch';

export { Legs, type LegChain, type LegStep } from './core/legs/legs';
export type { LegGait } from './core/legs/gait';
export { horseLegs, horseFollow, HORSE_WALK } from './horse/legs';
export { SKELETON as HORSE_SKELETON } from './horse/skeleton';
