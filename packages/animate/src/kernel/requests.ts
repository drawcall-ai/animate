import { TimelineRunner, action, type ReusableTimeline, type TimelineClock, type UntilCondition } from '@pmndrs/timeline';
import type { Frame } from './frame';
import type { LegGoal } from '../step/leg-goal';

/** `asked` serves the verb directly; `borrowed` recruits supporting parts. Both override holding and idle behaviour. */
export type Tier = 'borrowed' | 'asked';

/** A body part a request takes: the legs (`legs`, with the facing), the eyes (`look`), the trunk's posture (`trunk`), the head's turn over
 * the eyes (`head`), a hand by name, the pose of a free hand's arm (`arm.` its hand) and its fingers' shape (`fingers.` its hand). */
export type Channel = 'legs' | 'look' | 'trunk' | 'head' | `hand.${string}` | `arm.${string}` | `fingers.${string}`;

/** A claimed part poses the body; a leg claim returns its requested motion. */
export interface Claim {
  readonly request: Request;
  readonly channel: Channel;
  readonly tier: Tier;
  step(f: Frame): LegGoal | void;
}

/** what a request's verb stages, sub-step by sub-step: a timeline over the body's frames that claims body parts as it goes */
export type Staging = (request: Request) => ReusableTimeline<Frame>;

/** the body a request is filed with, as a request sees it */
interface Filed {
  readonly time: number;
  readonly claims: Claims;
}

/** The claims on a body's parts, each channel's in `rank`'s order: its last has it. */
export class Claims {
  private readonly on = new Map<Channel, Claim[]>();

  add(claim: Claim): void {
    const claims = this.on.get(claim.channel) ?? [];
    claims.push(claim);
    claims.sort(rank);
    this.on.set(claim.channel, claims);
  }

  remove(claim: Claim): void {
    const claims = this.on.get(claim.channel);
    if (!claims) return;
    const k = claims.indexOf(claim);
    if (k >= 0) claims.splice(k, 1);
  }

  /** the claim that has `channel`, if any */
  owner(channel: Channel): Claim | undefined {
    const claims = this.on.get(channel);
    return claims?.[claims.length - 1];
  }

  /** Losing leg claims still tick for progress tracking; only the owner's result drives the body. */
  run(channel: Channel, f: Frame): LegGoal | void {
    const claims = this.on.get(channel);
    if (!claims?.length) return;
    const owner = claims[claims.length - 1];
    if (channel === 'legs') for (const claim of claims.slice(0, -1)) claim.step(f);
    return owner.step(f);
  }
}

/** What a verb fell short of: where, how far off against what limit (in the check's units), and a reader's account of why, naming the fix where one is known. */
export interface Miss {
  where: string;
  off: number;
  limit: number;
  why: string;
}

/** What a request is: a `mover` takes something somewhere, and a story can wait on its arrival; an `aimer` keeps on at its goal (a look, a tracked
 * pose), with no arrival to foresee, ending only when its story says; the body's `own` (a hand backing out of what it let go): no story renews or waits on it. */
export type RequestKind = 'mover' | 'aimer' | 'own';

/** A story-owned request stages after balance and before part motion; cancellation releases its claims. Arbitration lives in `rank`. */
export class Request {
  private static made = 0;
  /** newer requests have larger numbers */
  readonly order = ++Request.made;
  outcome: 'running' | 'met' | 'failed' = 'running';
  /** what it failed of, once it has */
  miss: Miss | null = null;
  /** what its staging threw (a misuse), for its story's step to throw: its staging has stopped */
  error: Error | null = null;
  /** its goal's measure now, as a story's `until` ends it: whether what it moves is there, within the verb's tolerance */
  there: (() => boolean) | null = null;
  /** seconds until what it moves arrives (∞: it moves nothing, or does not know) */
  eta = Infinity;
  /** the body's time when it was filed (s) */
  readonly filed: number;
  /** the body's time when its story last stepped it (s) */
  renewed: number;
  /** whether development has said it went unrenewed */
  stale = false;
  private runner: TimelineRunner<Frame> | null = null;
  private readonly claims = new Set<Claim>();
  private readonly clock: TimelineClock = { delta: 0, prevDelta: 0, frame: 0 };

  constructor(readonly body: Filed, readonly verb: string, private called: string | (() => string), private readonly staging: Staging, readonly kind: RequestKind = 'mover') {
    this.filed = this.renewed = body.time;
  }

  /** where its story asked for it (`file:line`), read off the call's stack the first time it is asked for */
  get site(): string {
    if (typeof this.called === 'function') this.called = this.called();
    return this.called;
  }

  get finished(): boolean {
    return this.runner?.finished ?? false;
  }

  /** how development and `owners` name it */
  get label(): string {
    return this.site ? `${this.verb} (${this.site})` : this.verb;
  }

  /** its staging, a sub-step on (made on its first) */
  stage(f: Frame): void {
    if (this.error) return;
    this.clock.delta = f.dt;
    try {
      (this.runner ??= new TimelineRunner(this.staging(this))).step(f, this.clock);
    } catch (cause) {
      // (a request of the body's own has no story to say it)
      if (this.kind === 'own') throw cause;
      // (its own name said once: a check at the call says it too)
      const said = cause instanceof Error ? cause.message : String(cause);
      this.error = new Error(`${this.label}: ${said.startsWith(`${this.verb}: `) ? said.slice(this.verb.length + 2) : said}`, { cause });
      this.outcome = 'failed';
      this.end();
      return;
    }
    this.clock.prevDelta = f.dt;
    this.clock.frame++;
    if (this.runner.finished && this.outcome === 'running') this.outcome = 'met';
  }

  /** `channel` taken at `tier` while the returned function has not been called: `step` runs every sub-step with the body part's others */
  claim(channel: Channel, tier: Tier, step: (f: Frame) => LegGoal | void): () => void {
    const claim: Claim = { request: this, channel, tier, step };
    this.claims.add(claim);
    this.body.claims.add(claim);
    return () => {
      if (this.claims.delete(claim)) this.body.claims.remove(claim);
    };
  }

  met(): void {
    if (this.outcome === 'running') this.outcome = 'met';
  }

  /** it cannot meet its goal: what it says first stands, and a check closing the sub-step it was met in overrules that */
  fail(miss: Miss): void {
    this.outcome = 'failed';
    this.miss ??= miss;
  }

  /** its staging stopped (its cleanups run: its claims let go) */
  end(): void {
    this.runner?.cancel();
    for (const claim of this.claims) this.body.claims.remove(claim);
    this.claims.clear();
  }
}

/** `channel` claimed at `tier`, `step` run every sub-step, until `until`: an action of a request's staging */
export function during(request: Request, channel: Channel, tier: Tier, step: (f: Frame) => LegGoal | void, until?: UntilCondition<Frame>) {
  return action<Frame>({ init: () => request.claim(channel, tier, step), until });
}

/** the order a body part's claims run in, the one that takes it last: borrowed before asked, older before newer — but the first
 * borrower of the legs keeps them */
export function rank(a: Claim, b: Claim): number {
  if (a.tier !== b.tier) return a.tier === 'borrowed' ? -1 : 1;
  const newer = a.request.order - b.request.order;
  return a.channel === 'legs' && a.tier === 'borrowed' ? -newer : newer;
}
