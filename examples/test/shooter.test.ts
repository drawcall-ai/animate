import { Vector3 } from 'three';
import { expect, it } from 'vitest';
import { INDEX } from '@drawcall/animate';
import { shooter } from '../src/scenarios/shooter';
import { Simulation } from '../src/simulation';
import { vary } from '../scripts/run';

it.each([0, 1, 2])('keeps both grips, steady sights and final-pose checks clean #%i', (seed) => {
  const scene = shooter();
  const sim = new Simulation(seed ? vary(scene, seed) : scene, undefined, true);
  let grip = 0, sight = 0, sightLine = 0, acquired = Infinity, walking = 0, low = Infinity;
  let steady = 0, lastYaw = 0, lastPitch = 0, lastFire = 0, sightFrames = 0;
  while (sim.t < scene.duration) {
    sim.step();
    const h = sim.actors[0];
    const rifle = h.holding.left?.item;
    const player = sim.stage.player;
    if (!player) throw new Error('missing input');
    const input = player.input;
    if (input.aimYaw !== lastYaw || input.aimPitch !== lastPitch) steady = sim.t;
    if (input.fire) lastFire = sim.t;
    lastYaw = input.aimYaw;
    lastPitch = input.aimPitch;
    if (!rifle) continue; // Visible acquisition precedes the active grip, never a teleport.
    acquired = Math.min(acquired, sim.t);
    expect(h.holding.right?.item).toBe(rifle);
    expect(h.worn.get(rifle)?.on).toBe(INDEX.rightHand);
    for (const [bone, name] of [[INDEX.leftHand, 'foregrip'], [INDEX.rightHand, 'pistol']] as const) {
      const target = rifle.grips[name].position.clone().applyQuaternion(rifle.current.quaternion).add(rifle.current.position);
      grip = Math.max(grip, h.pose.position(bone).distanceTo(target));
    }
    if (sim.t - steady > 0.5 && sim.t - lastFire > 0.5) {
      const wanted = new Vector3(Math.sin(input.aimYaw) * Math.cos(input.aimPitch), Math.sin(input.aimPitch), Math.cos(input.aimYaw) * Math.cos(input.aimPitch));
      sight = Math.max(sight, new Vector3(0, 0, 1).applyQuaternion(rifle.current.quaternion).angleTo(wanted));
      if (h.gait.walk < 0.01) {
        const eye = player.eyes();
        const at = new Vector3(0, 0.12, 0).applyQuaternion(rifle.current.quaternion).add(rifle.current.position).sub(eye);
        sightLine = Math.max(sightLine, at.addScaledVector(wanted, -at.dot(wanted)).length());
      }
      sightFrames++;
    }
    if (h.gait.velocity.length() > 0.5) {
      walking++;
      low = Math.min(low, h.pose.position(0).y / h.proportions.hipHeight);
    }
  }
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
