import { vi } from 'vitest';
import { seedOf } from '../src/core/random';

// Vary geometry-derived idle motion; an explicit balance seed remains reproducible.
vi.mock('../src/humanoid/balance/balance', async (original) => {
  const offset = Number(process.env.LIFE_SEED_OFFSET ?? 0);
  if (!Number.isInteger(offset)) throw new Error('LIFE_SEED_OFFSET must be an integer');
  const actual = await original<typeof import('../src/humanoid/balance/balance')>();
  const { balance } = actual;
  return { ...actual, balance: ((h, options = {}) => balance(h, { ...options,
    seed: options.seed ?? seedOf(h.proportions.height, h.feet[0].position.x, h.feet[0].position.z) + offset,
  })) satisfies typeof balance };
});
