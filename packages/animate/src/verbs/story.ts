import { action, type NonReuseableTimeline, type Timeline, type TimelineYield } from '@pmndrs/timeline';
import { selfOf, type Body } from '../body/body';
import type { Problem } from '../kernel/dev';
import type { Staging } from '../kernel/requests';
import type { Self } from '../body/runtime';

// (to be proposed upstream to @pmndrs/timeline: its `parallel` asks its timelines for `void`, which a verb's outcome is not)
declare module '@pmndrs/timeline' {
  /**
   * `parallel` runs verbs as they are: their outcome is what a `yield*` of one returns, and `parallel` discards what its timelines
   * return (its own types ask for `void`)
   */
  export function parallel<T>(type: 'all' | 'race', ...timelines: Array<Timeline<T, unknown> | boolean>): NonReuseableTimeline<T>;
}

/** When something ends: after this many seconds of the story's time, once a condition holds, or never (`Infinity`). */
export type Until = number | (() => boolean);

/** A verb as a story runs it (`yield*`): it steps with the story, frame by frame, and ends `true` (met) or `false` (cannot be met). */
export type Verb = Generator<TimelineYield<unknown>, boolean, unknown>;

/**
 * A verb's request on `body`, filed when the story reaches it and kept until it ends (its `finally` runs on a race's cancel too): ends
 * `true` once its staging has met its goal and `false` once it can never meet it — or, given `until`, `true` once that holds, whatever
 * the goal. Each frame the story steps it renews the request. An aimer (it never meets a goal of its own) never ends without `until`. With
 * development on, the request is labelled by where the story asked for it (`file:line`, as the engine's stack shows it; a bundle's own
 * frames are not told apart from the library's).
 */
export function verb(body: Body, name: string, staging: Staging, until?: Until, aimer = false): Verb {
  const self = selfOf(body);
  return run(self, name, self.frame.dev ? siteOf(new Error().stack) : '', staging, until, aimer);
}

function* run(self: Self, name: string, site: string, staging: Staging, until: Until | undefined, aimer: boolean): Verb {
  const request = self.file(name, site, staging, aimer), ends = endsOf(until);
  let met = false;
  try {
    yield (_state, clock) => {
      request.renewed = self.time;
      met = ends ? ends(clock.delta) : request.outcome === 'met';
      if (!ends && request.outcome === 'failed') return 'finished';
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
 * A scene's own expectation of `body`, checked every frame the story steps it, never ending (run it beside the story in a `parallel`):
 * a problem it returns goes into the body's log, its check prefixed by `label`. With development off it is not checked at all.
 */
export function* watch(body: Body, label: string, check: () => Problem | null): Generator<TimelineYield<unknown>, never, unknown> {
  const dev = selfOf(body).frame.dev;
  yield* action({
    update: () => {
      const found = dev && check();
      if (!dev || !found) return;
      dev.append(selfOf(body).frame.time, { ...found, check: `${label}: ${found.check}` });
    },
  });
  throw new Error('watch: a watch never ends');
}

/** this library's files (its source, or the package it is built into), whose frames a call site skips */
const LIBRARY = new URL('..', import.meta.url).href;

/** where a story asked for a verb (`file:line`): of the frames of `stack` outside this library and the timeline runner, the last before a
 * generator's `next` (V8's and JavaScriptCore's frame for it): the story's, past any function wrapping the verb; else the first */
function siteOf(stack: string | undefined): string {
  let first = '', last = '';
  for (const line of (stack ?? '').split('\n').slice(1)) {
    if (last && /\bnext(?: \(<anonymous>\)|@\[native code\])$/.test(line.trim())) return last;
    const match = /((?:file|https?):\/\/\S+?|\/\S+?):(\d+):\d+\)?$/.exec(line.trim());
    if (!match) continue;
    const file = match[1].startsWith('/') ? `file://${match[1]}` : match[1];
    if (file.startsWith(LIBRARY) || file.includes('/@pmndrs/timeline/')) continue;
    last = `${file.slice(file.lastIndexOf('/') + 1)}:${match[2]}`;
    first ||= last;
  }
  return first;
}
