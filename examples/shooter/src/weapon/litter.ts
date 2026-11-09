import { BoxCollider, RigidBody } from '@drawcall/physics';
import { BufferGeometry, Mesh, Object3D, Vector3 } from 'three';
import { RIFLE } from './index';

/** A magazine's body as it collides (m, its frame): its 2.8 cm thick, 15.5 cm long, 8 cm deep curved box, squared off. */
const BODY = { size: [0.028, 0.155, 0.08] as const, at: new Vector3(0, -0.004, -0.005) };
/** How a magazine's steel body meets the floor: gripping it and not bouncing, so it slides on a little and stops rather than skipping
 * and tumbling on to wherever it happens to. */
const MATERIAL = { staticFriction: 1, dynamicFriction: 1, restitution: 0 };
/** How many spent magazines lie about before the oldest is cleared. */
const KEPT = 6;

/**
 * What a soldier lets go of to fall, its spent magazines: each a rigid body of its own under the scene, as a dead soldier's rifle is,
 * leaving the hand as the hand last moved and turned it, falling onto the floor and the path and coming to rest by itself; past `KEPT`
 * the oldest is cleared away.
 */
export class Litter {
  private readonly bodies: RigidBody[] = [];

  constructor(private readonly scene: Object3D) {}

  /** `object` let go of, moving at `velocity` (m/s) and turning at `spin` (rad/s about the world's axes): it flies on from where it is */
  drop(object: Object3D, velocity: Readonly<Vector3>, spin: Readonly<Vector3>) {
    const body = new RigidBody({ mass: RIFLE.magazine.mass, material: MATERIAL, velocity: { linear: velocity.toArray(), angular: spin.toArray() } });
    object.matrixWorld.decompose(body.position, body.quaternion, new Vector3());
    this.scene.add(body);
    body.updateMatrixWorld();
    body.attach(object);
    const box = new BoxCollider({ size: [...BODY.size] });
    box.position.copy(BODY.at).applyMatrix4(object.matrix);
    box.quaternion.copy(object.quaternion);
    body.add(box);
    this.bodies.push(body);
    const cleared = this.bodies.length > KEPT ? this.bodies.shift() : undefined;
    if (cleared) dispose(cleared);
  }

  /** clears every magazine away */
  clear() {
    for (const body of this.bodies.splice(0)) dispose(body);
  }
}

function dispose(body: RigidBody) {
  body.removeFromParent();
  const geometries = new Set<BufferGeometry>();
  body.traverse((node) => { if (node instanceof Mesh) geometries.add(node.geometry); });
  for (const geometry of geometries) geometry.dispose();
}
