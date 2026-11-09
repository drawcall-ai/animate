import { afterAll, expect, it } from 'vitest';

/** the offset this run varies people's idle motion by (`LIFE_SEED_OFFSET`, as `pnpm test:seeds` sets it; default 0) */
export const LIFE_SEED = Number(process.env.LIFE_SEED_OFFSET ?? 0);

/** a case still open: its title, failing at every life seed, or with the seeds it fails at (a seed's outcome is the same every run) */
export type Open = string | readonly [title: string, seeds: readonly number[]];

/**
 * `it` for a file's cases, but `it.fails` for one still open at this run's life seed: an open case that passes turns red, so a fix
 * comes off the list; and an open title no case has is an error, so the list cannot outlive its cases.
 */
export function cases(open: readonly Open[]) {
  const seeds = new Map(open.map((o): [string, readonly number[] | null] => typeof o === 'string' ? [o, null] : [o[0], o[1]]));
  const named = new Set<string>();
  afterAll(() => expect([...seeds.keys()].filter((title) => !named.has(title)), 'open cases no test has').toEqual([]));
  return (title: string, fn: () => void, timeout?: number) => {
    named.add(title);
    const at = seeds.get(title);
    const failing = at !== undefined && (at === null || at.includes(LIFE_SEED));
    (failing ? it.fails : it)(title, fn, timeout);
  };
}
