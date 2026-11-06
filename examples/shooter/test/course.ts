import { afterEach, expect } from 'vitest';
import { BoxCollider, RigidBody, type PhysicsWorld } from '@drawcall/physics';
import { buildWorld } from '@drawcall/physics-rapier';
import type { Body } from '@drawcall/animate';
import { Object3D, Scene, Vector3 } from 'three';
import { Avatar, type AvatarState } from '../src/avatar';
import type { Sound } from '../src/audio';
import { GRAVITY, Movement } from '../src/movement';
import { Soldier, type Mounts } from '../src/soldier';
import { Terrain } from '../src/terrain';

export const DT = 1 / 60;

const cleanups: (() => void)[] = [];
afterEach(() => { for (const dispose of cleanups.splice(0).reverse()) dispose(); });

/** Runs `dispose` after the current test, after everything registered later. */
export function cleanup(dispose: () => void) { cleanups.push(dispose); }

export function box(scene: Scene, size: [number, number, number], at: [number, number, number], bodyType: 'static' | 'kinematic' = 'static', name = '') {
  const body = new RigidBody({ bodyType });
  body.name = name;
  body.position.set(...at);
  body.add(new BoxCollider({ size }));
  scene.add(body);
  return body;
}

/** The course's eight 22 cm risers on 55 cm treads, rising toward +z from their front edge at `z`, with the 1.76 m landing above. */
export function stairs(scene: Scene, x = 0, z = 0) {
  for (let i = 0; i < 8; i++) box(scene, [3, (i + 1) * 0.22, 0.55], [x, (i + 1) * 0.11, z + i * 0.55 + 0.275], 'static', 'Stairs');
  box(scene, [3, 1.76, 3], [x, 0.88, z + 5.9], 'static', 'Stair landing');
}

/** A 20 cm slab rising `rise` over `run` toward +z from the floor at `z`. */
export function ramp(scene: Scene, { x = 0, z = 0, width, run, rise }: { x?: number; z?: number; width: number; run: number; rise: number }) {
  const angle = Math.atan2(rise, run);
  const body = box(scene, [width, 0.2, Math.hypot(run, rise)], [x, rise / 2 - 0.1 * Math.cos(angle), z + run / 2], 'static', 'Ramp');
  body.rotation.x = -angle;
  return body;
}

interface Options {
  spawn?: Vector3;
  yaw?: number;
  /** The physics step. */
  dt?: number;
}

/** A physics world over the bodies `build` adds, with the player's capsule at `spawn`; `built` is what `build` returns. */
export async function course<T>(build: (scene: Scene) => T, { spawn = new Vector3(0, 0.02, 0), yaw = 0, dt = DT }: Options = {}) {
  const scene = new Scene();
  const built = build(scene);
  const player = new Object3D();
  player.position.copy(spawn);
  scene.add(player);
  const world = await buildWorld({ scene, fixedDelta: dt, gravity: [0, GRAVITY, 0] });
  const movement = new Movement(world, player);
  movement.input.yaw = yaw;
  cleanup(() => world.dispose());
  cleanup(() => movement.dispose());
  const advance = (seconds: number) => { for (let i = 0; i < Math.round(seconds / dt); i++) world.update(dt); };
  return { scene, world, movement, advance, built };
}

/** `course` with the player's avatar driven by the capsule after every physics step, as `Soldier` drives it. */
export async function soldierOn<T>(build: (scene: Scene) => T, options: Options & { pitch?: number; firstPerson?: boolean } = {}) {
  const { pitch = 0, firstPerson = true } = options;
  const run = await course(build, options);
  const { scene, world, movement } = run;
  const terrain = new Terrain(world);
  terrain.update(movement.position);
  const avatar = new Avatar(scene, undefined, terrain.floor);
  avatar.reset(movement.position, movement.input.yaw);
  cleanup(() => avatar.dispose());
  world.onAfterStep((dt) => {
    terrain.update(movement.position);
    avatar.update(dt, {
      position: movement.position, velocity: movement.actualVelocity, support: movement.support, platform: movement.platform,
      yaw: movement.input.yaw, pitch, aim: movement.input.aim, sprint: movement.sprinting, crouch: movement.crouched,
      takeoff: movement.takeoff, firstPerson,
    });
  });
  /** Steps until the avatar holds its rifle, then one more second. */
  const acquire = () => {
    for (let frame = 0; frame < 600 && !avatar.acquired; frame++) world.update(world.fixedDelta);
    expect(avatar.acquired).toBe(true);
    run.advance(1);
  };
  return { ...run, terrain, avatar, acquire };
}

function proportions(body: Body) {
  const person = body.species.person;
  if (!person) throw new Error('The soldier needs humanoid proportions');
  return person;
}

/** A world over the bodies `build` adds with a silent soldier at each spawn, given as its name, position and first-person view. */
export async function soldiers(build: (scene: Scene) => void, ...spawns: [name: string, at: Vector3, firstPerson: boolean][]) {
  const scene = new Scene();
  build(scene);
  const world = await buildWorld({ scene, fixedDelta: DT, gravity: [0, GRAVITY, 0] });
  cleanup(() => world.dispose());
  const all = spawns.map(([name, at, firstPerson]) => new Soldier(name, world, scene, undefined, at, firstPerson, () => {}));
  for (const soldier of all) cleanup(() => soldier.dispose());
  return { scene, world, soldiers: all };
}

/** An avatar without physics standing at `input`'s position, disposed after the test. */
export function avatarAt(input: AvatarState) {
  const avatar = new Avatar(new Scene());
  avatar.reset(input.position);
  cleanup(() => avatar.dispose());
  return avatar;
}

export function node(parent: Object3D, name: string) {
  const found = parent.getObjectByName(name);
  if (!found) throw new Error(`Missing node ${name}`);
  return found;
}

/** World points of the heel and both toe tips of a foot's sole, from the bones' current world matrices. */
export function soles(body: Body, side: 'left' | 'right') {
  const { heel, bigToe, smallToe } = proportions(body).sole;
  const points: [Object3D, Vector3][] = [[body.bones[`${side}Foot`], heel], [body.bones[`${side}Toes`], bigToe], [body.bones[`${side}Toes`], smallToe]];
  return points.map(([bone, at]) => bone.localToWorld(new Vector3(side === 'left' ? at.x : -at.x, at.y, at.z)));
}

/** How far hand `side`'s wrist is from where its grip `empty` puts it (m): off the rifle, by that much. */
export function offGrip(body: Body, side: 'left' | 'right', empty: Object3D) {
  return body.bones[`${side}Hand`].getWorldPosition(new Vector3()).distanceTo(body.gripOn(side, body.placement(side, empty)).wrist);
}

/**
 * Builds `scene`'s world with a soldier standing at `at` who can get on what `mounts` makes in it, once its hands have its rifle; `heard`,
 * the sounds it has made since; and `until`, which steps the world until `done`, failing if that takes more than `seconds`, and returns
 * the seconds it took.
 */
export async function mountable<T extends Mounts>(scene: Scene, at: Vector3, mounts: (world: PhysicsWorld) => T) {
  const world = await buildWorld({ scene, fixedDelta: DT, gravity: [0, GRAVITY, 0] });
  cleanup(() => world.dispose());
  const made = mounts(world);
  const heard: Sound[] = [];
  const soldier = new Soldier('Soldier', world, scene, undefined, at, true, (sound) => heard.push(sound), made);
  cleanup(() => soldier.dispose());
  world.onAfterStep((dt) => soldier.update(dt));
  const until = (done: () => boolean, seconds: number) => {
    let frame = 0;
    for (; frame < seconds / DT && !done(); frame++) world.update(DT);
    expect(done()).toBe(true);
    return frame * DT;
  };
  until(() => soldier.avatar.acquired, 10);
  heard.length = 0;
  return { world, soldier, until, heard, ...made };
}

/** Called once a frame, tracks the largest change in how far `thing` moves from one frame to the next (m): a jump shows as a spike. */
export function jerkless(thing: Object3D) {
  let at = thing.getWorldPosition(new Vector3()), moved = new Vector3();
  const step = () => {
    const now = thing.getWorldPosition(new Vector3()), by = now.clone().sub(at);
    step.jerk = Math.max(step.jerk, by.distanceTo(moved));
    at = now;
    moved = by;
    return true;
  };
  step.jerk = 0;
  return step;
}
