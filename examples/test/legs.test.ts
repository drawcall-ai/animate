import { expect, it } from 'vitest';
import { Playback } from '../src/playback';
import { Simulation } from '../src/simulation';
import { legsBiped, legsHorse } from '../src/scenarios/legs';
import type { Stepper } from '@drawcall/animate/rig';

// The legs on scripted roots: a person and two horses (walk, trot) carried along a straight, a bend and a stop by the scene.

it('two horses walk and trot along their scripted roots, every foot down again at the end, the dev log empty', () => {
  const sim = new Simulation(legsHorse(), undefined, true);
  const landings = [0, 0];
  const swinging = [[false, false, false, false], [false, false, false, false]];
  while (sim.t < sim.scenario.duration) {
    sim.step();
    sim.stage.bodies!.forEach((body, b) => (body.stepper as Stepper).legs.forEach((leg, i) => {
      if (swinging[b][i] && !leg.swing) landings[b]++;
      swinging[b][i] = !!leg.swing;
    }));
  }
  for (const count of landings) expect(count).toBeGreaterThan(10);
  expect(sim.stage.done()).toBe(true);
  for (const body of sim.stage.bodies!) expect(body.log).toEqual([]);
});

it('a person steps along a scripted root and stops, the dev log empty', () => {
  const sim = new Simulation(legsBiped(), undefined, true);
  while (sim.t < sim.scenario.duration) sim.step();
  expect(sim.stage.done()).toBe(true);
  expect(sim.actors[0].log).toEqual([]);
});

it('shows a generic body without assuming a humanoid cast', () => {
  const playback = new Playback(new Simulation(legsHorse()));
  playback.advanceTo(4);
  const shown = playback.blend(0.5);
  expect(shown.props.length).toBeGreaterThan(0);
  expect(Number.isFinite(shown.root.z + playback.facing + playback.velocity.length())).toBe(true);
  expect(playback.sim.stage.bodies?.every((b) => b.frame.dev === undefined)).toBe(true);
});

it('legs-biped playback leads along the scripted travel and turn', () => {
  const playback = new Playback(new Simulation(legsBiped()));
  playback.advanceTo(8);
  expect(playback.velocity.length()).toBeGreaterThan(1);
  expect(playback.facing).toBeGreaterThan(0.1);
  expect(playback.facing).toBeCloseTo(playback.sim.actors[0].yaw, 10);
});
