import { afterEach, expect, it, vi } from 'vitest';
import { Scene, Vector3 } from 'three';
import { buildWorld } from '@drawcall/physics-rapier';
import { GRAVITY } from '../src/movement';
import { Playback } from '../src/playback';
import { Soldier } from '../src/soldier';
import { box, cleanup } from './course';

/** a seeded stream of numbers in [0, 1) (mulberry32) */
function random(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
}

afterEach(() => { vi.restoreAllMocks(); });

// (a player's play, as `main.ts` runs it: frames of 8 to 33 ms with hitches up to its 50 ms cap, the world stepping 1/60 s under them and
// the shown body turned to the mouse between; the keys and mouse held a moment, then changed: moving and strafing every way, sprinting,
// crouching, jumping, aiming, firing, the view flicked up to 12 rad/s and swept up and down; R pressed at any moment and an empty rifle
// reloaded — mid-turn, mid-stride, right after a burst, in the air)
it.each([1, 2, 3])('reloads through a player\'s uneven frames and restless input, seed %i', async (seed) => {
  const next = random(seed);
  const warned: string[] = [];
  vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => { warned.push(args.join(' ')); });
  const scene = new Scene();
  box(scene, [60, 1, 60], [0, -0.5, 0]);
  const world = await buildWorld({ scene, gravity: [0, GRAVITY, 0], fixedDelta: 1 / 60, maxSubsteps: 5 });
  cleanup(() => world.dispose());
  const player = new Soldier('Player', world, scene, undefined, new Vector3(0, 0.04, 0), true, () => {});
  cleanup(() => player.dispose());
  const { movement, avatar, combat } = player;
  world.update(world.fixedDelta * 4);
  for (let frame = 0; frame < 180; frame++) player.update(1 / 60);
  const playback = new Playback([avatar.group, player.remains], () => player.look(), world.fixedDelta);
  world.onAfterStep((dt) => playback.step(() => player.update(dt)));
  const held = { seconds: 0, move: new Vector3(), sprint: false, crouch: false, aim: false, trigger: false, turn: 0, sweep: 0 };
  let yaw = 0, pitch = -0.06, longest = 0, since = 0;
  for (let time = 0; time < 30;) {
    const dt = Math.min(next() < 0.02 ? 0.05 + next() * 0.2 : 0.008 + next() * 0.025, 1 / 20);
    time += dt;
    if ((held.seconds -= dt) <= 0) Object.assign(held, {
      seconds: 0.15 + next() * 1.2, move: new Vector3(Math.floor(next() * 3) - 1, 0, Math.floor(next() * 3) - 1).normalize(),
      sprint: next() < 0.3, crouch: next() < 0.15, aim: next() < 0.4, trigger: next() < 0.35,
      turn: (2 * next() - 1) * (next() < 0.3 ? 12 : 3), sweep: (2 * next() - 1) * 2,
    });
    yaw += held.turn * dt;
    pitch = Math.max(-1.35, Math.min(1.35, pitch + held.sweep * dt));
    if (next() < 0.02 || combat.ammo === 0) player.reload();
    // (kept on the floor: heading back to its middle once 20 m out)
    const home = Math.hypot(movement.position.x, movement.position.z) > 20;
    movement.input.move.copy(home ? movement.position.clone().setY(0).negate().normalize() : held.move.clone().applyAxisAngle(UP, yaw));
    movement.input.yaw = yaw;
    player.aim = held.aim;
    movement.input.sprint = held.sprint && !(held.trigger && !avatar.reloading);
    movement.input.crouch = held.crouch;
    movement.input.jump = next() < 0.01;
    player.view.pitch = pitch;
    const before = world.time;
    world.update(dt);
    playback.advance(dt, world.time - before);
    avatar.face(playback.blend(playback.alpha), yaw, pitch);
    const muzzle = avatar.muzzle.getWorldPosition(new Vector3()), direction = avatar.muzzle.getWorldDirection(new Vector3());
    playback.restore();
    if (held.trigger) player.shoot(player.look().eye, muzzle, direction);
    since = avatar.reloading ? since + dt : 0;
    longest = Math.max(longest, since);
  }
  // (every reload seated a full magazine, none given up nor the rifle missed after it, none hanging on: they take 2.5 to 4.5 s here)
  expect(warned.filter((said) => /^The (reload was given up|left hand missed)/.test(said))).toEqual([]);
  expect(avatar.reloads).toBeGreaterThanOrEqual(4);
  expect(longest).toBeLessThan(6);
});

const UP = new Vector3(0, 1, 0);
