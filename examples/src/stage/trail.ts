import { BufferGeometry, Line, LineBasicMaterial, Mesh, MeshBasicMaterial, SphereGeometry, Vector3, type Scene } from 'three';
import type { Playback } from '../playback';
import { FIXED_DT } from '../scenario';

const JOINTS = ['head', 'leftHand', 'rightHand', 'leftLowerLeg', 'rightLowerLeg', 'leftFoot', 'rightFoot', 'hips'] as const;

/**
 * Plays from `from` to `to`, drawing each person's key joints' paths: a line with a dot every
 * other step (zig-zags = jitter, dot spacing = speed, loops at the feet = extra steps).
 */
export function drawTrail(scene: Scene, playback: Playback, from: number, to: number) {
  const { sim } = playback;
  playback.advanceTo(Math.max(0, from));
  const nodes = sim.people.flatMap((person) => JOINTS.map((joint) => person.bones[joint]));
  const paths = nodes.map((): Vector3[] => []);
  while (sim.t + FIXED_DT * 0.5 < to) {
    playback.step();
    sim.stage.scene.updateMatrixWorld();
    nodes.forEach((node, i) => paths[i].push(node.getWorldPosition(new Vector3())));
  }
  const dotGeometry = new SphereGeometry(0.006, 6, 4);
  const dotMaterial = new MeshBasicMaterial({ color: 0xffffff });
  for (const points of paths) {
    scene.add(new Line(new BufferGeometry().setFromPoints(points), new LineBasicMaterial({ color: 0xbbbbbb })));
    points.forEach((point, n) => {
      if (n % 2) return;
      const dot = new Mesh(dotGeometry, dotMaterial);
      dot.position.copy(point);
      scene.add(dot);
    });
  }
}
