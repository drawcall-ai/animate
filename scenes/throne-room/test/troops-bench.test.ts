import { it } from 'vitest';
import { Vector3 } from 'three';
import { runTimeline, parallel } from '@pmndrs/timeline';
import { Body, humanoid, lookAt, track } from '@drawcall/animate';
import { SOLDIER } from '../src/skeletons/soldier';

it('bench', () => {
  const species = humanoid(SOLDIER);
  for (const mode of ['idle', 'look', 'clap'] as const) {
    const bodies = Array.from({ length: 50 }, (_, i) => new Body(species, { at: new Vector3(i, 0, 0), dev: false, life: { seed: i } }));
    const updates = bodies.map((b) => runTimeline(function* () {
      if (mode === 'look') yield* lookAt(b, (t) => new Vector3(b.position.x + Math.sin(t), 1.6, 5));
      if (mode === 'clap') yield* parallel('all', lookAt(b, new Vector3(b.position.x, 1.6, 5)), track(b, {
        left: (t) => new Vector3(b.position.x + 0.03 + 0.1 * Math.max(0, Math.sin(t * 15)), 1.25, 0.35),
        right: (t) => new Vector3(b.position.x - 0.03 - 0.1 * Math.max(0, Math.sin(t * 15)), 1.25, 0.35),
      }));
      yield* lookAt(b, new Vector3(0, 1, 1));
    }));
    const frame = () => { updates.forEach((u) => u(undefined, 1 / 60)); bodies.forEach((b) => b.update(1 / 60)); };
    for (let f = 0; f < 60; f++) frame();
    const t = performance.now();
    for (let f = 0; f < 120; f++) frame();
    console.log(`${mode}: ${((performance.now() - t) / 120 / 50).toFixed(3)} ms per body per frame`);
  }
});
