import { action, type TimelineYield } from '@pmndrs/timeline';
import { selfOf, type Body } from '../body/body';
import type { Miss, Staging } from '../kernel/requests';
import type { Self } from '../body/runtime';

/** When something ends: after this many seconds of the story's time, once a condition holds, or never (`Infinity`). */
export type Until = number | (() => boolean);

/**
 * A verb as a story runs it (`yield*`): it steps with the story, frame by frame. It returns `true` when what it moves was measured there
 * within its tolerance as it ended (an aimer: when it ended), `false` only when the story's own `until` cut it short (no failure and no
 * claim), and throws `Missed` when it cannot get there.
 */
export type Verb = Generator<TimelineYield<unknown>, boolean, unknown>;

/**
 * A verb could not do what it was asked. It reaches the app's `update` once unless the story catches it (`attempt`, or `try` around the
 * `yield*`), with the verb's requests dropped; what its hands hold they go on holding.
 */
export class Missed extends Error {
  override readonly name = 'Missed';
  /** where it fell short: a thing and hand, a target */
  readonly where: string;
  /** how far off (`limit`'s units: m unless `why` says otherwise) */
  readonly off: number;
  readonly limit: number;
  /** what held it off, and the fix where one is known */
  readonly why: string;

  constructor(readonly verb: string, readonly site: string, { where, off, limit, why }: Miss) {
    super(`${verb}${site ? ` (${site})` : ''} missed: ${[where.trim(), why].filter(Boolean).join(': ')}`);
    this.where = where.trim();
    this.off = off;
    this.limit = limit;
    this.why = why;
  }
}

/**
 * Runs `verb` (or a `parallel` of them) and returns the `Missed` it threw, or `null` if it ended without one; anything else it throws goes
 * on up. For where a miss is an ordinary outcome of the story: `const miss = yield* attempt(grab(…)); if (miss) …`.
 */
export function* attempt(verb: Generator<TimelineYield<unknown>, unknown, unknown>): Generator<TimelineYield<unknown>, Missed | null, unknown> {
  try {
    yield* verb;
    return null;
  } catch (error) {
    if (error instanceof Missed) return error;
    throw error;
  }
}

/** a verb called, as a body remembers it until its story first steps it: which, when, and where (read off the stack only if asked for) */
export class Call {
  private readonly stack = new Error();
  private read?: string;

  constructor(readonly verb: string, readonly time: number) {}

  get site(): string {
    return (this.read ??= siteOf(this.stack.stack));
  }
}

/**
 * A verb's request on `body`, filed when the story reaches it and kept until it ends (its `finally` runs on a race's cancel too). It ends
 * `true` once its staging has met its goal and throws `Missed` once that staging fails; given `until`, it ends on that, `true` if its
 * goal's measure (`Request.there`) holds at that instant and `false` if not, a failure meanwhile only followed on — but one it `gives up`
 * on (a walk's stall, a carry's) still throws. Each frame the story steps it renews the request. An aimer ends only on `until`, `true`,
 * or if `ending` (a `hold`), on its goal.
 */
export function verb(body: Body, name: string, staging: Staging, until?: Until, aimer = false, givesUp = false, ending = false): Verb {
  const self = selfOf(body), call = new Call(name, self.time);
  self.unyielded.add(call);
  return run(self, call, staging, until, aimer, givesUp, ending);
}

function* run(self: Self, call: Call, staging: Staging, until: Until | undefined, aimer: boolean, givesUp: boolean, ending: boolean): Verb {
  self.unyielded.delete(call);
  const request = self.file(call.verb, () => call.site, staging, aimer), ends = endsOf(until);
  request.endless = aimer && until === undefined && !ending;
  const missed = () => request.miss && (!ends || givesUp) ? request.miss : null;
  try {
    yield (_state, clock) => {
      request.renewed = self.time;
      if (missed()) return 'finished';
      return (ends ? ends(clock.delta) : request.outcome === 'met') ? 'finished' : 'running';
    };
    const miss = missed();
    if (miss) throw new Missed(call.verb, request.site, miss);
    return !ends || aimer || (request.there?.() ?? false);
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

/** this library's files (its source, or the package it is built into), whose frames a call site skips */
const LIBRARY = new URL('..', import.meta.url).href;

/** where a story asked for a verb (`file:line`): of the frames of `stack` outside this library and the timeline runner, the last before a
 * generator's `next` (V8's and JavaScriptCore's frame for it): the story's, past any function wrapping the verb; else the first */
export function siteOf(stack: string | undefined): string {
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
