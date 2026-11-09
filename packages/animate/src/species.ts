// For authoring a creature of your own: `species` and what its definition takes.
export { species, type Gazer, type LegRole, type Range, type Roles, type Tuning, type Vec3 } from './species/define';
export type { Inertial } from './kernel/inertia';
export type { Spring } from './springs';
export type { Carriage, Gait } from './species/gait';
export type { JointCycle } from './species/cycle';
export type { CarriedBones } from './species/carriage';
export { carriages, footfalls, powerGait } from './species/schedule';
export { scaled } from './species/scaled';
export { swing, type Rhythm } from './kernel/life';
