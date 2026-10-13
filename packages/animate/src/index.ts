// The generic core: an articulated body moved by behaviour timelines that propose.
export type * from './core/types';
export { Skeleton, STIFFNESS } from './core/skeleton';
export { BodyState } from './core/state';
export { Board, merge, type Merged, type Outcome } from './core/board';
export { DAMPING } from './core/fit';
export { RAMP } from './core/history';
export { Body, STEP, type BodyOptions, type Ctx } from './core/body';
export { clampRotation, beyond } from './core/limits';

// The humanoid layer: a viverse character model as a body, and humanlike behaviours.
export { BONES, INDEX, PARENT, SIDES, type BoneName, type ChildBone, type Side } from './humanoid/bones';
export { Humanoid, type HumanoidOptions } from './humanoid/humanoid';
export { createSkeletonModel } from './humanoid/model';
export { landmarksOf, pointsOf, type Landmark, type LandmarkName, type PointName } from './humanoid/landmarks';
export { caps } from './humanoid/profile/caps';
export { ranges, type Range } from './humanoid/profile/limits';
export { relaxedPose } from './humanoid/profile/relaxed';
export { DEFAULT_HEIGHT, type Proportions } from './humanoid/proportions';
export { Rig, restPose, yawOf, type Pose } from './humanoid/rig';
export { massFor, skeletonOf } from './humanoid/skeleton';
export { defaultStance, type Stance } from './humanoid/stance';
export { createStatus, type Effector, type Foot, type FootPhase, type Intent, type Status } from './humanoid/status';
export { createWorld, type Box, type Ladder, type Mount, type Seat, type Sphere, type World, type WorldEvent } from './humanoid/world/world';
export { humanoid, feetFacing, supportOf, xcomOf } from './humanoid/behaviours/humanoid';
export { step, type Foothold, type StepOptions } from './humanoid/procedures/step';
export { walk, type WalkOptions } from './humanoid/behaviours/walk';
export { follow, intend, type FollowOptions, type Part } from './humanoid/behaviours/follow';
export { carry, reach } from './humanoid/behaviours/reach';
export { track } from './humanoid/behaviours/track';
export { look } from './humanoid/behaviours/look';
export { Hints, type Hinted } from './humanoid/hints';
