import { PerspectiveCamera, Vector3 } from 'three';
import { expect, it } from 'vitest';
import { INDEX } from '@drawcall/animate';
import { shooter } from '../src/scenarios/shooter';
import { Simulation } from '../src/simulation';
import { PlayerCamera } from '../src/stage/camera';
import { solePoints } from '../../packages/animate/src/humanoid/landmarks';
import { vary } from '../scripts/run';

it.each([0, 1, 2])('keeps both grips, steady sights and final-pose checks clean #%i', (seed) => {
  const scene = shooter();
  const sim = new Simulation(seed ? vary(scene, seed) : scene, undefined, true);
  let grip = 0, sight = 0, sightLine = 0, acquired = Infinity, walking = 0, low = Infinity;
  let steady = 0, lastYaw = 0, lastPitch = 0, lastFire = 0, sightFrames = 0, lastAds = false;
  const camera = new PerspectiveCamera(90, 16 / 9, 0.02, 1000);
  const framing = new PlayerCamera();
  let hipFrames = 0, flight = 0, flightTime = 0, raised = Infinity;
  const flights: number[] = [], landings: { time: number; z: number }[] = [];
  let planted = true;
  while (sim.t < scene.duration) {
    sim.step();
    const h = sim.actors[0];
    const rifle = h.holding.left?.item;
    const player = sim.stage.player;
    if (!player) throw new Error('missing input');
    const input = player.input;
    if (input.aimYaw !== lastYaw || input.aimPitch !== lastPitch || input.ads !== lastAds) steady = sim.t;
    if (input.fire) lastFire = sim.t;
    lastYaw = input.aimYaw;
    lastPitch = input.aimPitch;
    lastAds = input.ads;
    if (!rifle) continue; // Visible acquisition precedes the active grip, never a teleport.
    acquired = Math.min(acquired, sim.t);
    expect(h.holding.right?.item).toBe(rifle);
    expect(h.worn.get(rifle)?.on).toBe(INDEX.rightHand);
    for (const [bone, name] of [[INDEX.leftHand, 'foregrip'], [INDEX.rightHand, 'pistol']] as const) {
      const target = rifle.grips[name].position.clone().applyQuaternion(rifle.current.quaternion).add(rifle.current.position);
      const distance = h.pose.position(bone).distanceTo(target);
      grip = Math.max(grip, distance);
    }
    if (input.ads && sim.t - steady > 0.5 && sim.t - lastFire > 0.5) {
      const wanted = new Vector3(Math.sin(input.aimYaw) * Math.cos(input.aimPitch), Math.sin(input.aimPitch), Math.cos(input.aimYaw) * Math.cos(input.aimPitch));
      sight = Math.max(sight, new Vector3(0, 0, 1).applyQuaternion(rifle.current.quaternion).angleTo(wanted));
      if (h.gait.walk < 0.01) {
        const eye = player.eyes();
        const at = new Vector3(0, 0.12, 0).applyQuaternion(rifle.current.quaternion).add(rifle.current.position).sub(eye);
        sightLine = Math.max(sightLine, at.addScaledVector(wanted, -at.dot(wanted)).length());
      }
      sightFrames++;
    }
    framing.apply(camera, player, 'first', 1 / 60);
    camera.updateMatrixWorld();
    if (input.ads && sim.t > 9 && sim.t < 10) {
      const at = new Vector3(0, 0.12, 0).applyQuaternion(rifle.current.quaternion).add(rifle.current.position).sub(player.eyes());
      if (Math.hypot(at.x, at.y) <= 0.01 && new Vector3(0, 0, 1).applyQuaternion(rifle.current.quaternion).angleTo(new Vector3(0, 0, 1)) < 2 * Math.PI / 180) raised = Math.min(raised, sim.t - 9);
    }
    if (input.ads && sim.t - steady > 0.5 && sim.t - lastFire > 0.5 && h.gait.walk < 0.01) {
      const sight = new Vector3(0, 0.12, 0).applyQuaternion(rifle.current.quaternion).add(rifle.current.position).project(camera);
      expect(Math.hypot(sight.x, sight.y)).toBeLessThan(0.035);
    }
    if (!input.ads && !input.sprint && sim.t - steady > 0.5 && sim.t < 16) {
      const projected = new Vector3(0, 0.06, 0.12).applyQuaternion(rifle.current.quaternion).add(rifle.current.position).project(camera);
      expect(projected.x).toBeGreaterThan(0);
      expect(projected.x).toBeLessThan(1);
      expect(projected.y).toBeLessThan(0);
      expect(projected.y).toBeGreaterThan(-1);
      hipFrames++;
    }
    const contacts = (['left', 'right'] as const).map((side) => Math.min(...solePoints(h, h.pose, side).map((p) => p.y)) <= 0.005);
    if (sim.t > 20 && sim.t < 23) {
      const airborne = contacts.every((contact) => !contact);
      if (airborne) { flight++; flightTime += 1 / 60; }
      else if (flightTime) { flights.push(flightTime); flightTime = 0; }
      if (contacts[0] && !planted) landings.push({ time: sim.t, z: h.pose.position(INDEX.leftFoot).z });
      expect(player.eyes().y - rifle.current.position.y).toBeGreaterThan(0.2);
    }
    planted = contacts[0];
    if (h.gait.velocity.length() > 0.5 && h.gait.velocity.length() < 1.5 && sim.t < 16) {
      walking++;
      low = Math.min(low, h.pose.position(0).y / h.proportions.hipHeight);
    }
  }
  expect(landings.length).toBeGreaterThan(2);
  expect(flights.length).toBeGreaterThan(2);
  const first = landings[0], last = landings[landings.length - 1];
  const stride = (last.z - first.z) / (landings.length - 1);
  const cadence = 120 * (landings.length - 1) / (last.time - first.time);
  console.log('shooter', seed, { grip, sight, sightLine, raised, cadence, stride, flightSeconds: [Math.min(...flights.slice(1)), Math.max(...flights.slice(1))] });
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
    const rifle = h.holding.left?.item;
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
  expect(sim.actors[0].gait.velocity.length()).toBeLessThanOrEqual(0.91);
  expect(sim.actors[0].gait.run).toBe(0);
  expect(sim.actors[0].log).toEqual([]);
});
