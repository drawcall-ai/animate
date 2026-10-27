// The story surface: bodies of a species, and the verbs that move them.
// What a species of your own needs is in '@drawcall/animate/species'.

export { Body, type BodyOptions, type Foot, type Owner, type Owners } from './body/body';
export type { Root } from './legs/legged';
export type { Temperament } from './species/define';
export { humanoid, type HumanoidBone } from './species/humanoid/humanoid';
export { horse, type HorseBone } from './species/horse';
export { dog, type DogBone } from './species/dog';
export { species, type Species } from './species/define';
export { walkTo, arriving, type WalkOptions } from './verbs/walk';
export { lookAt, type LookOptions } from './verbs/look';
export { track, type Tracked } from './verbs/track';
export { grab, type GrabOptions } from './verbs/grab';
export { reach, type ReachOptions } from './verbs/reach';
export { carry, type CarryOptions } from './verbs/carry';
export { release } from './verbs/release';
export { wait, watch, type Until, type Verb } from './verbs/story';
export type { Target } from './verbs/targets';
export type { LogEntry, Problem } from './kernel/dev';
export type { ReadonlyPose } from './kernel/pose';
