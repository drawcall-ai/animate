import { expect } from 'vitest';
import { bone, type SkeletonBone } from '@drawcall/rig';
import { Group, type Object3D } from 'three';
import { Actor } from './actor';
import { Clearance } from './clearance';
import { Playback } from '../src/playback';
import { Simulation } from '../src/simulation';
import { SCENARIOS } from '../src/scenarios';
import { SOLDIER } from '../src/skeletons';
import { cases } from '../../packages/animate/test/open';

// Wardrobe skins these same named bones; meshes do not participate in the solver. Keep the rig's bone hierarchy and the live
// viewer's restore/blend path here, rather than testing only the default bare body or advancing a simulation without rendering.
function dress(skeleton: readonly SkeletonBone[]): Object3D {
  const model = new Group();
  const nodes = new Map(skeleton.map((entry) => [entry.name, bone(entry.name, entry.position)]));
  for (const entry of skeleton) {
    const parent = entry.parent === undefined ? model : nodes.get(entry.parent);
    const node = nodes.get(entry.name);
    if (!parent || !node) throw new Error(`missing rig bone: ${entry.name}`);
    parent.attach(node);
  }
  return model;
}

const it = cases([
  // (open: stepping 2% quicker on its shorter legs, the soldier stands 3 cm further from the helm stand at life seeds 0–2; reaching for the
  // helm, his bowed head comes over it, its crown 1.6 cm into his head — the body keeps no head clearance from what its hands take)
  ['knight-arming finishes cleanly in the SOLDIER viewer', [0, 1, 2]],
]);

for (const id of ['stable-morning', 'knight-arming']) {
  it(`${id} finishes cleanly in the SOLDIER viewer`, () => {
    const scenario = SCENARIOS.find((each) => each.id === id);
    if (!scenario) throw new Error(`missing scenario: ${id}`);
    const sim = new Simulation(scenario, { skeleton: SOLDIER, dress, dev: true });
    const playback = new Playback(sim), actor = new Actor(sim.people[0]), clearance = new Clearance();
    while (sim.t < scenario.duration) {
      playback.step();
      sim.stage.scene.updateMatrixWorld(true);
      clearance.see({ t: sim.t, h: actor, solids: sim.stage.solids?.() ?? [], asked: new Map() });
      playback.blend(0.5);
      sim.stage.scene.updateMatrixWorld(true);
    }
    expect(sim.stage.done(), `${id} finished by ${scenario.duration}s`).toBe(true);
    expect(clearance.depth, clearance.toString()).toBeLessThanOrEqual(0.015);
    expect(sim.stage.bodies.flatMap((body) => body.log)).toEqual([]);
  });
}
