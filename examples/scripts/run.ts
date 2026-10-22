import { type LogEntry } from '@drawcall/animate';
import type { CharacterModel } from '@pmndrs/viverse';
import { DEFAULT_HEIGHT } from '../../packages/animate/src/humanoid/proportions';
import type { Role, Scenario } from '../src/scenario';
import { Simulation } from '../src/simulation';

/** Run with in-code checks (the actors `model`'s, default the default body); one extra step lets observers read the last final pose. */
export function run(sc: Scenario, model?: (role: Role) => CharacterModel): LogEntry[] {
  const sim = new Simulation(sc, model, true);
  while (sim.t < sc.duration) sim.step();
  sim.step();
  const extra = sim.stage.bodies?.flatMap((b, i) => b.log.map((entry) => ({ ...entry, where: `body ${i}: ${entry.where}` }))) ?? [];
  if (!sim.stage.done()) extra.push({ time: sim.t, beat: '', check: `${sc.id}: scenario unfinished`, value: 1, limit: 0, where: sim.actors.length ? `actor 0: ${sc.id}` : sc.id });
  return [...extra, ...sim.actors.flatMap((h, i) => h.log.map((entry) => ({ ...entry, where: `actor ${i}: ${entry.where}` })))];
}

/** a seeded variation of `sc`: each actor starting up to 10 cm off, turned up to 0.15 rad and up to 4% taller or shorter — what no script may hang on */
export function vary(sc: Scenario, seed: number): Scenario {
  const random = mulberry32(seed);
  const jitter = (range: number) => (random() * 2 - 1) * range;
  return {
    ...sc,
    actors: sc.actors.map((r) => ({
      position: { x: (r.position?.x ?? 0) + jitter(0.1), z: (r.position?.z ?? 0) + jitter(0.1) },
      yaw: (r.yaw ?? 0) + jitter(0.15),
      height: (r.height ?? DEFAULT_HEIGHT) * (1 + jitter(0.04)),
    })),
  };
}

/** a small seeded generator of uniform numbers in [0, 1) */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 2026-10-15: VR still misses underHead's 3 cm / settled / facing completion condition. */
export function knownFailure(entry: LogEntry): boolean {
  return entry.check === 'vr: scenario unfinished' && entry.where === 'actor 0: vr';
}
