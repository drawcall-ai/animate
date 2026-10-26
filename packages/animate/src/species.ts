// What a species of your own needs: the roles its bones play and its numbers (`species(skeleton, roles, tuning)`), gaits, and the
// parts the library builds its motion from.

export type { BoneNames, Having, LegRole, Range, Roles, Tuning, Vec3 } from './core/species';
export type { Gazer } from './core/gaze';
export type { Inertial } from './core/inertia';
export type { Gait } from './core/legs/gait';
export type { JointCycle } from './core/legs/cycle';
export type { Carriage, CarriedBones } from './core/legs/carriage';
export { carriages, footfalls, powerGait } from './core/legs/schedule';
export { scaled } from './core/scaled';
export { Life, swing, type Rhythm } from './core/life';
