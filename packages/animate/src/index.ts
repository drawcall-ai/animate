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
export { gazeOff, GLANCE, lookAt, SHIFT, type Gazer } from './core/gaze';
export { clampRotation, beyond } from './core/limits';
export { when } from './core/when';
export { Glide } from './core/glide';

// The humanoid layer: a viverse character model as a body.
export { BONES, INDEX, PARENT, SIDES, type BoneName, type ChildBone, type Side } from './humanoid/bones';
export { Humanoid, type HumanoidOptions } from './humanoid/humanoid';
export { ask, createAsks, type Asks, type Go } from './humanoid/asks';
export { balance, type Gait } from './humanoid/balance/balance';
export type { Foot, FootPhase } from './humanoid/balance/foot';
export { CALM, handTo, hangArms, type HandOptions } from './humanoid/arms';
export { approach, grab, type Stand } from './humanoid/hands/grab';
export { CARRYING, carry, carryTogether, hold, type CarryOptions } from './humanoid/hands/carry';
export { closeHand, openHand, type Grips, type Holds } from './humanoid/hands/grips';
export { reachFor } from './humanoid/hands/reach';
export { release } from './humanoid/hands/release';
export { course, still, type Course, type Leg } from './humanoid/course';
export { onBone, carried } from './humanoid/goal';
export { takeOff, wear, type Dressed, type Wearing } from './core/worn';
export type { Bearing } from './humanoid/worn';
export { HEADSET, headTo, type HeadOptions } from './humanoid/head';
export { pelvisTo, trunkTo } from './humanoid/trunk';
export { lookAround, withGaze, scan } from './humanoid/look';
export { idle } from './humanoid/idle';
export { arriving, walkTo, type WalkOptions } from './humanoid/walk';
export { defaultStance, type Stance } from './humanoid/stance';
export { createSkeletonModel } from './humanoid/model';
export { landmarksOf, pointsOf, type BonePoint, type Landmark, type LandmarkName, type PointName } from './humanoid/landmarks';
export { ranges } from './humanoid/profile/limits';
export { relaxedPose } from './humanoid/profile/relaxed';
export { DEFAULT_HEIGHT, type Proportions } from './humanoid/proportions';
export { Rig } from './humanoid/rig';
export { yawOf, headingOf, minimumJerk } from './core/math';
export { CHAINS, massFor, skeletonOf, type Chain } from './humanoid/skeleton';
export { createWorld, type World } from './humanoid/world';

export { named, watch, type Problem, type LogEntry, type WatchFrame } from './core/dev';
export { eyesOnBefore } from './humanoid/watch';

export { Legs, type LegChain, type Rocker, type LegState, type LegStep, type ContactEvent } from './core/legs/legs';
export type { LegGait } from './core/legs/gait';
export type { JointCycle } from './core/legs/cycle';
export { humanLegs, humanGait } from './humanoid/leg-data';
export { horseLegs, horseCarriage, horsePelvis, HORSE_WALK, HORSE_TROT } from './horse/legs';
export { SKELETON as HORSE_SKELETON } from './horse/skeleton';
