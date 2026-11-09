import { Vector3 } from 'three';
import { parallel } from '@pmndrs/timeline';
import { during, type Request } from '../kernel/requests';
import { REACH } from '../kernel/limb';
import { finder } from '../things/target';
import type { Tracked } from '../verbs/track';
import { INDEX, type Side } from './anatomy/bones';
import { HOLD, reaching } from './hands/arms';
import { heading } from './look/head';
import type { Person } from './person';

/** how far a tracked hand may be off a target past `reach` × its arm's length (m, default body) — as far as a reach is let end — and for
 * how much of the last few seconds: its time short, each second of it counting less by e⁻¹ every `window` s, up to what `seconds` short at
 * a stretch comes to (so a target out of reach for a fifth or more of each stroke of a gesture is said, as one out of reach for half a
 * second is) */
const OFF = { distance: 0.02, reach: REACH, seconds: 0.5, window: 3 };
const SHORT = OFF.window * (1 - Math.exp(-OFF.seconds / OFF.window));

/** `person` following `tracked` (`track`) */
export function* tracking(person: Person, request: Request, tracked: Tracked) {
  const branches = [];
  if (tracked.head) {
    const head = heading(person, finder(person, tracked.head));
    branches.push(during(request, 'go', 'asked', head.under), during(request, 'look', 'asked', head.look));
  }
  for (const side of ['left', 'right'] as const satisfies readonly Side[]) {
    const target = tracked[side];
    if (!target) continue;
    const find = finder(person, target), keep = reaching(person, side, find, { ...HOLD, bodyFollows: false });
    // (a hand `OFF.distance` off where its target was a sub-step before, the target past the arm held out straight from the shoulder, for
    // long enough of the last few seconds (`OFF`), is said once on the console: an aimer has no end to miss at; a hand lagging a target in
    // reach is not said)
    let short = 0;
    const shoulder = INDEX[`${side}UpperArm`];
    let last: Vector3 | null = null;
    branches.push(during(request, `hand.${side}`, 'asked', (f) => {
      if (last) {
        const gap = f.prev.position(person.hands[side]).distanceTo(last);
        const from = f.prev.position(shoulder).distanceTo(last), beyond = from > OFF.reach * person.proportions.armLength;
        short = short * Math.exp(-f.dt / OFF.window) + (beyond && gap > OFF.distance * person.scale ? f.dt : 0);
        if (short >= SHORT) person.warn(`tracked ${side}`, `a tracked ${side} hand falls short of a target out of reach: the shoulder ${from.toFixed(2)} m from it, the arm ${person.proportions.armLength.toFixed(2)} m (species.person.armLength)`);
      }
      keep(f);
      (last ??= new Vector3()).copy(find(f).position);
    }));
  }
  yield* parallel('all', ...branches);
}
