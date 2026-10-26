// The story surface: bodies of a species, and the verbs that move them.
// What a species of your own needs is in '@drawcall/animate/species'.

export { Body, type BodyOptions, type Foot, type Goal, type Goals } from './body/body';
export type { Driven, Life } from './body/self';
export { humanoid, type HumanoidBone } from './humanoid/species';
export { horse, type HorseBone } from './horse/horse';
export { dog, type DogBone } from './dog/dog';
export { species, type Species } from './core/species';
export { walkTo, arriving, type WalkOptions } from './verbs/walk';
export { lookAt, type LookOptions } from './verbs/look';
export { track, type Tracked } from './verbs/track';
export { wait, watch, type Until, type Verb } from './verbs/story';
export type { Target } from './verbs/targets';
export type { LogEntry, Problem } from './core/dev';
export type { ReadonlyPose } from './core/pose';
