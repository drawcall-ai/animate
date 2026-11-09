// For authoring a creature of your own: `species` and what its definition takes.
export { species, type Gazer, type LegRole, type Range, type Roles, type Tuning, type Vec3 } from './species/define';
export type { Inertial } from './kernel/inertia';
export type { Spring } from './species/spring';
export type { TrunkMotion, Gait } from './species/gait';
export type { JointCycle } from './species/cycle';
export type { TrunkBones } from './creature/trunk-motion';
export { trunkMotions, footfalls, powerGait } from './species/schedule';
export { scaled } from './species/scaled';
export { swing, type Rhythm } from './kernel/life';
