import { Vector3 } from 'three';
import { parallel } from '@pmndrs/timeline';
import { during } from '../kernel/requests';
import { selfOf, type Body } from '../body/body';
import { personOf } from '../body/person';
import { heading } from '../look/head';
import { HOLD, reaching } from '../hands/person/arms';
import { INDEX, type Side } from '../species/humanoid/bones';
import { finder, type Target } from './targets';
import { verb, type Until, type Verb } from './story';

/** how far a tracked hand may be off a target past `reach` × its arm's length (m, default body) — as far as a reach is let end — and for
 * how much of the last few seconds: its time short, each second of it counting less by e⁻¹ every `window` s, up to what `seconds` short at
 * a stretch comes to (so a target out of reach for a fifth or more of each stroke of a gesture is said, as one out of reach for half a
 * second is) */
const OFF = { distance: 0.02, reach: 0.98, seconds: 0.5, window: 3 };
const SHORT = OFF.window * (1 - Math.exp(-OFF.seconds / OFF.window));

/** What a tracked person follows: its head (the eyes' middle, turned as the head is) and its hands (the wrists), each a target. */
export type Tracked = Partial<Record<'head' | Side, Target>>;

/**
 * A person following tracked poses (a headset and controllers, `Object3D`s as XR gives them, or any targets): the head goes where its
 * target is, turned as it is, the spine bending under it and the feet stepping round and under it; each hand keeps to its target, turned
 * as it is, as briskly as a hand keeps to what it holds (`HOLD`: a controller is where the hand is), within its arm's reach of the
 * shoulder (`species.person.armLength`, beside `shoulderHeight` and the other measures: place scripted targets from them, not in metres).
 * Scripted targets make gestures that must follow a path at once (a clap, a fist pump); for one an arm's angles describe (raised, spread,
 * a wave), `pose`'s `arms` is simpler. An aimer, it keeps on until `until`; ended, each hand goes back to its hang, clear of the trunk.
 * It asks for the eyes, the legs and the trunk with a head, and for each hand it is given.
 */
export function track(body: Body, tracked: Tracked, options: { until?: Until } = {}): Verb {
  return verb(body, 'track', (request) => function* () {
    const person = personOf(selfOf(body)), branches = [];
    if (tracked.head) {
      const head = heading(person, finder(person, tracked.head));
      branches.push(during(request, 'go', 'asked', head.under), during(request, 'look', 'asked', head.look));
    }
    for (const side of ['left', 'right'] as const satisfies readonly Side[]) {
      const target = tracked[side];
      if (!target) continue;
      const find = finder(person, target), keep = reaching(person, side, find, { ...HOLD, lead: false });
      // (development: a hand `OFF.distance` off where its target was a sub-step before, the target past the arm held out straight from
      // the shoulder, for long enough of the last few seconds (`OFF`), is said once, as a reach that falls short is; a hand lagging a
      // target in reach is not)
      let short = 0, said = false;
      const shoulder = INDEX[`${side}UpperArm`];
      let last: Vector3 | null = null;
      branches.push(during(request, `hand.${side}`, 'asked', (f) => {
        if (f.dev && !said && last) {
          const gap = f.prev.position(person.hands[side]).distanceTo(last);
          const from = f.prev.position(shoulder).distanceTo(last), beyond = from > OFF.reach * person.proportions.armLength;
          short = short * Math.exp(-f.dt / OFF.window) + (beyond && gap > OFF.distance * person.scale ? f.dt : 0);
          if (short >= SHORT) {
            said = true;
            f.dev.append(f.time, { check: 'tracked hand short of a target out of reach (m)', value: gap, limit: OFF.distance * person.scale, where: side,
              detail: `the shoulder ${from.toFixed(2)} m from it, the arm ${person.proportions.armLength.toFixed(2)} m (species.person.armLength)` });
          }
        }
        keep(f);
        (last ??= new Vector3()).copy(find(f).position);
      }));
    }
    yield* parallel('all', ...branches);
  }, options.until, true);
}
