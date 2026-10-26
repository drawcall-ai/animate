// What a species of your own needs: the roles its bones play and its numbers (`species(skeleton, roles, tuning)`), gaits, and the
// parts the library builds its motion from.

export type { BoneNames, Having, LegRole, Range, Roles, Tuning, Vec3 } from './species/define';
export type { Gazer } from './species/define';
export type { Inertial } from './kernel/inertia';
export type { Gait } from './species/gait';
export type { JointCycle } from './species/cycle';
export type { Carriage } from './species/gait';
export type { CarriedBones } from './species/carriage';
export { carriages, footfalls, powerGait } from './species/schedule';
export { scaled } from './species/scaled';
export { Life, swing, type Rhythm } from './kernel/life';
