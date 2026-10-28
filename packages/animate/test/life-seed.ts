import { vi } from 'vitest';
import { seedOf } from '../src/kernel/random';
import { standingFeet } from '../src/species/humanoid/stance';

// Vary geometry-derived idle motion; an explicit seed remains reproducible. (The stride is imported here once mocked: had its
// module moved, the mock would hold for nothing and every run would quietly be seed 0's.)
vi.mock('../src/legs/person/stride', async (original) => {
  const offset = Number(process.env.LIFE_SEED_OFFSET ?? 0);
  if (!Number.isInteger(offset)) throw new Error('LIFE_SEED_OFFSET must be an integer');
  const actual = await original<typeof import('../src/legs/person/stride')>();
  const { stride } = actual;
  return { ...actual, stride: ((h, options = {}) => stride(h, { ...options,
    seed: options.seed ?? seedOf(h.proportions.height, ...leftAnkle(h)) + offset,
  })) satisfies typeof stride };
});
const { stride } = await import('../src/legs/person/stride');
if (typeof stride !== 'function') throw new Error('life-seed: the stride it varies is not where it mocks it');

/** where a person's left ankle stood as it was made (its stance under its root) */
function leftAnkle(h: { proportions: Parameters<typeof standingFeet>[0]; pose: { position(bone: number): { x: number; z: number } }; yaw: number }): [number, number] {
  const root = h.pose.position(0), { position } = standingFeet(h.proportions, root.x, root.z, h.yaw)[0];
  return [position.x, position.z];
}
