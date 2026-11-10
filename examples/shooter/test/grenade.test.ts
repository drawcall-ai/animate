import { describe, expect, it } from 'vitest';
import { RigidBody, SphereCollider } from '@drawcall/physics';
import { Vector3 } from 'three';
import { FUSE, Grenades } from '../src/grenade/index';
import { GrenadeModel } from '../src/grenade/model';
import { box, cleanup, course, DT, node, offGrip, soldiers } from './course';

describe('grenades', () => {
  it('takes a finite loadout from the vest, pulls the pin, releases from the hand, and returns to both rifle grips', async () => {
    const { world, scene, soldiers: [player] } = await soldiers((scene) => box(scene, [80, 1, 80], [0, -0.5, 0]), ['Player', new Vector3(0, 0.04, 0), true]);
    world.onAfterStep((dt) => player.update(dt));
    for (let i = 0; i < 180; i++) world.update(DT);
    const grenades = player.grenades!;
    const phases = new Set<string>();
    for (let n = 0; n < 3; n++) {
      expect(player.throwGrenade()).toBe(true);
      expect(player.throwGrenade()).toBe(false);
      expect(player.avatar.fire()).toBe(false);
      let released = false;
      for (let i = 0; i < 600 && player.avatar.throwing; i++) {
        phases.add(player.avatar.grenadePhase);
        world.update(DT);
        if (grenades.flying) released = true;
      }
      expect(player.avatar.throwing, player.avatar.grenadePhase).toBe(false);
      expect(released).toBe(true);
      expect(grenades.count).toBe(2 - n);
      expect(player.avatar.body.holds(player.avatar.rifle)).toBe(true);
      for (const [side, grip] of [['right', 'pistol'], ['left', 'foregrip']] as const)
        expect(offGrip(player.avatar.body, side, node(player.avatar.rifle, grip))).toBeLessThan(0.035);
      expect(player.avatar.fire()).toBe(true);
    }
    expect(phases).toContain('Pulling pin');
    expect(phases).toContain('Throwing');
    expect(player.throwGrenade()).toBe(false);
    player.reset();
    expect(grenades.count).toBe(3);
    expect(grenades.flying).toBe(0);
    expect(scene.getObjectByName('Grenade blast')).toBeUndefined();
    expect(node(player.avatar.group, 'Grenade 3')).toBeDefined();
  });

  it.each([
    { crouch: true, moving: false, pitch: -1.2 },
    { crouch: false, moving: true, pitch: 1.1 },
  ])('throws while crouch=$crouch, moving=$moving, aiming at pitch $pitch', async ({ crouch, moving, pitch }) => {
    const { world, soldiers: [player] } = await soldiers((scene) => box(scene, [44, 1, 44], [0, -0.5, 0]), ['Player', new Vector3(0, 0.04, 0), true]);
    world.onAfterStep((dt) => player.update(dt));
    for (let i = 0; i < 180; i++) world.update(DT);
    player.movement.input.crouch = crouch;
    player.movement.input.move.set(moving ? 0.5 : 0, 0, moving ? 0.5 : 0);
    for (let i = 0; i < 60; i++) world.update(DT);
    expect(player.throwGrenade()).toBe(true);
    let flight: Vector3 | undefined;
    for (let i = 0; i < 600 && player.avatar.throwing; i++) {
      // Change aim during preparation, so this checks the view at release rather than at the G press.
      if (player.avatar.grenadePhase === 'Pulling pin') { player.view.pitch = pitch; player.movement.input.yaw = 0.8; }
      world.update(DT);
      const projectile = player.grenades?.group.children.find((node) => node.name === 'Grenade 1 in flight');
      if (!flight && projectile instanceof RigidBody) flight = projectile.getVelocity().linear;
    }
    expect(player.avatar.throwing, player.avatar.grenadePhase).toBe(false);
    expect(flight).toBeDefined();
    expect(Math.sign(flight!.y)).toBe(Math.sign(pitch));
    expect(flight!.x).toBeGreaterThan(0);
    // A fresh body after dismounting must retain the spent inventory.
    player.prepare(player.position.clone(), player.movement.input.yaw);
    let ready = false;
    for (let i = 0; i < 180 && !ready; i++) ready = player.ready(1);
    expect(ready).toBe(true);
    expect(player.grenades?.count).toBe(2);
    expect(player.avatar.group.getObjectByName('Grenade 3')).toBeUndefined();
  });

  it.each(['Pulling pin', 'Throwing'])('drops the grenade when killed during %s, live only after the pin is out', async (phase) => {
    const { world, soldiers: [player] } = await soldiers((scene) => box(scene, [50, 1, 50], [0, -0.5, 0]), ['Player', new Vector3(0, 0.04, 0), true]);
    world.onAfterStep((dt) => player.update(dt));
    for (let i = 0; i < 180; i++) world.update(DT);
    player.throwGrenade();
    for (let i = 0; i < 400 && player.avatar.grenadePhase !== phase; i++) world.update(DT);
    expect(player.avatar.grenadePhase).toBe(phase);
    let blasts = 0;
    player.grenades!.onExplode = () => blasts++;
    player.hurt(100, player.look().eye, new Vector3(0, 0, -1));
    expect(player.grenades?.flying).toBe(1);
    for (let i = 0; i < 240; i++) world.update(DT);
    expect(blasts).toBe(phase === 'Throwing' ? 1 : 0);
    expect(player.grenades?.flying).toBe(0);
  });

  it('attenuates blast damage, respects cover, and pushes nearby physics props', async () => {
    const { world, scene } = await course((scene) => {
      box(scene, [30, 1, 30], [0, -0.5, 0]);
      box(scene, [2, 3, 0.2], [0, 1.5, 1.5]);
    }, { spawn: new Vector3(10, 0, 0) });
    const grenades = new Grenades(world, scene), model = new GrenadeModel(1);
    cleanup(() => grenades.dispose());
    const target = (x: number, z: number) => ({ name: 'Soldier', alive: true, meshes: [], position: new Vector3(x, 0, z), damage: 0,
      hurt(damage: number) { this.damage += damage; } });
    const near = target(2, 0), far = target(5, 0), covered = target(0, 3);
    grenades.targets = [near, far, covered];
    const crate = new RigidBody({ mass: 2 });
    crate.position.set(-2, 0.3, 0);
    crate.add(new SphereCollider({ radius: 0.3 }));
    scene.add(crate, model.object);
    model.object.position.set(0, 0.05, 0);
    grenades.launch(model, { velocity: new Vector3(), spin: new Vector3() }, new Vector3(0, 1, 0));
    world.onAfterStep((dt) => grenades.update(dt));
    for (let i = 0; i < Math.ceil(FUSE / DT) + 1; i++) world.update(DT);
    expect(near.damage).toBeGreaterThan(far.damage);
    expect(far.damage).toBeGreaterThan(0);
    expect(covered.damage).toBe(0);
    expect(crate.getVelocity().linear.x).toBeLessThan(-1);
  });

  it('bounces off a thin wall without tunnelling and detonates only when its fuse expires', async () => {
    const { world, scene } = await course((scene) => {
      box(scene, [30, 1, 30], [0, -0.5, 0]);
      box(scene, [4, 4, 0.02], [0, 2, 1]);
    }, { spawn: new Vector3(10, 0, 0) });
    const grenades = new Grenades(world, scene), model = new GrenadeModel(1);
    cleanup(() => grenades.dispose());
    scene.add(model.object);
    model.object.position.set(0, 1, 0);
    grenades.launch(model, { velocity: new Vector3(0, 1, 25), spin: new Vector3(3, 0, 0) }, new Vector3(0, 1, -0.1));
    world.onAfterStep((dt) => grenades.update(dt));
    const body = model.object.parent;
    if (!(body instanceof RigidBody)) throw new Error('No grenade rigid body');
    let bounced = false, explosions = 0;
    grenades.onExplode = () => explosions++;
    for (let i = 0; i < Math.round(FUSE / DT) - 1; i++) {
      world.update(DT);
      expect(body.position.z).toBeLessThan(1);
      bounced ||= body.getVelocity().linear.z < 0;
      expect(explosions).toBe(0);
    }
    expect(bounced).toBe(true);
    world.update(DT * 2);
    expect(explosions).toBe(1);
    expect(grenades.flying).toBe(0);
    expect(scene.getObjectByName('Grenade blast')).toBeDefined();
    for (let i = 0; i < 80; i++) world.update(DT);
    expect(scene.getObjectByName('Grenade blast')).toBeUndefined();
  });
});
