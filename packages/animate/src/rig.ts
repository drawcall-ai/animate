// The parts the root API builds its bodies and verbs from, for writing behaviours of your own.

// moving bones from the pose history toward a goal, for any rig
export { solveChain, type ChainGoal } from './core/chain';
export { follow, followRotation } from './core/follow';
export type { FollowOptions } from './core/goal';
export { ChainTip, chainTo, type TipOptions } from './core/tip';
export { TrackedPoint, TrackedRotation } from './core/track';
export type { Gazer } from './core/gaze';
// a body's base, to run yourself under `idle: false`
export { idle, personIdle } from './humanoid/idle';
// what tasks ask of the base's legs and balance
export { ask, type Asks, type Go, type Stance } from './core/asks';
export { Stepper, type Stepping, type Feet } from './core/legs/stepper';
// where a person stands to take something
export { approach } from './humanoid/hands/grab';
