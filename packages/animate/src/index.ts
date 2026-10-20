// Any body: a skeleton whose behaviour timeline writes its pose, layer by layer.
export { Skeleton, type BoneDef, type Limit, type SkeletonOptions } from './core/skeleton';
export { Pose, type ReadonlyPose } from './core/pose';
export { Body, type BodyOptions, type Frame } from './core/body';
export { live, type Behaviour, type Live, type Motion, type Placement, type Target, type Until } from './core/goal';
export { when } from './core/when';
export { named, watch, type LogEntry, type Problem, type WatchFrame } from './core/dev';
export { Item, onItem, type ItemOptions } from './core/carrier';
export { takeOff, wear, type Dressed } from './core/worn';
export { yawOf } from './core/math';
// your own behaviours, for any rig
export { solveChain, type ChainGoal } from './core/chain';
export { follow, followRotation } from './core/follow';
export { ChainTip, chainTo, type TipOptions } from './core/tip';
export { TrackedPoint, TrackedRotation } from './core/track';
export { lookAt, type Gazer } from './core/gaze';
// legs for any creature, and a horse
export { Legs, type LegChain, type LegStep } from './core/legs/legs';
export type { Gait, Locomotion } from './core/legs/gait';
export { horseFollow, horseLeadPoint } from './horse/legs';
export { SKELETON as HORSE_SKELETON } from './horse/skeleton';

// A humanoid: a viverse character model as a body.
export { Humanoid, type HumanoidOptions } from './humanoid/humanoid';
export { createSkeletonModel } from './humanoid/model';
export { createWorld, type World } from './humanoid/world';
export { INDEX, SIDES, type BoneName, type Side } from './humanoid/bones';
export type { Proportions } from './humanoid/proportions';
export { idle } from './humanoid/idle';
export type { DrivenRoot } from './humanoid/driven';
export { ask, type Asks, type Go, type Stance } from './core/asks';
export { arriving, walkTo, type WalkOptions } from './humanoid/walk';
export { approach, grab, type Spot } from './humanoid/hands/grab';
export { carry, carryTogether, hold } from './humanoid/hands/carry';
export { place } from './humanoid/hands/place';
export { release } from './humanoid/hands/release';
export { handTo, type HandOptions } from './humanoid/arms';
export type { Holds } from './humanoid/hands/grips';
export { still, type Waypoint } from './humanoid/course';
export { carried, facingAt, onBone } from './humanoid/goal';
export { aimAt, lookAround, withGaze } from './humanoid/look';
export { headTo, type HeadOptions } from './humanoid/head';
export { eyesOnBefore } from './humanoid/watch';
