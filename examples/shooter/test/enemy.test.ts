import { expect, it } from 'vitest';
import { Vector3 } from 'three';
import { wrapAngle } from '../src/angles';
import { Enemy } from '../src/enemy';
import { visible } from '../src/enemy/cover';
import { Navigation } from '../src/nav';
import { box, DT, soldiers } from './course';

it('uses cover, a physical sprint, peeking bursts, retreat and a completed magazine reload', async () => {
  const { world, soldiers: [player, soldier] } = await soldiers((scene) => {
    box(scene, [32, 1, 32], [0, -0.5, 0], 'static', 'Ground');
    box(scene, [2.8, 1.8, 0.8], [-4, 0.9, 6], 'static', 'Cover');
    box(scene, [2.8, 1.45, 0.8], [4, 0.725, 3], 'static', 'Cover');
  }, ['Player', new Vector3(0, 0.04, -8), true], ['Opponent', new Vector3(0, 0.04, 8), false]);
  const enemy = new Enemy(soldier, player, new Navigation(world), world);
  soldier.reset(undefined, Math.PI);
  for (let frame = 0; frame < 4; frame++) world.update(DT);
  for (let frame = 0; frame < 180; frame++) { player.update(DT); soldier.update(DT); }
  // (its magazine all but spent, so the first burst it fires has it reload once back in cover)
  soldier.combat.ammo = 9;
  const states = new Set<string>();
  let speed = 0, crouchedInCover = false, hidden = false, fired = false;
  world.onAfterStep(dt => {
    player.update(dt);
    soldier.update(dt);
    const ammo = soldier.combat.ammo;
    enemy.update(dt);
    if (soldier.combat.ammo < ammo) {
      fired = true;
      const target = player.avatar.body.bones.chest.getWorldPosition(new Vector3());
      expect(visible(world, soldier.avatar.muzzle.getWorldPosition(new Vector3()), target)).toBe(true);
    }
    states.add(enemy.state);
    speed = Math.max(speed, soldier.movement.speed);
    if (enemy.state === 'hide' || enemy.state === 'reload') {
      crouchedInCover ||= soldier.movement.crouched;
      hidden ||= !visible(world, soldier.avatar.look().eye, player.avatar.look().eye);
    }
  });
  const expected = ['move', 'hide', 'reload', 'peek', 'burst', 'retreat'];
  const done = () => expected.every((state) => states.has(state)) && soldier.avatar.reloads > 0;
  for (let frame = 0; frame < 40 * 60 && !done(); frame++) world.update(DT);
  expect([...states]).toEqual(expect.arrayContaining(expected));
  expect(speed).toBeGreaterThan(3);
  expect(crouchedInCover).toBe(true);
  expect(hidden).toBe(true);
  expect(soldier.avatar.reloads).toBeGreaterThan(0);
  expect(fired).toBe(true);
});

it('tracks a player it sees every step, not only when it senses', async () => {
  const { world, soldiers: [player, soldier] } = await soldiers((scene) => {
    box(scene, [60, 1, 60], [0, -0.5, 0], 'static', 'Ground');
  }, ['Player', new Vector3(-6, 0.04, -8), true], ['Opponent', new Vector3(0, 0.04, 8), false]);
  const enemy = new Enemy(soldier, player, new Navigation(world), world);
  soldier.reset(undefined, Math.PI);
  for (let frame = 0; frame < 4; frame++) world.update(DT);
  for (let frame = 0; frame < 180; frame++) { player.update(DT); soldier.update(DT); }
  player.combat.damage = soldier.combat.damage = 0;
  const yaws: number[] = [], states: string[] = [];
  world.onAfterStep(dt => {
    player.update(dt); soldier.update(dt); enemy.update(dt);
    // The player fires at 600 rpm, and the enemy hears each shot (as main.ts tells it).
    if (yaws.length % 6 === 0) enemy.hear(player.position);
    yaws.push(soldier.movement.input.yaw);
    states.push(enemy.state);
  });
  // The player strafes across its view, one way and back, firing.
  for (let frame = 0; frame < 600; frame++) {
    player.movement.input.move.set(Math.floor(frame / 150) % 2 ? 1 : -1, 0, 0);
    world.update(DT);
  }
  // How abruptly its aim changes pace from step to step while it aims at the player.
  const kinks: number[] = [];
  for (let i = 2; i < yaws.length; i++) {
    if (states[i] !== states[i - 2] || states[i] === 'move' || states[i] === 'search') continue;
    kinks.push(Math.abs(wrapAngle(yaws[i] - yaws[i - 1]) - wrapAngle(yaws[i - 1] - yaws[i - 2])));
  }
  kinks.sort((a, b) => a - b);
  expect(kinks.length).toBeGreaterThan(200);
  expect(kinks[Math.floor(kinks.length * 0.95)]).toBeLessThan(0.005);
});
