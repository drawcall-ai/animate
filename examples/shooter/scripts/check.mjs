import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const url = process.env.SHOOTER_URL ?? 'http://localhost:5289';
const captures = process.env.SHOOTER_CAPTURE_DIR;
if (captures) await mkdir(captures, { recursive: true });
// Full Chromium supports pointer lock in headless mode; the headless shell does not.
const browser = await chromium.launch({ channel: process.env.SHOOTER_BROWSER ?? 'chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  // Keep one revision throughout the check when Vite is serving an actively edited workspace.
  await page.routeWebSocket('**', () => {});
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !document.querySelector('#play').disabled, null, { timeout: 120_000 });
  const read = () => page.evaluate(async () => {
    const entry = document.querySelector('script[type="module"][src*="/src/main.ts"]');
    if (!(entry instanceof HTMLScriptElement)) throw new Error('Missing shooter entry module');
    const { game } = await import(entry.src);
    const app = await game;
    if (!app) throw new Error(document.querySelector('#notice').textContent);
    const sight = app.avatar.rifle.getObjectByName('sight');
    if (!sight) throw new Error('Missing rifle sight');
    const eye = app.avatar.look().eye;
    const at = sight.getWorldPosition(eye.clone()).sub(eye);
    const alignment = at.addScaledVector(app.camera.direction, -at.dot(app.camera.direction)).length();
    return {
      position: app.movement.position.toArray(), speed: app.movement.speed, grounded: app.movement.grounded,
      crouched: app.movement.crouched, aim: app.input.aim,
      ammo: app.combat.ammo, reloads: app.avatar.reloads,
      reloading: app.avatar.reloading, fov: app.camera.camera.fov, alignment, time: app.world.time,
      health: app.player.health, opponentHealth: app.opponent.health, enemy: app.enemy.status,
      driver: app.driver.state, climber: app.climber.state, roverSpeed: app.handling.speed, acquired: app.avatar.acquired,
    };
  });
  // (`ms` of wall time: software-rendered Chromium simulates several times slower than real time)
  const until = async (predicate, message, ms = 20_000) => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      const state = await read();
      if (predicate(state)) return state;
      if (errors.length) throw new Error(errors.join('\n'));
      await page.waitForTimeout(100);
    }
    throw new Error(`${message}: ${JSON.stringify(await read())}`);
  };
  const capture = async (name) => { if (captures) await page.screenshot({ path: resolve(captures, name) }); };
  await capture('desktop.png');
  await page.locator('#play').click();
  await page.waitForFunction(() => document.pointerLockElement !== null);
  const initial = await until((state) => state.grounded, 'Player did not settle on ground');
  await capture('first-person.png');

  await page.keyboard.down('w');
  await page.keyboard.down('Shift');
  await until((state) => state.position[2] > initial.position[2] + 2 && state.speed > 3, 'Forward sprint failed');
  await page.keyboard.up('w');
  await page.keyboard.up('Shift');
  await until((state) => state.speed < 0.05, 'Movement did not stop');
  await page.keyboard.down('Space');
  await until((state) => !state.grounded && state.position[1] > 0.3, 'Jump failed');
  await page.keyboard.up('Space');
  await until((state) => state.grounded, 'Player did not land');
  await page.keyboard.down('c');
  await until((state) => state.crouched, 'Crouch failed');
  await page.keyboard.up('c');
  await until((state) => !state.crouched, 'Standing failed');

  await page.mouse.down({ button: 'right' });
  await until((state) => state.aim && state.alignment < 0.002 && state.fov < 70, 'Aiming failed');
  await capture('first-person-aim.png');
  await page.mouse.down();
  await until((state) => state.ammo < 30, 'Firing failed');
  await page.mouse.up();
  await page.mouse.up({ button: 'right' });
  await page.keyboard.press('r');
  await until((state) => state.reloading, 'Reload did not start');
  await until((state) => state.ammo === 30 && state.reloads === 1 && !state.reloading, 'Magazine swap did not complete');

  // Walk to the Land Rover's doorway from a step away, get in, drive off, stop and get out with the rifle back in the hands.
  await page.evaluate(async () => {
    const entry = document.querySelector('script[type="module"][src*="/src/main.ts"]');
    const app = await (await import(entry.src)).game;
    const door = app.rover.marks.door.getWorldPosition(app.player.position.clone());
    app.player.place(door.setX(door.x + 1).setY(door.y + 0.05), app.handling.yaw);
  });
  await page.keyboard.press('e');
  await until((state) => state.driver === 'on', 'Getting into the rover failed', 60_000);
  await capture('driving.png');
  await page.keyboard.down('w');
  await until((state) => state.roverSpeed > 2, 'The rover did not drive off');
  await page.keyboard.up('w');
  await page.keyboard.down('s');
  await until((state) => Math.abs(state.roverSpeed) < 0.3, 'The rover did not brake to a stop');
  await page.keyboard.up('s');
  await page.keyboard.press('e');
  await until((state) => state.driver === 'off' && state.acquired, 'Getting out of the rover failed', 60_000);

  // Walk to the ladder's foot, climb it and step off onto the landing with the rifle back in the hands.
  await page.evaluate(async () => {
    const entry = document.querySelector('script[type="module"][src*="/src/main.ts"]');
    const app = await (await import(entry.src)).game;
    const foot = app.ladder.marks.foot.getWorldPosition(app.player.position.clone());
    app.player.place(foot.setX(foot.x + 1).setY(foot.y + 0.05), 0);
  });
  await page.keyboard.press('e');
  await until((state) => state.climber === 'on', 'Getting on the ladder failed', 60_000);
  await page.keyboard.down('w');
  await until((state) => state.climber === 'off' && state.acquired, 'Climbing the ladder failed', 60_000);
  await page.keyboard.up('w');
  await capture('ladder.png');
  assert.ok((await read()).position[1] > 2.2, 'The climber must step off onto the landing');

  await page.keyboard.press('Backspace');
  await until((state) => Math.abs(state.position[2] - initial.position[2]) < 0.1 && state.reloads === 0 && state.ammo === 30, 'Reset failed');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.pointerLockElement === null);
  const paused = await read();
  await page.waitForTimeout(300);
  assert.equal((await read()).time, paused.time, 'Physics must pause with the controls overlay');
  await page.setViewportSize({ width: 390, height: 844 });
  await capture('mobile.png');
  assert.deepEqual(errors, [], 'Browser errors');
  console.log('Browser checks passed: first-person sprint, jump, crouch, aiming, firing, animated reload, driving, climbing, reset, pause.');
} finally {
  await browser.close();
}
