import { PerspectiveCamera, Vector3 } from 'three';
import { expect, it } from 'vitest';
import { INDEX } from '@drawcall/animate';
import { shooter } from '../src/scenarios/shooter';
import { Simulation } from '../src/simulation';
import { PlayerCamera } from '../src/stage/camera';
import { solePoints } from '../../packages/animate/src/humanoid/landmarks';
import { vary } from '../scripts/run';
import { wrapAngle } from '../src/math';

it.each([0, 1, 2])('keeps both grips, steady sights and final-pose checks clean #%i', (seed) => {
  const scene = shooter();
  const sim = new Simulation(seed ? vary(scene, seed) : scene, undefined, true);
  let grip = 0, sight = 0, sightLine = 0, acquired = Infinity, walking = 0, low = Infinity;
  let steady = 0, lastYaw = 0, lastPitch = 0, lastFire = 0, sightFrames = 0, lastAds = false;
  const camera = new PerspectiveCamera(90, 16 / 9, 0.02, 1000);
  const framing = new PlayerCamera();
  let hipFrames = 0, flight = 0, flightTime = 0, raised = Infinity, lag = 0, facing = 0, heading = 0, moved = 0, lastMove = '';
  const flights: number[] = [], landings: { time: number; z: number }[] = [];
  let planted = true;
  while (sim.t < scene.duration) {
    sim.step();
    const h = sim.actors[0];
    const rifle = h.holding.right?.item;
    const player = sim.stage.player;
    if (!player) throw new Error('missing input');
    const input = player.input;
    if (input.aimYaw !== lastYaw || input.aimPitch !== lastPitch || input.ads !== lastAds) steady = sim.t;
    if (input.fire) lastFire = sim.t;
    lastYaw = input.aimYaw;
    lastPitch = input.aimPitch;
    lastAds = input.ads;
    // The player owns the root: the body is where the controller puts it, facing where it looks.
    const root = player.root;
    if (!root) throw new Error('missing root');
    lag = Math.max(lag, Math.hypot(h.pose.position(0).x - root.position.x, h.pose.position(0).z - root.position.z));
    const speed = h.locomotion.velocity.length();
    if (`${input.move.x},${input.move.z},${input.sprint},${input.ads}` !== lastMove) [moved, lastMove] = [sim.t, `${input.move.x},${input.move.z},${input.sprint},${input.ads}`];
    // (once the speed has settled after a change of keys: 10 m/s² takes at most 0.5 s)
    if (speed > 0.5 && sim.t - moved > 0.5) {
      facing = Math.max(facing, Math.abs(wrapAngle(h.locomotion.facing - input.aimYaw)));
      const local = Math.atan2(h.locomotion.velocity.x, h.locomotion.velocity.z) - input.aimYaw;
      const asked = Math.atan2(input.move.x, input.move.z);
      if (input.move.x || input.move.z) heading = Math.max(heading, Math.abs(wrapAngle(local - asked)));
    }
    // Visible acquisition precedes the active grip, never a teleport.
    if (!rifle) continue;
    if (acquired === Infinity && h.holding.left?.item !== rifle) continue;
    acquired = Math.min(acquired, sim.t);
    expect(h.worn.get(rifle)?.on).toBe(INDEX.rightHand);
    // (each hand on whatever grip it holds: the support hand's off the handguard only through a reload)
    for (const side of ['left', 'right'] as const) {
      const held = h.holding[side];
      if (!held) continue;
      const target = held.item.grips[held.grip].position.clone().applyQuaternion(held.item.current.quaternion).add(held.item.current.position);
      grip = Math.max(grip, h.pose.position(INDEX[`${side}Hand`]).distanceTo(target));
    }
    if (input.ads && sim.t - steady > 0.5 && sim.t - lastFire > 0.5) {
      const wanted = new Vector3(Math.sin(input.aimYaw) * Math.cos(input.aimPitch), Math.sin(input.aimPitch), Math.cos(input.aimYaw) * Math.cos(input.aimPitch));
      sight = Math.max(sight, new Vector3(0, 0, 1).applyQuaternion(rifle.current.quaternion).angleTo(wanted));
      if (h.locomotion.walk < 0.01) {
        const eye = player.eyes();
        const at = new Vector3(0, 0.12, 0).applyQuaternion(rifle.current.quaternion).add(rifle.current.position).sub(eye);
        sightLine = Math.max(sightLine, at.addScaledVector(wanted, -at.dot(wanted)).length());
      }
      sightFrames++;
    }
    framing.apply(camera, player, 'first', 1 / 60);
    camera.updateMatrixWorld();
    if (input.ads && sim.t > 13 && sim.t < 14) {
      const at = new Vector3(0, 0.12, 0).applyQuaternion(rifle.current.quaternion).add(rifle.current.position).sub(player.eyes());
      if (Math.hypot(at.x, at.y) <= 0.01 && new Vector3(0, 0, 1).applyQuaternion(rifle.current.quaternion).angleTo(new Vector3(0, 0, 1)) < 2 * Math.PI / 180) raised = Math.min(raised, sim.t - 13);
    }
    if (input.ads && sim.t - steady > 0.5 && sim.t - lastFire > 0.5 && h.locomotion.walk < 0.01) {
      const sight = new Vector3(0, 0.12, 0).applyQuaternion(rifle.current.quaternion).add(rifle.current.position).project(camera);
      expect(Math.hypot(sight.x, sight.y)).toBeLessThan(0.035);
    }
    if (!input.ads && !input.sprint && sim.t - steady > 0.5 && sim.t < 13) {
      const projected = new Vector3(0, 0.06, 0.12).applyQuaternion(rifle.current.quaternion).add(rifle.current.position).project(camera);
      expect(projected.x).toBeGreaterThan(0);
      expect(projected.x).toBeLessThan(1);
      expect(projected.y).toBeLessThan(0);
      expect(projected.y).toBeGreaterThan(-1);
      hipFrames++;
    }
    // (on the floor: pushing off on the ball — not a sole point — the toe tips stand up to ~8 mm off it)
    const contacts = (['left', 'right'] as const).map((side) => Math.min(...solePoints(h, h.pose, side).map((p) => p.y)) <= 0.01);
    if (sim.t > 20 && sim.t < 23) {
      const airborne = contacts.every((contact) => !contact);
      if (airborne) { flight++; flightTime += 1 / 60; }
      else if (flightTime) { flights.push(flightTime); flightTime = 0; }
      if (contacts[0] && !planted) landings.push({ time: sim.t, z: h.pose.position(INDEX.leftFoot).z });
      expect(player.eyes().y - rifle.current.position.y).toBeGreaterThan(0.2);
    }
    planted = contacts[0];
    if (h.locomotion.velocity.length() > 0.5 && h.locomotion.velocity.length() < 1.5 && sim.t < 16) {
      walking++;
      // (walking upright: steady walking, not the moment of a reversal)
      if (sim.t - moved > 0.5) low = Math.min(low, h.pose.position(0).y / h.proportions.hipHeight);
    }
  }
  expect(landings.length).toBeGreaterThan(2);
  expect(flights.length).toBeGreaterThan(2);
  const first = landings[0], last = landings[landings.length - 1];
  const stride = (last.z - first.z) / (landings.length - 1);
  const cadence = 120 * (landings.length - 1) / (last.time - first.time);
  console.log('shooter', seed, { grip, sight, sightLine, raised, cadence, stride, flightSeconds: [Math.min(...flights.slice(1)), Math.max(...flights.slice(1))], lag, facing, heading, low,
    xcom: Math.max(0, ...sim.actors[0].notes.map((note) => note.value)) });
  expect(lag).toBe(0);
  // (the facing eases toward the look over 25 ms; turning harder than the feet can follow, the trunk takes the rest)
  expect(facing).toBeLessThan(0.1);
  expect(heading).toBeLessThan(0.15);
  expect(raised).toBeLessThanOrEqual(0.3);
  expect(cadence).toBeGreaterThan(150);
  expect(stride).toBeGreaterThan(2);
  expect(hipFrames).toBeGreaterThan(120);
  expect(flight).toBeGreaterThan(0);
  expect(acquired).toBeLessThan(3);
  expect(grip).toBeLessThanOrEqual(0.01);
  expect(sight).toBeLessThanOrEqual(2 * Math.PI / 180);
  expect(sightLine).toBeLessThanOrEqual(0.01);
  expect(sightFrames).toBeGreaterThan(120);
  expect(walking).toBeGreaterThan(300);
  expect(low).toBeGreaterThan(0.9);
  expect(sim.actors[0].log).toEqual([]);
  // A driven body follows its player, not its balance: the XCoM bound is only noted.
  expect(sim.actors[0].notes.every((note) => note.check === 'driven XCoM outside support (m)')).toBe(true);
  expect(sim.stage.done()).toBe(true);
});

it('switches view without changing any body motion', () => {
  const a = new Simulation(shooter());
  const b = new Simulation(shooter());
  const move = b.stage.move;
  b.stage.move = (t) => {
    move?.(t);
    const player = b.stage.player;
    if (!player) throw new Error('missing player');
    player.input.view = Math.floor(t * 3) % 2 ? 'first' : 'third';
  };
  let difference = 0;
  while (a.t < a.scenario.duration) {
    a.step();
    b.step();
    const p = a.actors[0].pose, q = b.actors[0].pose;
    for (let bone = 0; bone < p.skeleton.bones.length; bone++) {
      difference = Math.max(difference, p.position(bone).distanceTo(q.position(bone)));
      expect(p.local(bone).equals(q.local(bone))).toBe(true);
    }
  }
  expect(difference).toBe(0);
  expect(a.stage.done() && b.stage.done()).toBe(true);
});

it('ADS overrides held sprint and keeps both grips during the raise', () => {
  const sim = new Simulation(shooter(), undefined, true);
  sim.advanceTo(21);
  const player = sim.stage.player;
  if (!player) throw new Error('missing player');
  player.live = true;
  player.input.ads = true;
  player.input.sprint = true;
  player.input.move.z = 1;
  player.input.aimYaw = 0.3;
  player.input.aimPitch = 0.15;
  const camera = new PerspectiveCamera(90, 16 / 9, 0.02, 1000);
  const framing = new PlayerCamera();
  while (sim.t < 24) {
    sim.step();
    const h = sim.actors[0];
    const rifle = h.holding.right?.item;
    if (!rifle) throw new Error('missing rifle');
    framing.apply(camera, player, 'first', 1 / 60);
    camera.updateMatrixWorld();
    if (sim.t > 23) {
      const at = new Vector3(0, 0.12, 0).applyQuaternion(rifle.current.quaternion).add(rifle.current.position).project(camera);
      expect(Math.hypot(at.x, at.y)).toBeLessThanOrEqual(0.035);
    }
    for (const [bone, name] of [[INDEX.leftHand, 'foregrip'], [INDEX.rightHand, 'pistol']] as const) {
      const target = rifle.grips[name].position.clone().applyQuaternion(rifle.current.quaternion).add(rifle.current.position);
      expect(h.pose.position(bone).distanceTo(target)).toBeLessThanOrEqual(0.01);
    }
  }
  expect(sim.actors[0].locomotion.velocity.length()).toBeLessThanOrEqual(0.91);
  expect(sim.actors[0].locomotion.run).toBe(0);
  expect(sim.actors[0].log).toEqual([]);
});

/** The demo, sampled each sub-step. */
function demo() {
  const sim = new Simulation(shooter(), undefined, true);
  const frames: { t: number; jump: boolean; reload: boolean; crouch: number; airborne: boolean; speed: number; pelvis: number; soles: number[]; steps: number; reloading: boolean; held: number }[] = [];
  while (sim.t < sim.scenario.duration) {
    sim.step();
    const h = sim.actors[0], player = sim.stage.player!, root = player.root!, status = player.status!();
    let held = 0;
    for (const side of ['left', 'right'] as const) {
      const grip = h.holding[side];
      if (grip) held = Math.max(held, h.pose.position(INDEX[`${side}Hand`]).distanceTo(grip.item.grips[grip.grip].position.clone().applyQuaternion(grip.item.current.quaternion).add(grip.item.current.position)));
    }
    frames.push({ t: sim.t, jump: player.input.jump, reload: player.input.reload, crouch: root.crouch ?? 0, airborne: !!root.airborne, speed: Math.hypot(root.velocity.x, root.velocity.z),
      pelvis: h.pose.position(0).y, soles: (['left', 'right'] as const).map((side) => Math.min(...solePoints(h, h.pose, side).map((p) => p.y))),
      steps: status.steps.length, reloading: status.reloading, held });
  }
  return { sim, frames, steps: sim.stage.player!.status!().steps };
}
const recorded = demo();

it('crouches smoothly, deep and slow', () => {
  const { frames } = recorded;
  const standing = frames.find((f) => f.t > 2)!.pelvis;
  const deep = frames.filter((f) => f.crouch === 1);
  const walking = deep.filter((f) => f.speed > 0.1);
  const depth = standing - Math.max(...deep.filter((f) => f.speed < 0.01).map((f) => f.pelvis));
  // (the pelvis' acceleration getting down and up again, standing and crouch-walking: a 0.25 s minimum-jerk
  // crouch peaks at 5.77 × 0.37 m / 0.25² s ≈ 34 m/s², the steps' own less)
  let jerk = 0;
  for (let i = 2; i < frames.length; i++) if (frames[i].t > 35 && frames[i].t < 41) jerk = Math.max(jerk, Math.abs(frames[i].pelvis - 2 * frames[i - 1].pelvis + frames[i - 2].pelvis) * 3600);
  console.log('crouch', { depth, speed: Math.max(...walking.map((f) => f.speed)), accel: jerk });
  expect(depth).toBeGreaterThan(0.33);
  expect(depth).toBeLessThan(0.42);
  expect(Math.max(...walking.map((f) => f.speed))).toBeLessThanOrEqual(0.8 + 1e-9);
  expect(walking.length).toBeGreaterThan(60);
  expect(jerk).toBeLessThan(36);
});

it('jumps from a walk and a sprint: quick take-off, a ballistic arc, momentum kept, the knees taking the landing', () => {
  const { frames, sim } = recorded;
  const presses = frames.filter((f, i) => f.jump && !frames[i - 1].jump);
  expect(presses.length).toBe(2);
  for (const press of presses) {
    const from = frames.indexOf(press), height = frames[from - 1].pelvis;
    const off = frames.findIndex((f, i) => i >= from && f.airborne);
    const down = frames.findIndex((f, i) => i > off && !f.airborne);
    const after = frames.slice(down, down + 60);
    const latency = frames[off].t - press.t + 1 / 60, airtime = frames[down].t - frames[off].t;
    const apex = Math.max(...frames.slice(off, down).map((f) => f.pelvis)) - height;
    const absorb = Math.min(...after.map((f) => f.pelvis)) - height;
    // (up again: within the steps' own bob of where it was)
    const recovered = after.findIndex((f, i) => i > 5 && Math.abs(f.pelvis - height) < 0.03) / 60;
    const fall = (frames[down - 2].pelvis - frames[down - 1].pelvis) * 60;
    // (the feet's sole speed as each first meets the floor: the one exception to the touchdown limit, a jump's
    // landing, where the feet come down with the falling body — slower than it — and the knees take it up after)
    const touchdown = [0, 1].map((side) => {
      const i = frames.findIndex((f, j) => j > off && f.soles[side] <= 0.005);
      return (frames[i - 1].soles[side] - frames[i].soles[side]) * 60;
    });
    console.log('jump', press.t.toFixed(2), { latency, airtime, apex, absorb, recovered, touchdown, fall, speed: [press.speed, frames[down].speed] });
    expect(latency).toBeLessThanOrEqual(0.12);
    expect(airtime).toBeGreaterThan(0.4);
    expect(airtime).toBeLessThan(0.6);
    expect(apex).toBeGreaterThan(0.25);
    expect(absorb).toBeLessThan(-0.04);
    expect(absorb).toBeGreaterThan(-0.25);
    expect(recovered).toBeGreaterThan(0);
    expect(recovered).toBeLessThanOrEqual(0.6);
    expect(Math.max(...touchdown)).toBeLessThan(fall);
    // (in the air the keys only steer a little: the speed taken off with is kept)
    expect(frames[down].speed).toBeGreaterThan(press.speed - 2 * airtime - 0.05);
  }
  expect(presses[1].speed).toBeGreaterThan(3);
  // Slides, touchdown speeds and knee snaps are each checked in the code: the dev log stays clean.
  expect(sim.actors[0].log).toEqual([]);
});

it('reloads while walking: magazine out, stowed, the full one in, back on the handguard, every grip kept', () => {
  const { frames, steps, sim } = recorded;
  expect(steps).toEqual(['to magazine', 'out', 'stow', 'to pouch', 'insert', 'handguard']);
  const press = frames.find((f) => f.reload)!;
  const begun = frames.find((f) => f.reloading)!, ended = frames.find((f) => f.t > begun.t && !f.reloading)!;
  const moving = frames.filter((f) => f.reloading).every((f) => f.speed > 1);
  console.log('reload', { start: begun.t - press.t, seconds: ended.t - begun.t, held: Math.max(...frames.map((f) => f.held)) });
  expect(begun.t - press.t).toBeLessThan(0.05);
  expect(ended.t - begun.t).toBeGreaterThan(1.8);
  expect(ended.t - begun.t).toBeLessThan(2.8);
  expect(moving).toBe(true);
  expect(Math.max(...frames.map((f) => f.held))).toBeLessThanOrEqual(0.01);
  expect(sim.actors[0].log).toEqual([]);
});

it('sprinting cancels a reload before the magazine is out, and the hand goes back to the handguard', () => {
  const sim = new Simulation(shooter(), undefined, true);
  sim.advanceTo(30);
  const player = sim.stage.player!;
  player.live = true;
  Object.assign(player.input, { move: { x: 0, z: 1 }, reload: true, ads: false, sprint: false, fire: false, crouch: false, jump: false });
  sim.advanceTo(30.1);
  player.input.reload = false;
  player.input.sprint = true;
  sim.advanceTo(32);
  const h = sim.actors[0];
  expect(player.status!().steps).toEqual(['to magazine', 'cancelled']);
  expect(h.holding.left?.grip).toBe('foregrip');
  expect(h.locomotion.run).toBeGreaterThan(0.5);
  expect(h.log).toEqual([]);
});
