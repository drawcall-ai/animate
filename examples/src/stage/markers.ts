import { Mesh, MeshBasicMaterial, OctahedronGeometry, type Group } from 'three';
import type { Input } from '../simulation';

const EFFECTORS = ['head', 'chest', 'hips', 'leftHand', 'rightHand', 'leftFoot', 'rightFoot'] as const;
const material = new MeshBasicMaterial({ color: 0xffffff, wireframe: true });
const geometry = new OctahedronGeometry(0.035);

/** Redraws `group` with a marker at each weighted effector target: the only data the behaviours are given. */
export function drawMarkers(group: Group, inputs: readonly Input[]) {
  group.clear();
  for (const input of inputs) {
    for (const k of EFFECTORS) {
      const e = input[k];
      if (!e || e.weight <= 0.02) continue;
      const m = new Mesh(geometry, material);
      m.position.copy(e.position);
      m.scale.setScalar(0.6 + 0.4 * e.weight);
      group.add(m);
    }
  }
}
