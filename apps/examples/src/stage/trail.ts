import { BufferGeometry, Line, LineBasicMaterial, Mesh, MeshBasicMaterial, SphereGeometry, type Scene, type Vector3 } from 'three';
import { jointOf } from '../joints';
import type { Playback } from '../playback';
import { FIXED_DT } from '../scenario';

const JOINTS = ['head', 'leftHand', 'rightHand', 'leftLowerLeg', 'rightLowerLeg', 'leftFoot', 'rightFoot', 'hips'] as const;

/**
 * Plays from `from` to `to`, drawing each key joint's path: a line with a dot every
 * other step (zig-zags = jitter, dot spacing = speed, loops at the feet = extra steps).
 */
export function drawTrail(scene: Scene, playback: Playback, from: number, to: number) {
  const { sim } = playback;
  playback.advanceTo(Math.max(0, from));
  const paths = sim.actors.map(() => JOINTS.map((): Vector3[] => []));
  while (sim.t + FIXED_DT * 0.5 < to) {
    playback.step();
    sim.actors.forEach((a, i) => JOINTS.forEach((j, k) => paths[i][k].push(jointOf(a, j))));
  }
  const dotGeo = new SphereGeometry(0.006, 6, 4);
  const dotMat = new MeshBasicMaterial({ color: 0xffffff });
  for (const pts of paths.flat()) {
    scene.add(new Line(new BufferGeometry().setFromPoints(pts), new LineBasicMaterial({ color: 0xbbbbbb })));
    pts.forEach((pt, n) => {
      if (n % 2) return;
      const d = new Mesh(dotGeo, dotMat);
      d.position.copy(pt);
      scene.add(d);
    });
  }
}
