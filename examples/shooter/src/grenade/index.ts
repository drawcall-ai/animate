import { RigidBody, SphereCollider, type PhysicsWorld } from '@drawcall/physics';
import type { Released } from '@drawcall/animate';
import { DataTexture, Group, LinearFilter, Matrix4, Object3D, PointLight, Sprite, SpriteMaterial, Vector3 } from 'three';
import type { Combatant } from '../combat';
import { GrenadeModel } from './model';

// The player carries `GRENADES` on the vest per encounter (a reset refills them). The view stays free until a grenade leaves the hand,
// which starts its fuse. A blast hurts soldiers in the open, the player too, and throws the crates; cover stops it.

export const GRENADES = 3;
export const FUSE = 3;
const RADIUS = 0.04, BLAST_RADIUS = 6;

interface Projectile {
  model: GrenadeModel;
  body: RigidBody;
  previous: Vector3;
  remaining: number;
  armed: boolean;
}

/** The inventory survives body replacements (getting out of a vehicle); only an encounter reset refills it. */
export class Grenades {
  readonly group = new Group();
  count = GRENADES;
  targets: readonly (Combatant & { readonly position: Vector3 })[] = [];
  onExplode?: (at: Vector3) => void;
  private readonly projectiles: Projectile[] = [];
  private readonly debris: { object: Object3D; velocity: Vector3; spin: Vector3; remaining: number }[] = [];
  private readonly blasts: { group: Group; age: number; material: SpriteMaterial; light: PointLight }[] = [];
  private readonly puff = dustTexture();

  constructor(private readonly world: PhysicsWorld, scene: Object3D) {
    this.group.name = 'Grenades and explosions';
    scene.add(this.group);
  }

  get flying() { return this.projectiles.length; }

  /** Adopt the actual released prop, keeping its world pose. The spoon leaves the fist and starts the fuse here. */
  launch(model: GrenadeModel, motion: Released, eye: Vector3, armed = true) {
    const body = this.falling(model.object, motion, RADIUS, 0.4);
    // A hand reaching through nearby cover must not put a grenade on its far side.
    const to = body.position.clone().sub(eye), distance = to.length();
    const hit = distance > 0 ? this.world.raycast(eye, to.divideScalar(distance), distance, { excludeBodies: [body] }) : null;
    if (hit) {
      body.position.copy(hit.point).addScaledVector(hit.normal, RADIUS + 0.01);
      body.updateMatrixWorld(true);
      body.teleport(body.matrixWorld);
      body.setVelocity({ linear: new Vector3() });
    }
    this.projectiles.push({ model, body, previous: body.position.clone(), remaining: FUSE, armed });
    if (armed) this.drop(model.spoon, { velocity: motion.velocity.clone().multiplyScalar(0.3).add(new Vector3(1, 2, 0)), spin: new Vector3(12, 3, 8) });
  }

  drop(object: Object3D, motion: Released) {
    this.group.attach(object);
    // Tiny cosmetic parts have no rigid colliders: a lever starts inside its grenade, and neither a pin nor a lever
    // should obstruct the player's capsule or deflect the projectile. They fall to the path's surfaces instead.
    this.debris.push({ object, velocity: motion.velocity.clone(), spin: motion.spin.clone().clampLength(0, 30), remaining: FUSE });
  }

  update(dt: number) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const projectile = this.projectiles[i], { body, previous } = projectile;
      // Rapier handles ordinary contacts. Sweep the travelled segment too: the public physics API has no CCD option,
      // and a 4 cm grenade can cross a thin target in one 60 Hz step.
      const travel = body.position.clone().sub(previous);
      if (travel.lengthSq() > RADIUS ** 2) {
        const hit = this.world.castCapsule({ radius: RADIUS, height: 0.001 }, new Matrix4().makeTranslation(previous), travel, { excludeBodies: [body] });
        const velocity = body.getVelocity();
        if (hit && velocity.linear.dot(hit.normal) < 0) {
          const at = previous.clone().addScaledVector(travel, hit.fraction).addScaledVector(hit.normal, 0.003);
          const pose = new Matrix4().compose(at, body.quaternion.clone().normalize(), new Vector3(1, 1, 1));
          body.teleport(pose);
          velocity.linear.addScaledVector(hit.normal, -1.45 * velocity.linear.dot(hit.normal));
          body.setVelocity(velocity);
        }
      }
      previous.copy(body.position);
      projectile.remaining -= dt;
      if (projectile.remaining > 0) continue;
      const at = body.position.clone();
      body.removeFromParent();
      this.projectiles.splice(i, 1);
      if (projectile.armed) this.explode(at);
      projectile.model.dispose();
    }
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const piece = this.debris[i];
      const travel = piece.velocity.clone().multiplyScalar(dt);
      if (travel.lengthSq() > 0) {
        const hit = this.world.raycast(piece.object.position, travel.clone().normalize(), travel.length() + 0.005,
          { excludeBodies: this.projectiles.map(({ body }) => body) });
        if (hit) {
          piece.object.position.copy(hit.point).addScaledVector(hit.normal, 0.005);
          piece.velocity.set(0, 0, 0);
          piece.spin.set(0, 0, 0);
        } else {
          piece.object.position.add(travel);
          piece.velocity.y += this.world.gravity[1] * dt;
          const spin = piece.spin.length();
          if (spin > 0) piece.object.rotateOnWorldAxis(piece.spin.clone().divideScalar(spin), spin * dt);
        }
      }
      piece.remaining -= dt;
      if (piece.remaining > 0) continue;
      piece.object.removeFromParent();
      this.debris.splice(i, 1);
    }
    for (let i = this.blasts.length - 1; i >= 0; i--) {
      const blast = this.blasts[i];
      blast.age += dt;
      const t = blast.age;
      blast.light.intensity = 18 * Math.max(0, 1 - t / 0.18);
      blast.material.color.set(t < 0.12 ? '#ffcd70' : '#7b746b');
      blast.material.opacity = Math.max(0, 0.8 * (1 - t / 1.2));
      for (const [j, node] of blast.group.children.entries()) {
        if (!(node instanceof Sprite)) continue;
        const angle = j * 2.4;
        node.position.set(Math.sin(angle) * t * 1.6, 0.15 + t * (0.5 + j * 0.08), Math.cos(angle) * t * 1.6);
        node.scale.setScalar(0.2 + t * (2.4 + j * 0.12));
      }
      if (t < 1.2) continue;
      blast.group.removeFromParent();
      blast.material.dispose();
      this.blasts.splice(i, 1);
    }
  }

  reset() {
    this.count = GRENADES;
    for (const { model, body } of this.projectiles.splice(0)) { body.removeFromParent(); model.dispose(); }
    for (const { object } of this.debris.splice(0)) object.removeFromParent();
    for (const { group, material } of this.blasts.splice(0)) { group.removeFromParent(); material.dispose(); }
  }

  dispose() { this.reset(); this.puff.dispose(); this.group.removeFromParent(); }

  private falling(object: Object3D, motion: Released, radius: number, mass: number) {
    object.updateWorldMatrix(true, true);
    const body = new RigidBody({ mass, material: { staticFriction: 0.65, dynamicFriction: 0.65, restitution: 0.45 },
      velocity: { linear: motion.velocity.toArray(), angular: motion.spin.toArray() } });
    body.name = `${object.name} in flight`;
    object.matrixWorld.decompose(body.position, body.quaternion, new Vector3());
    body.quaternion.normalize();
    this.group.add(body);
    body.updateMatrixWorld(true);
    body.attach(object);
    body.add(new SphereCollider({ radius }));
    body.setAngularDamping(0.35);
    return body;
  }

  private explode(at: Vector3) {
    // Cover stops blast damage; distance attenuates it. The thrower is a target too.
    for (const target of this.targets) {
      if (!target.alive) continue;
      const point = target.position.clone().add(new Vector3(0, 0.9, 0));
      const direction = point.clone().sub(at), distance = direction.length();
      if (distance >= BLAST_RADIUS) continue;
      if (distance > 0.001) {
        direction.divideScalar(distance);
        if (this.world.raycast(at, direction, distance)) continue;
      } else direction.set(0, 1, 0);
      target.hurt(Math.round(140 * (1 - distance / BLAST_RADIUS)), point, direction);
    }
    const props: RigidBody[] = [];
    this.world.scene.traverse((node) => { if (node instanceof RigidBody && node.bodyType === 'dynamic') props.push(node); });
    for (const body of props) {
      const direction = body.getWorldPosition(new Vector3()).sub(at), distance = direction.length();
      if (distance < 0.01 || distance >= BLAST_RADIUS) continue;
      direction.divideScalar(distance);
      if (this.world.raycast(at, direction, distance, { excludeBodies: [body] })) continue;
      body.applyImpulse(direction.multiplyScalar(22 * (1 - distance / BLAST_RADIUS)));
    }
    const group = new Group(), material = new SpriteMaterial({ map: this.puff, color: '#ffcd70', transparent: true, depthWrite: false });
    group.name = 'Grenade blast';
    group.position.copy(at);
    const light = new PointLight('#ffb851', 18, 8, 2);
    group.add(light);
    for (let i = 0; i < 9; i++) { const cloud = new Sprite(material); cloud.scale.setScalar(0.2); group.add(cloud); }
    this.group.add(group);
    this.blasts.push({ group, age: 0, material, light });
    this.onExplode?.(at);
  }
}

/** A small soft, uneven opacity mask: smoke billboards without an asset download or a DOM dependency. */
function dustTexture() {
  const size = 64, pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = (x + 0.5) / size * 2 - 1, v = (y + 0.5) / size * 2 - 1;
    const edge = Math.max(0, 1 - Math.hypot(u, v));
    const noise = 0.75 + 0.15 * Math.sin(x * 0.4 + Math.sin(y * 0.3) * 2) + 0.1 * Math.sin(y * 0.7 - x * 0.2);
    const i = (y * size + x) * 4;
    pixels[i] = pixels[i + 1] = pixels[i + 2] = 255;
    pixels[i + 3] = Math.round(255 * edge * edge * noise);
  }
  const texture = new DataTexture(pixels, size, size);
  texture.magFilter = texture.minFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}
