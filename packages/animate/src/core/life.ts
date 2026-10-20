import { seeded } from './random';
import { lerp } from './math';

/**
 * One kind of change in a body's quiet life: every `every` s (seeded; the first after `first`) it turns to a new
 * aim (`pick`, from the last one), held `hold` s if given and then let go to 0 until the next; followed at `rate`
 * (1/s), or at once without one. With `quiet`, it changes only while the body is quiet: any activity puts the
 * next change `quiet` s off and lets the aim go.
 */
export interface Rhythm {
  every: readonly [number, number];
  first?: readonly [number, number];
  hold?: readonly [number, number];
  rate?: number;
  quiet?: number;
  pick(last: number, rand: () => number): number;
}

/** A body's quiet life, seeded: its rhythms' values over time, a phase for its own drift, and the seeded draws behind both. */
export class Life<Name extends string = string> {
  /** the seeded draws, in order: the phase, each rhythm's first change, then every change as it comes */
  readonly rand: () => number;
  /** a seeded phase (rad) for the body's own smooth drift */
  readonly phase: number;
  private readonly channels = new Map<Name, { rhythm: Rhythm; next: number; until: number; aim: number; value: number; fired: boolean }>();

  /** `rhythms` by name, in the order they draw */
  constructor(seed: number, rhythms: readonly (readonly [Name, Rhythm])[]) {
    this.rand = seeded(seed);
    this.phase = this.rand() * 2 * Math.PI;
    for (const [name, rhythm] of rhythms) {
      const [lo, hi] = rhythm.first ?? rhythm.every;
      this.channels.set(name, { rhythm, next: lerp(lo, hi, this.rand()), until: 0, aim: 0, value: 0, fired: false });
    }
  }

  /** at `time` (s), `dt` on; `quiet`: the body at rest, nothing asked of it */
  update(time: number, dt: number, quiet = true): void {
    for (const c of this.channels.values()) {
      const { rhythm: r } = c;
      c.fired = false;
      if (r.quiet !== undefined && !quiet) [c.next, c.until] = [time + r.quiet, 0];
      if ((r.quiet === undefined || quiet) && time >= c.next) {
        c.aim = r.pick(c.aim, this.rand);
        c.fired = true;
        if (r.hold) {
          c.until = time + lerp(r.hold[0], r.hold[1], this.rand());
          c.next = c.until + lerp(r.every[0], r.every[1], this.rand());
        } else c.next = time + r.every[0] + (r.every[1] - r.every[0]) * this.rand();
      }
      const aim = r.hold && time >= c.until ? 0 : c.aim;
      c.value = r.rate === undefined ? aim : c.value + (aim - c.value) * (1 - Math.exp(-r.rate * dt));
    }
  }

  /** rhythm `name`'s value now */
  value(name: Name): number {
    return this.channel(name).value;
  }

  /** rhythm `name`'s aim: where its value goes */
  aim(name: Name): number {
    return this.channel(name).aim;
  }

  /** whether rhythm `name` turned to a new aim in the last update */
  fired(name: Name): boolean {
    return this.channel(name).fired;
  }

  private channel(name: Name) {
    const c = this.channels.get(name);
    if (!c) throw new Error(`no rhythm "${name}"`);
    return c;
  }
}

/** a swing to the other side of rest, by 0.25–1 of the way (seeded) */
export const swing = (last: number, rand: () => number) => (last > 0 ? -1 : 1) * (0.25 + 0.75 * rand());
