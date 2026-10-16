import { vi } from 'vitest';

// Offset every geometry-derived life seed, keeping the actual sway/breath/shift implementation.
vi.mock('../src/humanoid/balance/life', async (original) => {
  const offset = Number(process.env.LIFE_SEED_OFFSET ?? 0);
  if (!Number.isInteger(offset)) throw new Error('LIFE_SEED_OFFSET must be an integer');
  const { Life } = await original<typeof import('../src/humanoid/balance/life')>();
  return { Life: class extends Life {
    constructor(seed: number) { super(seed + offset); }
  } };
});
