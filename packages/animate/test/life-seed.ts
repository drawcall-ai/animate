import { vi } from 'vitest';
import { seedOf } from '../src/core/random';

// Vary geometry-derived idle motion; an explicit seed remains reproducible.
vi.mock('../src/humanoid/stride', async (original) => {
  const offset = Number(process.env.LIFE_SEED_OFFSET ?? 0);
  if (!Number.isInteger(offset)) throw new Error('LIFE_SEED_OFFSET must be an integer');
  const actual = await original<typeof import('../src/humanoid/stride')>();
  const { stride } = actual;
  return { ...actual, stride: ((h, options = {}) => stride(h, { ...options,
    seed: options.seed ?? seedOf(h.proportions.height, h.feet[0].position.x, h.feet[0].position.z) + offset,
  })) satisfies typeof stride };
});
