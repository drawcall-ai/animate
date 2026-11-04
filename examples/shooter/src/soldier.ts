import type { PhysicsWorld } from '@drawcall/physics';
import { Group, Mesh, Object3D, Scene, SkinnedMesh, Vector3 } from 'three';
import { lookDirection } from './angles';
import { Avatar } from './avatar';
import { Contacts, type Play } from './audio';
import { Combat, MAGAZINE, type Combatant } from './combat';
import { Movement } from './movement';
import type { Look } from './playback';
import { Ragdoll, Trail } from './ragdoll';
import { Terrain } from './terrain';

/** N·s the killing shot strikes the ragdoll with: a game's exaggeration of a bullet's momentum (~4 N·s), so the body falls along the shot. */
const KILL = 25;

/** The player and opponent share the same body, controller, weapon and magazine lifecycle. */
export class Soldier implements Combatant {
  readonly movement: Movement;
  readonly avatar: Avatar;
  readonly combat: Combat;
  readonly meshes: Mesh[] = [];
  readonly view = { pitch: 0, aimPoint: new Vector3() };
  /** What it leaves in the world when it dies, its ragdoll and dropped rifle: display it through `Playback` as the avatar's group. */
  readonly remains = new Group();
  health = 100;
  private readonly terrain: Terrain;
  private readonly contacts: Contacts;
  private refilled = 0;
  private ragdoll: Ragdoll | undefined;
  private readonly trail = new Trail();

  constructor(
    readonly name: string, world: PhysicsWorld, scene: Scene, model: Object3D | undefined,
    private readonly spawn: Vector3, readonly firstPerson: boolean, private readonly sound: Play,
  ) {
    const object = new Object3D();
    object.position.copy(spawn);
    scene.add(object);
    this.movement = new Movement(world, object);
    this.terrain = new Terrain(world);
    this.terrain.update(spawn);
    this.avatar = new Avatar(scene, model, this.terrain.floor, phase => {
      if (phase === 'out') sound('reload', 0.2, 0, 0.2);
      else sound('reload', 0.2, 0.318, 0.962);
    });
    this.avatar.group.name = name;
    this.remains.name = `${name} remains`;
    scene.add(this.remains);
    this.combat = new Combat(world, scene);
    this.contacts = new Contacts((name, gain) => {
      sound(name, gain);
      if (name === 'jump' || name === 'land') sound('cloth', 0.06);
    });
    this.reset();
  }

  get alive() { return this.health > 0; }
  get position() { return this.movement.position; }

  /** Asks to aim; there is no aiming, and so no aiming pace, while a reload is asked for or under way. */
  set aim(wanted: boolean) { this.movement.input.aim = wanted && !this.avatar.reloading; }

  reset(position = this.spawn, yaw = 0) {
    this.health = 100;
    this.ragdoll?.dispose();
    this.ragdoll = undefined;
    this.trail.clear();
    this.movement.reset(position);
    this.movement.input.yaw = yaw;
    this.terrain.update(position);
    this.avatar.reset(position, yaw);
    this.combat.reset();
    this.refilled = 0;
    this.view.pitch = 0;
    lookDirection(yaw, 0, this.view.aimPoint).multiplyScalar(100).add(position).y += 1.6;
    this.meshes.length = 0;
    this.avatar.body.object.traverse(node => { if (node instanceof SkinnedMesh) this.meshes.push(node); });
    this.contacts.reset(this.avatar.body, this.movement);
  }

  update(dt: number) {
    this.combat.update(dt);
    if (this.ragdoll) { this.ragdoll.pose(dt); return; }
    const motion = this.movement, input = motion.input;
    this.terrain.update(motion.position);
    this.avatar.update(dt, {
      position: motion.position, velocity: motion.actualVelocity, yaw: input.yaw, pitch: this.view.pitch,
      aim: input.aim, aimPoint: this.firstPerson ? undefined : this.view.aimPoint, sprint: motion.sprinting, crouch: motion.crouched,
      support: motion.support, platform: motion.platform, takeoff: motion.takeoff, firstPerson: this.firstPerson,
    });
    if (this.avatar.reloads > this.refilled) {
      this.refilled = this.avatar.reloads;
      this.combat.refill();
    }
    this.trail.record(this.avatar, dt);
    this.contacts.update(this.avatar.body, motion);
  }

  /** What it sees: from its eye, or once dead from its ragdoll's head. */
  look(): Look { return this.ragdoll?.look() ?? this.avatar.look(); }

  reload() {
    if (!this.alive || this.combat.ammo === MAGAZINE) return;
    this.avatar.requestReload();
  }

  shoot(eye = this.avatar.look().eye, muzzle = this.avatar.muzzle.getWorldPosition(new Vector3()), direction = this.avatar.muzzle.getWorldDirection(new Vector3())) {
    if (!this.alive || this.combat.ammo === 0 || !this.avatar.fire()) return false;
    this.combat.fire(eye, muzzle, direction);
    this.sound('shot', 0.38);
    return true;
  }

  hurt(damage: number, point: Vector3, direction: Vector3) {
    if (!this.alive) return;
    this.health = Math.max(0, this.health - damage);
    if (this.alive) { this.avatar.body.applyImpulse(direction.clone().multiplyScalar(8), point); return; }
    this.movement.stop();
    this.ragdoll = new Ragdoll(this.remains, this.avatar, this.trail, direction.clone().multiplyScalar(KILL), point);
  }

  dispose() {
    this.ragdoll?.dispose();
    this.movement.dispose();
    this.movement.object.removeFromParent();
    this.avatar.dispose();
    this.combat.dispose();
    this.remains.removeFromParent();
  }
}
