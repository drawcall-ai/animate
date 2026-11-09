import { RigidBody, type PhysicsWorld } from '@drawcall/physics';
import type { Floor } from '@drawcall/animate';
import { Box3, Matrix3, Matrix4, Vector3 } from 'three';
import { HEIGHT } from './movement';

// A finite missing-floor value below the controller's respawn threshold.
const BOTTOM = -20;
const EDGE = 1e-6;
const AXES = ['x', 'y', 'z'] as const;

interface Surface {
  body: RigidBody;
  bounds: Box3;
  local: Box3;
  inverse: Matrix4;
  x: number;
  z: number;
  height: number;
}

/** Exact upward faces of the course's physics boxes (other shapes are no floor), sampled without resyncing the world for every foot probe. */
export class Terrain {
  private ceiling = HEIGHT;
  private readonly surfaces: Surface[] = [];
  private readonly point = new Vector3();

  constructor(private readonly world: PhysicsWorld) {}

  /** Snapshot completed collider poses once before updating the avatar. */
  update(feet: Readonly<Vector3>) {
    this.ceiling = feet.y + HEIGHT;
    this.surfaces.length = 0;
    this.world.scene.traverse((body) => {
      if (!(body instanceof RigidBody)) return;
      for (const collider of body.getColliders()) {
        // (the course is built of boxes: anything else — a grenade, its pin — is nothing to stand on)
        const shape = collider.shape();
        if (shape.kind !== 'box') continue;
        const half = new Vector3(...shape.size).multiplyScalar(0.5);
        const local = new Box3(half.clone().negate(), half);
        const bounds = local.clone().applyMatrix4(collider.matrixWorld);
        const inverse = collider.matrixWorld.clone().invert();
        const normals = new Matrix3().getNormalMatrix(collider.matrixWorld);
        for (const axis of AXES) for (const sign of [-1, 1]) {
          const normal = new Vector3();
          normal[axis] = sign;
          normal.applyNormalMatrix(normals);
          if (normal.y < Math.cos(Math.PI / 4)) continue;
          const point = new Vector3();
          point[axis] = sign * half[axis];
          point.applyMatrix4(collider.matrixWorld);
          this.surfaces.push({ body, bounds, local, inverse, x: -normal.x / normal.y, z: -normal.z / normal.y, height: normal.dot(point) / normal.y });
        }
      }
    });
  }

  readonly floor: Floor = Object.assign((x: number, z: number): number => {
    const surface = this.under(x, z);
    return surface ? surface.x * x + surface.z * z + surface.height : BOTTOM;
  }, { platform: (x: number, z: number) => this.under(x, z)?.body });

  private under(x: number, z: number): Surface | undefined {
    let height = BOTTOM;
    let found: Surface | undefined;
    for (const surface of this.surfaces) {
      const { bounds } = surface;
      if (x < bounds.min.x - EDGE || x > bounds.max.x + EDGE || z < bounds.min.z - EDGE || z > bounds.max.z + EDGE) continue;
      const y = surface.x * x + surface.z * z + surface.height;
      if (y < height || y > this.ceiling) continue;
      this.point.set(x, y, z).applyMatrix4(surface.inverse);
      if (AXES.some((axis) => this.point[axis] < surface.local.min[axis] - EDGE || this.point[axis] > surface.local.max[axis] + EDGE)) continue;
      height = y;
      found = surface;
    }
    return found;
  }
}
