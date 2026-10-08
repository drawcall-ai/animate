import { Mesh, MeshBasicMaterial, OctahedronGeometry, type Group } from 'three';
import { EFFECTORS, type ScenarioInput } from '../scenario';

const material = new MeshBasicMaterial({ color: 0xffffff, wireframe: true });
const geometry = new OctahedronGeometry(0.035);

/** Redraws `group` with a marker at each weighted input target: the only data the solver is given. */
export function drawMarkers(group: Group, inputs: ScenarioInput[]) {
  group.clear();
  for (const input of inputs) {
    for (const k of EFFECTORS) {
      const e = input[k];
      if (!e || (e.weight ?? 1) <= 0.02) continue;
      const m = new Mesh(geometry, material);
      m.position.copy(e.position);
      m.scale.setScalar(0.6 + 0.4 * (e.weight ?? 1));
      group.add(m);
    }
  }
}
