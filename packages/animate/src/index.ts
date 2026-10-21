// Any body: a skeleton whose behaviour timeline writes its pose, layer by layer.
export { Skeleton, type BoneDef, type Limit, type SkeletonOptions } from './core/skeleton';
export { Pose, type ReadonlyPose } from './core/pose';
export { Body, type BodyOptions, type Frame, type IdleOptions } from './core/body';
export { World } from './core/world';
export type { Attention, Posture, Species } from './core/species';
export { Life, swing, type Rhythm } from './core/life';
export { facingAt, live, onBone, type Behaviour, type Live, type Motion, type Placement, type Target, type Until } from './core/goal';
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
export { aimAt, lookAt, withGaze, type Gazer } from './core/gaze';
// legs for any creature, and a horse
export type { LegChain } from './core/legs/legs';
export type { JointCycle } from './core/legs/cycle';
export type { Gait, Locomotion } from './core/legs/gait';
export { powerGait } from './core/legs/schedule';
export type { Carriage, CarriedBones } from './core/legs/carriage';
export { horse, horseLeadPoint } from './horse/legs';

// A humanoid: a viverse character model as a body.
export { human, isPerson, type Humanoid } from './humanoid/humanoid';
export { createSkeletonModel } from './humanoid/model';
export { INDEX, SIDES, type BoneName, type Side } from './humanoid/bones';
export type { Proportions } from './humanoid/proportions';
export { Stepper, type DrivenRoot, type Stepping, type Feet } from './core/legs/stepper';
export { ask, type Asks, type Go, type Stance } from './core/asks';
export { arriving, walkTo, type WalkOptions } from './core/walk';
export { approach, grab, type Spot } from './humanoid/hands/grab';
export { carry, hold, type Way } from './humanoid/hands/carry';
export { place } from './humanoid/hands/place';
export { release } from './humanoid/hands/release';
export { handTo, type HandOptions } from './humanoid/arms';
export type { Holds } from './core/hands';
export { still, type Waypoint } from './humanoid/course';
export { carried } from './humanoid/goal';
export { lookAround } from './humanoid/look';
export { headTo, type HeadOptions } from './humanoid/head';
export { eyesOnBefore } from './humanoid/watch';
