import { expect, it, vi } from 'vitest';
import { horse } from '../../src/index';
import { BonePose } from '../../src/kernel/bone-pose';
import { HORSE } from '../../skills/animate/references/horse';
import { FLAT } from '../../src/step/floor';

it('samples shared leg reach tables independently of query order and earlier bodies', async () => {
  const species = horse(HORSE), rest = new BonePose(species.skeleton), chains = species.legs?.chains;
  if (!chains) throw new Error('horse needs legs');
  const queries = [-0.2, -0.1, 0, 0.1, 0.2].flatMap((out) =>
    [-0.5, -0.2, 0, 0.2, 0.5].flatMap((ahead) => [0, -0.2, -0.4].map((pitch) => [out, ahead, pitch] as const)));
  const sample = async (reverse: boolean) => {
    vi.resetModules();
    const { ChainLeg } = await import('../../src/creature/feet');
    const legs = chains.map((chain) => new ChainLeg(chain, rest, FLAT));
    for (const query of reverse ? queries.slice().reverse() : queries) for (const leg of legs) leg.depth(...query);
    const read = () => chains.map((chain) => {
      const leg = new ChainLeg(chain, rest, FLAT);
      return queries.map((query) => leg.depth(...query));
    });
    const first = read();
    expect(read()).toEqual(first);
    return first;
  };
  expect(await sample(true)).toEqual(await sample(false));
});
