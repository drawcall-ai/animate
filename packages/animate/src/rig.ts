// The parts the root API builds its bodies and verbs from, for writing behaviours of your own.

// moving bones from the pose history toward a goal, for any rig
export { solveChain, type ChainGoal } from './core/chain';
export { follow, followRotation } from './core/follow';
export type { FollowOptions } from './core/goal';
export { ChainTip, chainTo, reached, type TipOptions } from './core/tip';
export { TrackedPoint, TrackedRotation } from './core/track';
export { SHIFT, type Gazer } from './core/gaze';
// how far a person's arm holds out, a share of its length
export { ARM_REACH } from './humanoid/arms';
// easing, spin and drift for motion of your own
export { minimumJerk } from './core/math';
export { spinOf } from './core/rotation';
export { irregular, seeded } from './core/random';
// a body's base, to run yourself under `idle: false`
export { idle, personIdle } from './humanoid/idle';
// what tasks ask of the base's legs and balance
export { ask, request, type Asks, type Go } from './core/asks';
// the root a creature's legs step under (`IdleOptions.root`), and a planner's fuller one
export type { RootGoal } from './core/legs/stepper';
// rhythms for a posture of a species' own
export { Life } from './core/life';
// where a person stands to take something
export { approach } from './humanoid/hands/grab';
