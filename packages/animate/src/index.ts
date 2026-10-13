// The generic core: an articulated body whose behaviour timeline writes its pose, layer by layer.
export { Skeleton, type BoneDef, type Limit, type SkeletonOptions } from './core/skeleton';
export { Pose } from './core/pose';
export { Body, STEP, type BodyOptions, type Frame } from './core/body';
export { solveChain, type ChainGoal } from './core/chain';
export { follow, followRotation, type FollowOptions } from './core/follow';
export { clampRotation, beyond } from './core/limits';

// The humanoid layer: a viverse character model as a body.
export { BONES, INDEX, PARENT, SIDES, type BoneName, type ChildBone, type Side } from './humanoid/bones';
export { Humanoid, type HumanoidOptions } from './humanoid/humanoid';
export { createSkeletonModel } from './humanoid/model';
export { landmarksOf, pointsOf, type BonePoint, type Landmark, type LandmarkName, type PointName } from './humanoid/landmarks';
export { ranges } from './humanoid/profile/limits';
export { relaxedPose } from './humanoid/profile/relaxed';
export { DEFAULT_HEIGHT, type Proportions } from './humanoid/proportions';
export { Rig, yawOf } from './humanoid/rig';
export { CHAINS, massFor, skeletonOf, type Chain } from './humanoid/skeleton';
export { defaultStance, type Stance } from './humanoid/stance';
export { createStatus, type Effector, type Foot, type FootPhase, type Intent, type Status } from './humanoid/status';
export { createWorld, type Box, type Ladder, type Mount, type Seat, type Sphere, type World, type WorldEvent } from './humanoid/world';
