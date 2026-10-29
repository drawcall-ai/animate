import { type Object3D, Vector3 } from 'three';
import { expect, it } from 'vitest';
import { beat } from '../src/beats/ceremony';
import { runBeat } from './run';

// The medals never jump: frame to frame each moves less than 10 cm (a hand swinging one moves it up to ~6 cm a frame; a jump between
// holders, whose grips are 20-30 cm apart, or into place would move it further), from the stand to the hero's chest; and each ends worn
// there, below the wearer's neck and in front of it.
it('hangs each medal on its hero without a jump', async () => {
  const last = new Map<Object3D, Vector3>();
  let largestStep = 0;
  const medals: Object3D[] = [];
  const playing = await runBeat(beat, ({ scene }) => {
    if (!medals.length) scene.traverse((node) => node.name.endsWith('medal') && node.userData.mass && medals.push(node));
    for (const medal of medals) {
      const now = medal.getWorldPosition(new Vector3());
      const before = last.get(medal);
      if (before) largestStep = Math.max(largestStep, now.distanceTo(before));
      last.set(medal, now);
    }
  });
  const [luke, han] = playing.bodies;
  expect(playing.finished()).toBe(true);
  expect(playing.done()).toBe(true);
  expect(largestStep, 'largest step of a medal in one frame (m)').toBeLessThan(0.1);
  for (const [index, hero] of [luke, han].entries()) {
    const medal = medals[index].getWorldPosition(new Vector3());
    const neck = (hero.bones as Record<string, Object3D>).neck.getWorldPosition(new Vector3());
    const ahead = medal.clone().sub(neck).applyAxisAngle(new Vector3(0, 1, 0), -hero.facing);
    expect(ahead.y, 'medallion below the neck').toBeLessThan(-0.1);
    expect(ahead.z, 'medallion in front of the neck').toBeGreaterThan(0.08);
  }
  expect(playing.bodies.flatMap((body) => body.log)).toEqual([]);
}, 120_000);
