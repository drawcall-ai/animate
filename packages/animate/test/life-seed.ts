import { vi } from 'vitest';
import { seedOf } from '../src/core/random';

// Vary geometry-derived idle motion; an explicit seed remains reproducible. (The stride is imported here once mocked: had its
// module moved, the mock would hold for nothing and every run would quietly be seed 0's.)
vi.mock('../src/humanoid/stride', async (original) => {
  const offset = Number(process.env.LIFE_SEED_OFFSET ?? 0);
  if (!Number.isInteger(offset)) throw new Error('LIFE_SEED_OFFSET must be an integer');
  const actual = await original<typeof import('../src/humanoid/stride')>();
  const { stride } = actual;
  return { ...actual, stride: ((h, options = {}) => stride(h, { ...options,
    seed: options.seed ?? seedOf(h.proportions.height, h.feet[0].position.x, h.feet[0].position.z) + offset,
  })) satisfies typeof stride };
});
const { stride } = await import('../src/humanoid/stride');
if (typeof stride !== 'function') throw new Error('life-seed: the stride it varies is not where it mocks it');
