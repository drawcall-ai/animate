import { Group, Mesh, MeshStandardMaterial, type Object3D, BoxGeometry, MathUtils } from 'three';
import { action, type NonReuseableTimeline } from '@pmndrs/timeline';

// The great doors as the film opens them. The hall (hall.ts) builds its two leaves standing open, each on an unnamed hinge group turned
// 95 degrees into the hall; the film finds those hinges, closes them at the start and swings them open on its timeline. Beyond the
// doorway the hall has no floor, so the film lays a threshold of sand-coloured stone outside for the heroes to wait on.

/** how far the hall's leaves stand open (rad): its hinges are the groups turned so */
const OPEN = (95 * Math.PI) / 180;

export interface Doors {
  /** a story step: the leaves swing from closed to open over `seconds`, slow to start and slow to stop, as heavy doors do */
  open(seconds: number): NonReuseableTimeline<unknown>;
  /** puts the leaves back as the hall built them (open) */
  restore(): void;
}

/** the hall's door hinges, closed; headless (no hall) an empty pair */
export function closeDoors(hall: Object3D | undefined): Doors {
  const hinges = (hall?.children ?? []).filter((node): node is Group => node instanceof Group && Math.abs(Math.abs(node.rotation.y) - OPEN) < 1e-6);
  if (hall && hinges.length !== 2) throw new Error(`the hall should have two door hinges turned ${OPEN} rad, found ${hinges.length}`);
  const sides = hinges.map((hinge) => Math.sign(hinge.rotation.y));
  const swing = (share: number) => hinges.forEach((hinge, i) => (hinge.rotation.y = sides[i] * OPEN * share));
  swing(0);
  return {
    *open(seconds) {
      yield* action({
        update: (_, __, time) => {
          const u = MathUtils.clamp(time / seconds, 0, 1);
          swing(u * u * (3 - 2 * u));
          return u < 1;
        },
      });
    },
    restore: () => swing(1),
  };
}

/** a slab of stone outside the doorway, level with the hall floor, for the heroes to stand on before the doors open */
export function threshold(): Mesh {
  const slab = new Mesh(new BoxGeometry(14, 0.1, 8), new MeshStandardMaterial({ color: 0xc9b99c, roughness: 0.95 }));
  slab.name = 'threshold';
  slab.position.set(0, -0.05, -4);
  slab.receiveShadow = true;
  return slab;
}
