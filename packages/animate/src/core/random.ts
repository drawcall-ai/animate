/** a seeded uniform [0, 1) (mulberry32): the same seed, the same numbers */
export function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** a seed from what something is (FNV-1a over its parts): the same parts, the same seed — a behaviour varies with what it acts on, the same every run */
export function seedOf(...parts: readonly (string | number)[]): number {
  let hash = 0x811c9dc5;
  for (const c of parts.join('|')) hash = Math.imul(hash ^ c.charCodeAt(0), 0x01000193);
  return hash >>> 0;
}

/** Smooth seeded drift shared by standing bodies; incommensurate frequencies avoid a repeating loop. */
export const irregular = (t: number, phase: number, a: number, b: number, c: number) => (Math.sin(a * t + phase) + 0.5 * Math.sin(b * t + 2 * phase) + 0.25 * Math.sin(c * t + 3 * phase)) / 1.75;
