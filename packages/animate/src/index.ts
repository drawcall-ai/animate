// The story surface: bodies of a species, and the verbs that move them.
// What a species of your own needs is in '@drawcall/animate/species'.

export { Body, type BodyOptions, type Foot, type Goal, type Goals } from './body/body';
export type { Driven, Life } from './body/self';
export { humanoid, type HumanoidBone } from './humanoid/species';
export { horse, type HorseBone } from './horse/horse';
export { dog, type DogBone } from './dog/dog';
export { species, type Species } from './core/species';
export type { LogEntry, Problem } from './core/dev';
export type { ReadonlyPose } from './core/pose';
