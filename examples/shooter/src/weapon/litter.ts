import type { Floor } from '@drawcall/animate';
import { BufferGeometry, Mesh, Object3D, Quaternion, Vector3 } from 'three';

const GRAVITY = 9.81;
/** How a magazine falling onto the floor bounces (a light steel box onto hard ground): how much of its fall it springs back up with, how
 * much of its slide and turn it keeps, and how fast it must come down to bounce at all (m/s); slower, it lands. */
const BOUNCE = { up: 0.25, kept: 0.5, least: 1 };
/** How far a magazine lying on its side stands its middle off the floor (m): half its body's thickness. */
const LYING = 0.014;
/** How fast a landed magazine settles flat (s, about two thirds of the way), and how many lie about before the oldest is cleared. */
const SETTLE = 0.06;
const KEPT = 6;

/**
 * What a soldier lets go of to fall, its spent magazines: each, under the scene, flies on from where it left the hand as the hand moved
 * and turned it, falling, bounces off the floor below it (`floor`) as long as it comes down hard enough, then settles lying flat on a
 * side where it landed; past `KEPT` the oldest is cleared away.
 */
export class Litter {
  private readonly falling: { object: Object3D; velocity: Vector3; spin: Vector3; landed: boolean }[] = [];

  constructor(private readonly scene: Object3D, private readonly floor: Floor) {}

  /** `object` let go of, moving at `velocity` (m/s) and turning at `spin` (rad/s about the world's axes): it flies on from where it is */
  drop(object: Object3D, velocity: Readonly<Vector3>, spin: Readonly<Vector3>) {
    this.scene.attach(object);
    this.falling.push({ object, velocity: velocity.clone(), spin: spin.clone(), landed: false });
    const cleared = this.falling.length > KEPT ? this.falling.shift() : undefined;
    if (cleared) dispose(cleared.object);
  }

  update(seconds: number) {
    for (const drop of this.falling) {
      const { object, velocity, spin } = drop;
      if (drop.landed) {
        // (its thin side, its own X, turned toward up, its length kept where it points)
        const up = new Vector3(1, 0, 0).applyQuaternion(object.quaternion), sign = up.y < 0 ? -1 : 1;
        const flat = new Quaternion().setFromUnitVectors(up, new Vector3(0, sign, 0)).multiply(object.quaternion);
        object.quaternion.slerp(flat, 1 - Math.exp(-seconds / SETTLE));
        continue;
      }
      velocity.y -= GRAVITY * seconds;
      object.position.addScaledVector(velocity, seconds);
      const rate = spin.length();
      if (rate > 0) object.quaternion.premultiply(new Quaternion().setFromAxisAngle(spin.clone().divideScalar(rate), rate * seconds));
      const ground = this.floor(object.position.x, object.position.z) + LYING;
      if (object.position.y > ground) continue;
      object.position.y = ground;
      if (-velocity.y < BOUNCE.least) {
        drop.landed = true;
        continue;
      }
      velocity.set(velocity.x * BOUNCE.kept, -velocity.y * BOUNCE.up, velocity.z * BOUNCE.kept);
      spin.multiplyScalar(BOUNCE.kept);
    }
  }

  dispose() {
    for (const { object } of this.falling.splice(0)) dispose(object);
  }
}

function dispose(object: Object3D) {
  object.removeFromParent();
  const geometries = new Set<BufferGeometry>();
  object.traverse((node) => { if (node instanceof Mesh) geometries.add(node.geometry); });
  for (const geometry of geometries) geometry.dispose();
}
