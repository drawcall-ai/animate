import { Euler, Vector3 } from 'three';
import { runTimeline } from '@pmndrs/timeline';
import { expect, it } from 'vitest';
import { Body, humanoid, walkTo } from '../../src';
import { INDEX } from '../../src/humanoid/bones';
import { dt, insides, person } from '../bodies';
import { PERSON } from '../skeletons/person';

const DEG = Math.PI / 180;
/** half a step walking at 1.3 m/s (sub-steps: ~0.47 s a step, ~2.1 steps/s) */
const STEP = 15;

/** a person walking 5 m ahead from standing and stopping there: its chest's pitch (rad, + forward) and its ground speed each sub-step */
function walk(leaning: boolean) {
  const species = humanoid(PERSON), body = new Body(leaning ? species : { ...species, inertia: undefined }, { dev: true }), h = insides(body);
  const story = runTimeline(function* () { yield* walkTo(body, new Vector3(0, 0, 5)); });
  const pitch: number[] = [], speed: number[] = [];
  for (let t = 0; t < 8; t += dt) {
    story(undefined, dt);
    body.update(dt);
    pitch.push(new Euler().setFromQuaternion(h.pose.rotation(INDEX.chest), 'YXZ').x);
    speed.push(h.locomotion.velocity.z);
  }
  return { pitch, speed, log: body.log };
}

// (setting off, the trunk leans into the walk's first steps about as far as atan(a / g): ~7° at ~1 m/s² — read: Leteneur et al. 2013,
// PLoS ONE 8:e55256; stopping, it leans back but is held nearly upright — read: Harper et al. 2022, Sports Med 52:2321 — and swings a
// little past upright as it comes to rest; measured against the same walk without the lean)
it('leans into setting off and back from stopping, as far as people do, swings a little past upright and settles', () => {
  const leaning = walk(true), upright = walk(false);
  expect(leaning.log).toEqual([]);
  // (each walk's pitch averaged over a step (±`STEP` sub-steps), so the stride's own nod drops out: the lean shifts the centre of mass, and the
  // legs, keeping it over the feet, step a little off the upright walk's — subtracted frame by frame, the two nods read as ±2° of lean)
  const smooth = (pitch: number[]) => pitch.map((_, i) => { const window = pitch.slice(Math.max(0, i - STEP), i + STEP + 1); return window.reduce((a, b) => a + b, 0) / window.length; });
  const averaged = smooth(upright.pitch);
  const lean = smooth(leaning.pitch).map((x, i) => x - averaged[i]);
  const accel = leaning.speed.map((v, i) => i ? (v - leaning.speed[i - 1]) / dt : 0);
  const stopped = leaning.speed.findIndex((v, i) => i > 60 && v < 1e-3);
  // (setting off at its most; stopping, as it slows over its last second)
  const [starting, stopping] = [Math.max(...accel.slice(0, 120)), leaning.speed[stopped - 60] / 1];
  const ahead = Math.max(...lean.slice(0, 150)), back = Math.min(...lean.slice(stopped - 60, stopped + 30));
  // (setting off: 1.2 m/s² asks 7°; leaning 0.9 of it, felt over a step)
  expect(ahead / Math.atan2(starting, 9.81)).toBeGreaterThan(0.6);
  expect(ahead / Math.atan2(starting, 9.81)).toBeLessThan(1.1);
  expect(ahead / DEG).toBeGreaterThan(4);
  expect(ahead / DEG).toBeLessThan(8);
  // (stopping: back, but nearly upright — a third of it at most)
  expect(back).toBeLessThan(-0.5 * DEG);
  expect(-back / Math.atan2(stopping, 9.81)).toBeLessThan(0.4);
  // (a little past upright once stopped, and settled a second and a half on)
  const past = Math.max(...lean.slice(stopped, stopped + 90));
  expect(past).toBeGreaterThan(0.05 * -back);
  expect(past).toBeLessThan(-back);
  expect(Math.max(...lean.slice(stopped + 90).map(Math.abs))).toBeLessThan(0.3 * DEG);
});

/** a player's body set off to 1.4 m/s at 10 m/s², as a game controller does, walked and stopped as quickly: its trunk's pitch each sub-step (rad, + forward, hips → neck) */
function setOff() {
  const root = { position: new Vector3(), velocity: new Vector3(), yaw: 0 };
  const h = person({ drive: () => root, dev: true });
  const pitch: number[] = [];
  for (let t = dt; t < 6; t += dt) {
    root.velocity.z += Math.max(-10 * dt, Math.min(10 * dt, (t > 1 && t < 3.5 ? 1.4 : 0) - root.velocity.z));
    root.position.addScaledVector(root.velocity, dt);
    h.update(dt);
    const trunk = h.pose.position(INDEX.neck).clone().sub(h.pose.position(INDEX.hips));
    pitch.push(Math.atan2(trunk.z, trunk.y));
  }
  return { pitch, log: h.log };
}

// (the root speeds up and slows down at 10 m/s², quicker than legs can: the trunk leans as a person's setting off at the pace legs give
// — over the first step, ~7° — read: Leteneur et al. 2013: the lean grows from the first knee movement (26%) to heel strike (100%) of a
// 0.96 s initiation, ~10°/s on average; a smooth rise peaks at about twice that, and the walk's own nod adds its ±~15°/s; before, the
// trunk was thrown 3° → 15° at up to 85°/s)
it('a player setting off and stopping quickly leans no quicker nor further than a person does', () => {
  const { pitch, log } = setOff();
  expect(log).toEqual([]);
  const rate = pitch.slice(1).map((x, i) => Math.abs(x - pitch[i]) / dt);
  expect(Math.max(...rate) / DEG).toBeLessThan(40);
  const lean = Math.max(...pitch.slice(60, 150)) - pitch[59];
  expect(lean / DEG).toBeGreaterThan(4);
  expect(lean / DEG).toBeLessThan(12);
});
