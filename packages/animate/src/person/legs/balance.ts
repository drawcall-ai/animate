// A person's body over its root, whoever drives it: the core stepper keeps the legs under it; here the trunk, the leg chains and the checks.
import type { Frame, Behaviour } from '../../kernel/frame';
import { lerp, wrapAngle } from '../../kernel/math';
import { Stepper } from '../../step/stepper';
import { Asks } from '../../kernel/asks';
import type { LegGoal } from '../../step/leg-goal';
import { seedOf } from '../../kernel/random';
import { variationOf, type Variation } from './variation';
import { checkLegs } from './checks';
import { personFeet, pivotingFeet } from './foot';
import { poseLeg } from './leg';
import { Trunk } from './trunk';
import { drivenRoot } from '../../step/root';
import { personStepping } from './stepping';
import { standingFeet } from '../anatomy/stance';
import type { Person } from '../person';
import type { Steering } from '../../step/types';

/**
 * Legs under a root the app drives (`drive`, read every sub-step; see `Stepper`) — its hips over the floor, as a game's character
 * capsule carries them: a leap it asks is taken as soon as the feet can, and `airborne` says when it is in the air; the body over it is
 * carried as a walker's is (`balancing`). Development checks: planted slide, touchdown speed, feet across; not its XCoM, which follows its input, not its balance.
 */
export function driven(person: Person, seed?: number): Behaviour {
  return balancing(person, drivenRoot(person), { foreseen: false, variation: variationOf(seedFor(person, seed)), seed });
}

/** the seed a person's life and variation are drawn from: `seed` if given, else one from its build and where it was made */
export function seedFor(person: Pick<Person, 'proportions' | 'pose' | 'yaw'>, seed?: number): number {
  if (seed !== undefined) return seed;
  const root = person.pose.position(0), standing = standingFeet(person.proportions, root.x, root.z, person.yaw);
  return seedOf(person.proportions.height, standing[0].position.x, standing[0].position.z);
}

/**
 * `driven`, the root read each sub-step from `rootOf` once what was asked is taken (a scene's; a planner's, toward where its legs are asked to go). Whoever
 * drives it, the body is carried over it one way, as `WalkPose` has it: the hips swaying and turning with the stride about the root
 * (off a centre of mass's as far as the body's mass leans ahead of them), the trunk leaning with the pace its legs could have taken it
 * to (`PACE`), nodding, bowed and twisted as asked, the thorax counter-rotating. Let down as asked (`lower`) or as the root crouches it,
 * the legs crouch (below none: up on the toes). Standing, it breathes, sways and shifts its weight now and then (seeded by `seed`),
 * less as it holds still (`steady`). It steps, swings its arms and sways as the `variation` it is; `foreseen`: `Stepper.foreseen`.
 */
export function balancing(person: Person, rootOf: (f: Frame, go: LegGoal | null, asks: Asks, stepper: Stepper) => Steering, options: { foreseen: boolean; seed?: number; variation: Variation }): Behaviour {
  const { foreseen, variation } = options, proportions = person.proportions;
  const feet = personFeet(proportions);
  // (the feet where they stand as it is made: in its stance under it)
  const standing = standingFeet(proportions, person.pose.position(0).x, person.pose.position(0).z, person.yaw);
  const stepper = person.stepper = new Stepper(personStepping(proportions, foreseen, person.stride, variation), foreseen ? feet : pivotingFeet(proportions, feet), standing, person.yaw, person.floor, foreseen);
  const asks = new Asks();
  const depth = personStepping(proportions, true, person.stride).crouch.depth;
  const trunk = person.trunk = new Trunk(person, stepper, variation, seedFor(person, options.seed), depth, standing);
  return (f) => {
    if (f.dev && f.time > f.dt) checkLegs(person, f, f.dev, stepper.legs);
    person.asks.pass(asks);
    // (seated, the legs asked elsewhere stand it first; the seat's own height and bow over what the parts ask)
    const seat = person.seat?.step(f.dt, asks.legGoal) ?? null;
    const go = seat ? null : asks.legGoal, root = rootOf(f, go, asks, stepper);
    if (seat) [asks.lower, asks.posture.lower, asks.bow] = [lerp(asks.lower, seat.seating.lower, seat.share), asks.posture.lower * (1 - seat.share), Math.max(asks.bow, seat.bow)];
    stepper.move(f, trunk.steer(f, root, go, asks, seat));
    const { yaw, legs } = stepper;
    trunk.pose(f, asks, yaw);
    // the legs down to the feet
    legs.forEach((leg, i) => poseLeg(f, stepper, leg, i));
    const locomotion = person.locomotion, stepping = legs.some((leg) => leg.swing);
    trunk.settle(legs);
    locomotion.facing = wrapAngle(yaw);
    // (a walker's walk under way, as its planner says — its weight shifting over planted feet is none; a player's root moving)
    locomotion.moving = (root.underway ?? Math.hypot(root.velocity.x, root.velocity.z) > 0.05) || stepping;
    locomotion.velocity.copy(root.velocity).setY(0);
    locomotion.settled = stepper.settled && (!seat || seat.seated);
  };
}
