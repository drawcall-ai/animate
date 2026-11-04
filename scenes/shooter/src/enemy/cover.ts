import type { PhysicsWorld } from '@drawcall/physics';
import { Vector3 } from 'three';
import type { Navigation } from '../nav';

export interface Cover { hide: Vector3; peek: Vector3 }

export function visible(world: PhysicsWorld, from: Vector3, to: Vector3) {
  const direction = to.clone().sub(from), distance = direction.length();
  if (distance < 0.01) return true;
  const hit = world.raycast(from, direction.divideScalar(distance), distance);
  return !hit || hit.point.distanceTo(from) > distance - 0.05;
}

/** Score reachable, actually occluded positions with a nearby clear firing position. */
export function coverAt(nav: Navigation, world: PhysicsWorld, from: Vector3, threat: Vector3, previous?: Cover): Cover | undefined {
  let best: Cover | undefined, score = Infinity;
  for (const box of nav.covers) for (const normal of NORMALS) {
    const centre = box.getCenter(new Vector3()).setY(box.min.y);
    const size = box.getSize(new Vector3());
    const depth = Math.abs(normal.x) * size.x / 2 + Math.abs(normal.z) * size.z / 2;
    const width = Math.abs(normal.z) * size.x / 2 + Math.abs(normal.x) * size.z / 2;
    const requested = centre.clone().addScaledVector(normal, depth + 0.5);
    if (visible(world, threat, requested.clone().add(new Vector3(0, 1.35, 0)))) continue;
    const route = nav.path(from, requested);
    if (!route?.complete) continue;
    const hide = route.points.at(-1)?.position;
    if (!hide || visible(world, threat, hide.clone().add(new Vector3(0, 1.35, 0)))) continue;
    const travel = route.points.reduce((sum, point, index, points) => sum + (index ? point.position.distanceTo(points[index - 1].position) : 0), 0);
    for (const side of [-1, 1]) {
      const requested = hide.clone().addScaledVector(new Vector3(normal.z, 0, -normal.x), side * (width + 0.7));
      const approach = nav.path(hide, requested), peek = approach?.points.at(-1)?.position;
      if (!approach?.complete || !peek || !visible(world, peek.clone().add(new Vector3(0, 1.6, 0)), threat)) continue;
      const cost = travel + Math.abs(peek.distanceTo(threat) - 16) * 0.25 + (previous && previous.hide.distanceTo(hide) < 1 ? 12 : 0);
      if (cost < score) { best = { hide, peek }; score = cost; }
    }
  }
  return best;
}

const NORMALS = [new Vector3(1, 0, 0), new Vector3(-1, 0, 0), new Vector3(0, 0, 1), new Vector3(0, 0, -1)];
