// The newcomer surface: bodies, their species, items and the verbs that move them.
// Parts for building behaviours of your own are in '@drawcall/animate/rig'.

// Any body: a skeleton whose behaviour timeline writes its pose, layer by layer.
export { Skeleton, type BoneDef, type Limit, type SkeletonOptions } from './core/skeleton';
export { Pose, type ReadonlyPose } from './core/pose';
export { Body, type BodyOptions, type Frame, type IdleOptions, type Jumper } from './core/body';
export { World } from './core/world';
export type { Attention, Posture, Species } from './core/species';
export { scaled } from './core/scaled';
export { swing, type Rhythm } from './core/life';
export { facingAt, live, onBone, type Behaviour, type Live, type Motion, type Placement, type Target, type Until } from './core/goal';
export { when } from './core/when';
export { named, watch, type LogEntry, type Problem, type WatchFrame } from './core/dev';
export { Carrier, Item, onItem, type ItemOptions } from './core/carrier';
export { takeOff, wear, type Dressed, type WearOptions } from './core/worn';
export { yawOf } from './core/math';
export { aimAt, lookAt, withGaze, type GazeOptions } from './core/gaze';
// legs for your own creature, and a horse
export type { LegChain } from './core/legs/legs';
export type { JointCycle } from './core/legs/cycle';
export type { Gait, Locomotion } from './core/legs/gait';
export { powerGait } from './core/legs/schedule';
export type { Carriage, CarriedBones } from './core/legs/carriage';
export type { DrivenRoot } from './core/legs/stepper';
export { horse, horseLeadPoint } from './horse/legs';

// A person: a viverse character model as a body.
export { human, isPerson, type Humanoid } from './humanoid/humanoid';
export { createSkeletonModel } from './humanoid/model';
export { INDEX, SIDES, type BoneName, type Side } from './humanoid/bones';
export type { Proportions } from './humanoid/proportions';

// Verbs.
export { arriving, walkTo, type WalkOptions } from './core/walk';
export type { Stance } from './core/asks';
export { grab, type GrabOptions, type Spot } from './humanoid/hands/grab';
export { carry, hold, type CarryOptions, type HoldOptions } from './humanoid/hands/carry';
export type { Holds, Way } from './core/hands';
export { still, type Waypoint } from './core/course';
export { place } from './humanoid/hands/place';
export { release, type ReleaseOptions } from './humanoid/hands/release';
export { touch } from './humanoid/hands/touch';
export { holds, offer, offered } from './humanoid/hands/offer';
export { handTo, type HandOptions } from './humanoid/arms';
export { carried } from './humanoid/goal';
export { lookAround, type LookAroundOptions } from './humanoid/look';
export { headTo, type HeadOptions } from './humanoid/head';
export { eyesOnBefore } from './humanoid/watch';
