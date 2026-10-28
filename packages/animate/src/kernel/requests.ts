import { TimelineRunner, action, type ReusableTimeline, type TimelineClock, type UntilCondition } from '@pmndrs/timeline';
import type { Frame } from './frame';
import type { Go } from './go';

/** `asked` serves the verb directly; `borrowed` recruits supporting parts. Both override holding and idle behaviour. */
export type Tier = 'borrowed' | 'asked';

/** A body part a request takes: the legs (`go`, with the facing), the eyes (`look`), the trunk's posture (`trunk`), the head's turn over
 * the eyes (`head`), a hand by name. */
export type Channel = 'go' | 'look' | 'trunk' | 'head' | `hand.${string}`;

/** A claimed part poses the body; a leg claim returns its requested motion. */
export interface Claim {
  readonly request: Request;
  readonly channel: Channel;
  readonly tier: Tier;
  step(f: Frame): Go | void;
}

/** what a request's verb stages, sub-step by sub-step: a timeline over the body's frames that claims body parts as it goes */
export type Staging = (request: Request) => ReusableTimeline<Frame>;

/** the body a request is filed with, as a request sees it */
interface Filed {
  readonly time: number;
  claim(claim: Claim): void;
  unclaim(claim: Claim): void;
}

/** A story-owned request stages after balance and before part motion; cancellation releases its claims. Arbitration lives in `rank`. */
export class Request {
  private static made = 0;
  /** newer requests have larger numbers */
  readonly order = ++Request.made;
  outcome: 'running' | 'met' | 'failed' = 'running';
  /** seconds until what it moves arrives (∞: it moves nothing, or does not know) */
  eta = Infinity;
  /** the body's time when its story last stepped it (s) */
  renewed: number;
  /** whether development has said it went unrenewed */
  stale = false;
  /** whether the body filed it itself (a hand backing out of what it let go): no story waits on it */
  owned = false;
  private runner: TimelineRunner<Frame> | null = null;
  private readonly claims = new Set<Claim>();
  private readonly clock: TimelineClock = { delta: 0, prevDelta: 0, frame: 0 };

  /** `aimer`: it keeps on at its goal (a look, a tracked pose) rather than moving something somewhere: no arrival to foresee, it ends only
   * when its story says */
  constructor(readonly body: Filed, readonly verb: string, readonly site: string, private readonly staging: Staging, readonly aimer = false) {
    this.renewed = body.time;
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
    this.clock.delta = f.dt;
    (this.runner ??= new TimelineRunner(this.staging(this))).step(f, this.clock);
    this.clock.prevDelta = f.dt;
    this.clock.frame++;
    if (this.runner.finished && this.outcome === 'running') this.outcome = 'met';
  }

  /** `channel` taken at `tier` while the returned function has not been called: `step` runs every sub-step with the body part's others */
  claim(channel: Channel, tier: Tier, step: (f: Frame) => Go | void): () => void {
    const claim: Claim = { request: this, channel, tier, step };
    this.claims.add(claim);
    this.body.claim(claim);
    return () => {
      if (this.claims.delete(claim)) this.body.unclaim(claim);
    };
  }

  met(): void {
    if (this.outcome === 'running') this.outcome = 'met';
  }

  fail(): void {
    if (this.outcome === 'running') this.outcome = 'failed';
  }

  /** its staging stopped (its cleanups run: its claims let go) */
  end(): void {
    this.runner?.cancel();
    for (const claim of this.claims) this.body.unclaim(claim);
    this.claims.clear();
  }
}

/** `channel` claimed at `tier`, `step` run every sub-step, until `until`: an action of a request's staging */
export function during(request: Request, channel: Channel, tier: Tier, step: (f: Frame) => Go | void, until?: UntilCondition<Frame>) {
  return action<Frame>({ init: () => request.claim(channel, tier, step), until });
}

/** the order a body part's claims run in, the one that takes it last: borrowed before asked, older before newer — but the first
 * borrower of the legs keeps them */
export function rank(a: Claim, b: Claim): number {
  if (a.tier !== b.tier) return a.tier === 'borrowed' ? -1 : 1;
  const newer = a.request.order - b.request.order;
  return a.channel === 'go' && a.tier === 'borrowed' ? -newer : newer;
}
