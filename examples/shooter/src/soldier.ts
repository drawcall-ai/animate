import type { PhysicsWorld } from '@drawcall/physics';
import type { Species } from '@drawcall/animate';
import { Group, Mesh, Object3D, Scene, SkinnedMesh, Vector3 } from 'three';
import { lookDirection } from './angles';
import { Avatar, type AvatarState } from './avatar';
import { Contacts, type Play } from './audio';
import { Combat, MAGAZINE, type Combatant } from './combat';
import { Movement } from './movement';
import type { Look } from './playback';
import { Ragdoll, Trail } from './ragdoll';
import { Climber } from './ladder/climber';
import type { Ladder } from './ladder/model';
import type { Mount } from './mount';
import { Driver } from './rover/driver';
import type { Handling } from './rover/handling';
import type { Rover } from './rover/model';
import { Terrain } from './terrain';

/** The most seconds a fresh body may take to have its rifle in its hands. */
const READY = 3;
/** N·s the killing shot strikes the ragdoll with: a game's exaggeration of a bullet's momentum (~4 N·s), so the body falls along the shot. */
const KILL = 25;

/** What a soldier can get on: a rover's seat, a ladder. */
export interface SoldierOptions {
  vehicle?: { rover: Rover; handling: Handling };
  ladder?: Ladder;
  species?: Species<string, 'left' | 'right'>;
}

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
  /** Its seat at a rover's wheel, if it can drive one, and its place on a ladder, if it can climb one. */
  readonly driver: Driver | undefined;
  readonly climber: Climber | undefined;
  private readonly terrain: Terrain;
  private readonly contacts: Contacts;
  private refilled = 0;
  /** Seconds a fresh body has been readied for. */
  private readied = 0;
  private ragdoll: Ragdoll | undefined;
  private readonly trail = new Trail();

  constructor(
    readonly name: string, private readonly world: PhysicsWorld, scene: Scene, model: Object3D | undefined,
    private readonly spawn: Vector3, readonly firstPerson: boolean, readonly sound: Play,
    { vehicle, ladder, species }: SoldierOptions = {},
  ) {
    if (vehicle) this.driver = new Driver(this, vehicle.rover, vehicle.handling, world, model);
    if (ladder) this.climber = new Climber(this, ladder, world, model);
    const object = new Object3D();
    object.position.copy(spawn);
    scene.add(object);
    this.movement = new Movement(world, object);
    this.terrain = new Terrain(world);
    this.terrain.update(spawn);
    this.avatar = new Avatar(scene, model, this.terrain.floor, phase => {
      if (phase === 'out') sound('reload', 0.2, 0, 0.2);
      else sound('reload', 0.2, 0.318, 0.962);
    }, species);
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
  get position() { return this.mounted?.position ?? this.movement.position; }
  /** What it can get on: the rover's seat, the ladder. */
  get mounts(): Mount[] { return [this.driver, this.climber].filter((mount) => mount !== undefined); }
  /** What it is on, getting on or getting off, posed there. */
  get mounted() { return this.mounts.find((mount) => mount.posed); }

  /** Asks to aim; there is no aiming, and so no aiming pace, while a reload or a press is asked for or under way. */
  set aim(wanted: boolean) { this.movement.input.aim = wanted && !this.avatar.reloading && !this.avatar.pressing; }

  reset(position = this.spawn, yaw = 0) {
    this.health = 100;
    this.ragdoll?.dispose();
    this.ragdoll = undefined;
    for (const mount of this.mounts) mount.reset();
    this.combat.reset();
    this.view.pitch = 0;
    this.place(position, yaw);
  }

  /** Stands it afresh at `position` facing `yaw`. */
  place(position: Vector3, yaw: number) {
    this.stage(position, yaw);
    this.avatar.reset(position, yaw);
    this.shown();
  }

  /**
   * Starts readying a fresh body standing at `position` facing `yaw` that snatches up its rifle, off screen while the body shown is posed
   * elsewhere: `ready` steps it and shows it once it holds the rifle.
   */
  prepare(position: Vector3, yaw: number) {
    this.stage(position, yaw);
    this.avatar.prepare(position, yaw);
    this.readied = 0;
  }

  /** Steps the fresh body `steps` world steps on, standing still; true once it holds its rifle and is shown. */
  ready(steps: number): boolean {
    const step = this.world.fixedDelta;
    for (let i = 0; i < steps; i++) {
      this.terrain.update(this.movement.position);
      if (this.avatar.ready(step, this.state())) { this.shown(); return true; }
      if ((this.readied += step) > READY) throw new Error(`${this.name} did not take up its rifle within ${READY} s`);
    }
    return false;
  }

  update(dt: number) {
    this.combat.update(dt);
    if (this.ragdoll) { this.ragdoll.pose(dt); return; }
    // (every mount steps; one getting on, on or getting off poses the body itself)
    const posing = this.mounts.map((mount) => mount.update(dt)).some(Boolean);
    if (posing) { this.trail.record(this.avatar, dt); return; }
    this.stand(dt);
  }

  /** Puts its capsule at `position` facing `yaw`, for a fresh body to stand on. */
  private stage(position: Vector3, yaw: number) {
    this.trail.clear();
    this.movement.reset(position);
    this.movement.input.yaw = yaw;
    this.terrain.update(position);
    lookDirection(yaw, 0, this.view.aimPoint).multiplyScalar(100).add(position).y += 1.6;
  }

  /** Takes up the body just shown, its reloads counted afresh. */
  private shown() {
    this.refilled = this.avatar.reloads;
    this.meshes.length = 0;
    this.avatar.body.object.traverse(node => { if (node instanceof SkinnedMesh) this.meshes.push(node); });
    this.contacts.reset(this.avatar.body, this.movement);
  }

  /** What its body is asked to do, from its capsule. */
  private state(): AvatarState {
    const motion = this.movement, input = motion.input;
    return {
      position: motion.position, velocity: motion.actualVelocity, yaw: input.yaw, pitch: this.view.pitch,
      aim: input.aim, aimPoint: this.firstPerson ? undefined : this.view.aimPoint, sprint: motion.sprinting, crouch: motion.crouched,
      support: motion.support, platform: motion.platform, takeoff: motion.takeoff, firstPerson: this.firstPerson,
    };
  }

  /** Steps its body on its capsule. */
  private stand(dt: number) {
    this.terrain.update(this.movement.position);
    this.avatar.update(dt, this.state());
    if (this.avatar.reloads > this.refilled) {
      this.refilled = this.avatar.reloads;
      this.combat.refill();
    }
    this.trail.record(this.avatar, dt);
    this.contacts.update(this.avatar.body, this.movement);
  }

  /** What it sees: from its eye, or once dead from its ragdoll's head. */
  look(): Look { return this.ragdoll?.look() ?? this.mounted?.look() ?? this.avatar.look(); }

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
    for (const mount of this.mounts) mount.reset();
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
