import { afterAll, expect, it } from 'vitest';

/** the offset this run varies people's idle motion by (`LIFE_SEED_OFFSET`, as `pnpm test:seeds` sets it; default 0) */
export const LIFE_SEED = Number(process.env.LIFE_SEED_OFFSET ?? 0);

/** a case still open: its title, what its failure says, and the life seeds it fails at (none: every seed; a seed's outcome is the same every run) */
export type Open = readonly [title: string, fails: RegExp, seeds?: readonly number[]];

/** what a failure says: its message and, for an `expect` whose message cuts it short, the value it was given */
const said = (cause: unknown) => cause instanceof Error ? `${cause.message} ${JSON.stringify((cause as { actual?: unknown }).actual)}` : String(cause);

/**
 * `it` for a file's cases, but a case still open at this run's life seed must fail, and as its entry says: one that passes turns red, so a
 * fix comes off the list; one failing otherwise turns red too, so an entry cannot come to stand for another fault; and an open title no case
 * has is an error, so the list cannot outlive its cases.
 */
export function cases(open: readonly Open[]) {
  const listed = new Map(open.map(([title, fails, seeds]) => [title, { fails, seeds }]));
  const named = new Set<string>();
  afterAll(() => expect([...listed.keys()].filter((title) => !named.has(title)), 'open cases no test has').toEqual([]));
  return (title: string, fn: () => void, timeout?: number) => {
    named.add(title);
    const entry = listed.get(title);
    if (!entry || (entry.seeds && !entry.seeds.includes(LIFE_SEED))) return void it(title, fn, timeout);
    it(title, () => {
      try {
        fn();
      } catch (cause) {
        if (entry.fails.test(said(cause))) return;
        throw cause;
      }
      throw new Error('this open case passes: take it off its list');
    }, timeout);
  };
}
