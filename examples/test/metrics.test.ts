// Scenario statistics and task accuracy under small changes. Run: pnpm metrics [-- -t <id>]
import { setImmediate } from 'node:timers/promises';
import { Vector3 } from 'three';
import { afterEach, expect, it, vi } from 'vitest';
import { SCENARIOS } from '../src/scenarios';
import { stroll } from '../src/scenarios/stroll';
import type { Scenario } from '../src/scenario';
import { Simulation } from '../src/simulation';
import { checks, failed, measure, type MetricsOptions } from './metrics';
import { frames } from './frame';
import { GaitKinematics } from './gait';
import { cases } from '../../packages/animate/test/open';

// Whole-scene simulations can occupy a worker for over a minute; let Vitest receive its RPC replies between cases.
afterEach(() => setImmediate());

/** Keep task accuracy, gait and clearance regressions that the runtime checks do not cover. */
function judged(sc: Scenario, strides?: MetricsOptions['strides']) {
  const sim = new Simulation(sc);
  const m = measure(frames(sim));
  const options: MetricsOptions = { startStop: null, strides };
  // Gait coverage and start/stop blending are run-level regressions.
  // (setting off, the trunk leans ~7° forward between the first knee movement and the first heel strike, under a second — read:
  // Leteneur et al. 2013, PLoS ONE 8:e55256 — on top of the stride's own nod; tuned: its pitch up to 1.75× walking's peak, the pelvis's 1.25×)
  if (sc.id === 'stroll') { options.strides ??= { straight: 3, curve: 3 }; options.startStop = { trunk: 1.75, pelvis: 1.25 }; }
  // Hands on what they hold and item clearance; neither has a built-in check. (Tracked targets are judged by their course in
  // `Targets`, not by one fixed margin per scene.)
  if (sc.id === 'stable-morning') options.clearance = 0;
  if (sc.id === 'pickup-shelf') options.wrist = 0.04;
  if (sc.id === 'knight-arming') { options.wrist = 0.03; options.clearance = 0.015; options.strides ??= { straight: 3, curve: 0 }; }
  expect(sim.stage.done(), `${sc.id} finished`).toBe(true);
  const fails = checks(m, options).filter(failed).map((c) => `${c.what}${c.where ? ` (${c.where})` : ''}: ${c.value} (${c.bound} ${c.limit}) @${c.at ?? 0}s`);
  expect(fails, fails.join('\n')).toEqual([]);
}

// VR still misses its controller targets; variation grids are exercised by dev.test.ts.
const check = cases(['vr']);
for (const sc of SCENARIOS.filter((s) => !['legs-biped', 'legs-horse', 'dog-fetch', 'lion-run'].includes(s.id))) {
  check(sc.id, () => judged(sc));
}

// (known too: on a bend the outer foot's steps dip the pelvis 1.5–2 cm lower than straight)
it('stroll: the pelvis bobs on a bend within 1 cm of walking straight', () => {
  const m = measure(frames(new Simulation(stroll())));
  const straight = m.gait.summary(false, false);
  const curve = m.gait.summary(true, false);
  expect(straight && curve).toBeTruthy();
  if (!straight || !curve) throw new Error('no steady strides');
  expect(curve.pelvisUp, 'curve pelvis vertical (m)').toBeLessThanOrEqual(straight.pelvisUp + 0.01);
});

it('judges head roll while looking and outside samples borrowed by hand tasks', () => {
  const free = new GaitKinematics(), looking = new GaitKinematics();
  const borrowed = new GaitKinematics(), mixed = new GaitKinematics();
  let sample = 0;
  for (const [frame] of frames(new Simulation(stroll({ radius: Infinity })))) {
    free.see(frame);
    const owners = vi.spyOn(frame.h.body, 'owners', 'get');
    try {
      owners.mockReturnValue({ hands: {}, look: { verb: 'lookAt', site: '', tier: 'asked' } });
      looking.see({ ...frame, asked: new Map([...frame.asked, ['gaze', new Vector3(0, 0, 1)]]) });
      owners.mockReturnValue({ hands: {}, look: { verb: 'grab', site: '', tier: 'borrowed' } });
      borrowed.see(frame);
      if (sample++ % 2 === 0) owners.mockReturnValue({ hands: {} });
      mixed.see(frame);
    } finally {
      owners.mockRestore();
    }
  }
  const walking = free.summary(false, false), directed = looking.summary(false, false);
  const tasked = borrowed.summary(false, false), partial = mixed.summary(false, false);
  if (!walking || !directed || !tasked || !partial) throw new Error('no steady walking strides');
  expect(Number.isFinite(walking.headRoll)).toBe(true);
  expect(directed.headRoll).toBe(walking.headRoll);
  expect(Number.isNaN(tasked.headRoll)).toBe(true);
  expect(Number.isFinite(partial.headRoll)).toBe(true);
  expect(partial.headRoll).toBeLessThanOrEqual(walking.headRoll);
  expect(tasked.pelvisLat).toBe(walking.pelvisLat);
});
