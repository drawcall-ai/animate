import { action, type TimelineYield } from '@pmndrs/timeline';
import type { Body } from '../body/body';
import { selfOf } from '../body/body';
import type { Problem } from '../core/dev';
import type { Staging } from '../body/requests';
import type { Self } from '../body/self';

/** When something ends: after this many seconds of the story's time, once a condition holds, or never (`Infinity`). */
export type Until = number | (() => boolean);

/** A verb as a story runs it (`yield*`): it steps with the story, frame by frame, and ends `true` (met) or `false` (cannot be met). */
export type Verb = Generator<TimelineYield<unknown>, boolean, unknown>;

/**
 * A verb's request on `body`, filed when the story reaches it and kept until it ends (its `finally` runs on a race's cancel too): ends
 * `true` once its staging has met its goal — or, given `until`, once that holds, whatever the goal — and `false` once it can never meet
 * it. Each frame the story steps it renews the request. An aimer (it never meets a goal of its own) asked without `until` in a sequence
 * never ends, and what follows it never runs: development says so.
 */
export function verb(body: Body, name: string, staging: Staging, until?: Until, aimer = false): Verb {
  return run(selfOf(body), name, siteOf(new Error().stack), staging, until, aimer);
}

function* run(self: Self, name: string, site: string, staging: Staging, until: Until | undefined, aimer: boolean): Verb {
  if (aimer && until === undefined && self.frame.dev && delegated(new Error().stack)) {
    self.frame.dev.append(self.frame.time, { check: `${name} without until in a sequence: it never ends, and what follows it never runs`, value: 1, limit: 0, where: site });
  }
  const request = self.file(name, site, staging, aimer);
  const ends = endsOf(until);
  let met = false;
  try {
    yield (_state, clock) => {
      request.renewed = self.time;
      if (request.outcome === 'failed') return 'finished';
      met = ends ? ends(clock.delta) : request.outcome === 'met';
      return met ? 'finished' : 'running';
    };
    return met;
  } finally {
    self.drop(request);
  }
}

/** a condition over the story's frames (their deltas, s) for `until`; none: the verb's own goal decides */
function endsOf(until: Until | undefined): ((delta: number) => boolean) | null {
  if (until === undefined) return null;
  if (typeof until === 'function') return until;
  if (!(until >= 0)) throw new Error(`until ${until}: give seconds, a condition or Infinity`);
  let elapsed = 0;
  return (delta) => {
    if (elapsed >= until - 1e-9) return true;
    elapsed += delta;
    return false;
  };
}

/** Waits until `until`: this many seconds of the story's time, or a condition. */
export function* wait(until: Until): Generator<TimelineYield<unknown>, true, unknown> {
  const ends = endsOf(until);
  if (!ends) throw new Error('wait: give seconds, a condition or Infinity');
  yield* action({ until: (_state, clock) => ends(clock.delta) });
  return true;
}

/**
 * A scene's own expectation, checked every frame the story steps it, never ending (run it beside the story in a `parallel`): a problem it
 * returns goes into the log of the body it names (with development on), its check prefixed by `label`.
 */
export function* watch(label: string, check: () => (Problem & { body: Body }) | null): Generator<TimelineYield<unknown>, never, unknown> {
  yield* action({
    update: () => {
      const found = check();
      if (!found) return;
      const { body, ...problem } = found, self = selfOf(body);
      self.frame.dev?.append(self.frame.time, { ...problem, check: `${label}: ${problem.check}` });
    },
  });
  throw new Error('watch: a watch never ends');
}

/** this library's files (its source, or the package it is built into), whose frames a call site skips */
const LIBRARY = new URL('..', import.meta.url).href;

/** where a story asked for a verb (`file:line`): the first frame of `stack` outside this library and the timeline runner */
function siteOf(stack: string | undefined): string {
  for (const line of (stack ?? '').split('\n').slice(1)) {
    const match = /((?:file|https?):\/\/\S+?|\/\S+?):(\d+):\d+\)?$/.exec(line.trim());
    if (!match) continue;
    const file = match[1].startsWith('/') ? `file://${match[1]}` : match[1];
    if (file.startsWith(LIBRARY) || file.includes('/@pmndrs/timeline/')) continue;
    return `${file.slice(file.lastIndexOf('/') + 1)}:${match[2]}`;
  }
  return '';
}

/** whether the generator whose first run took `stack` was delegated to by another (`yield*` in a sequence), not run by a runner of its own */
function delegated(stack: string | undefined): boolean {
  const lines = (stack ?? '').split('\n');
  // ([0] the message, [1] this generator, [2] its `.next`, [3] what resumed it: a delegating generator has its own `.next` below it)
  return /\.next \(<anonymous>\)/.test(lines[4] ?? '');
}
