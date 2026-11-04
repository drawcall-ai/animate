import { RigidBody, type PhysicsWorld, type RaycastHit } from '@drawcall/physics';
import { BufferGeometry, Line, LineBasicMaterial, Mesh, MeshBasicMaterial, Raycaster, SkinnedMesh, SphereGeometry, Vector3, type Scene } from 'three';

export interface Combatant {
  readonly name: string;
  readonly alive: boolean;
  readonly meshes: readonly Mesh[];
  hurt(damage: number, point: Vector3, direction: Vector3): void;
}

export const MAGAZINE = 30;
/** Seconds the hit marker shows. */
const MARKER = 0.14;

/** Ammunition, the shot's ray and its effects; the avatar's timeline owns fire rate and the reload itself. */
export class Combat {
  targets: readonly Combatant[] = [];
  damage = 25;
  ammo = MAGAZINE;
  hits = 0;
  feedback = 'Range ready';
  private flashTime = 0;
  private hitTime = 0;
  private killed = false;
  private readonly tracer = new Line(new BufferGeometry().setFromPoints([new Vector3(), new Vector3()]), new LineBasicMaterial({ color: 0xffe9a2 }));
  private readonly impact = new Mesh(new SphereGeometry(0.045, 8, 6), new MeshBasicMaterial({ color: 0xffdc85 }));

  constructor(private readonly world: PhysicsWorld, scene: Scene) {
    this.tracer.frustumCulled = false;
    this.tracer.visible = this.impact.visible = false;
    scene.add(this.tracer, this.impact);
  }

  get hit() { return this.hitTime > 0; }
  /** Whether the shown hit defeated its target. */
  get kill() { return this.hit && this.killed; }

  update(dt: number) {
    this.flashTime = Math.max(0, this.flashTime - dt);
    this.hitTime = Math.max(0, this.hitTime - dt);
    if (this.flashTime === 0) this.tracer.visible = this.impact.visible = false;
  }

  /** Called once the animated magazine swap has finished. */
  refill() {
    this.ammo = MAGAZINE;
    this.feedback = 'Magazine ready';
  }

  fire(eye: Vector3, muzzle: Vector3, forward: Vector3) {
    if (this.ammo === 0) throw new Error('Fired an empty magazine');
    this.ammo--;
    this.flashTime = 0.045;
    // A barrel poking through a wall cannot bypass the cover between it and the player.
    const barrel = muzzle.clone().sub(eye);
    const length = barrel.length();
    const blocked = length > 0.01 ? this.world.raycast(eye, barrel.divideScalar(length), length) : null;
    const direction = forward.clone().normalize();
    const hit = blocked ?? this.world.raycast(muzzle, direction, 120);
    const ray = new Raycaster(muzzle, direction, 0, hit ? muzzle.distanceTo(hit.point) : 120);
    let victim: { target: Combatant; point: Vector3; distance: number } | undefined;
    if (!blocked) for (const target of this.targets) {
      if (!target.alive) continue;
      for (const mesh of target.meshes) if (mesh instanceof SkinnedMesh) mesh.computeBoundingSphere();
      const contact = ray.intersectObjects([...target.meshes], false)[0];
      if (contact && (!victim || contact.distance < victim.distance)) victim = { target, point: contact.point, distance: contact.distance };
    }
    const end = victim?.point ?? hit?.point ?? muzzle.clone().addScaledVector(direction, 120);
    this.tracer.geometry.setFromPoints([blocked ? eye : muzzle, end]);
    this.tracer.visible = true;
    this.impact.visible = !!victim || hit !== null;
    this.impact.position.copy(end);
    if (victim) {
      victim.target.hurt(this.damage, victim.point, direction);
      this.mark(!victim.target.alive);
      this.feedback = victim.target.alive ? `${victim.target.name} hit` : `${victim.target.name} defeated`;
    } else this.feedback = hit ? this.strike(hit, direction) : 'Miss';
  }

  reset() {
    this.ammo = MAGAZINE;
    this.hits = this.flashTime = this.hitTime = 0;
    this.killed = false;
    this.feedback = 'Range ready';
    this.tracer.visible = this.impact.visible = false;
  }

  dispose() {
    this.tracer.removeFromParent(); this.impact.removeFromParent();
    this.tracer.geometry.dispose(); this.tracer.material.dispose();
    this.impact.geometry.dispose(); this.impact.material.dispose();
  }

  private mark(killed: boolean) {
    this.hits++;
    this.hitTime = MARKER;
    this.killed = killed;
  }

  private strike(hit: RaycastHit, direction: Vector3) {
    if (hit.kind !== 'body') return 'Impact';
    if (hit.body instanceof RigidBody && hit.body.bodyType === 'dynamic')
      hit.body.applyImpulse(direction.clone().multiplyScalar(12), hit.point);
    if (!hit.body.userData.target) return hit.body.name || 'Impact';
    this.mark(false);
    return `${hit.body.name} · ${this.hits} hits`;
  }
}
