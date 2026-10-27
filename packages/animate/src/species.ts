// Types and helpers for configuring a custom species.

export type { BoneNames, Gazer, Having, LegRole, Range, Roles, Tuning, Vec3 } from './species/define';
export type { Inertial } from './kernel/inertia';
export type { Carriage, Gait } from './species/gait';
export type { JointCycle } from './species/cycle';
export type { CarriedBones } from './species/carriage';
export { carriages, footfalls, powerGait } from './species/schedule';
export { scaled } from './species/scaled';
export { swing, type Rhythm } from './kernel/life';
