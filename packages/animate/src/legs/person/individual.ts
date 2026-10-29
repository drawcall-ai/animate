// How one person walks and stands unlike another of its build: a preferred cadence of its own, its strides varying a little one to the
// next, its arms swinging more or less, its quiet sway stronger or weaker, and how soon it sets off. Seeded per body, as its idle life
// is, so a crowd of the same skeleton neither walks nor stands in step, and a body given a seed is the same every run.
import { irregular, seeded, seedOf } from '../../kernel/random';

/** One person's own way of walking and standing: multipliers on the defaults (1: as tuned), and how long it waits to set off (s). */
export interface Individual {
  /** its preferred cadence at a pace: its strides that much longer or shorter */
  cadence: number;
  /** its cadence a stride at a time `time` s on: `cadence`, varying by `STRIDES` about it */
  cadenceAt(time: number): number;
  /** how far its arms swing walking */
  arms: number;
  /** how much it sways standing */
  sway: number;
  /** how long after a walk is asked it sets off (s) */
  delay: number;
}

/**
 * Read: preferred cadence in 21–40-year-olds 107.7 ± 8.2 steps/min, a spread that includes their heights and own paces (CADENCE-Adults,
 * Tudor-Locke et al. 2019); tuned: at one build and pace, `SPREAD.cadence` of it as a standard deviation. Read: step time varies by
 * under 3% (CV) from one step to the next walking free (Wright et al. 2012, PMC3466237); tuned: `STRIDES`. Recalled: arm swing differs
 * widely between people walking alike (Collins et al. 2009 report it at the shoulder and elbow by subject); tuned: `SPREAD.arms`, as the
 * quiet sway's `SPREAD.sway` (Winter 1995: quiet stance's few millimetres, from person to person). Tuned: up to `SPREAD.delay` s later
 * setting off, within a gait's initiation (recalled: ~0.3–0.6 s of anticipatory shift before the first toe-off).
 */
export function individualOf(seed: number): Individual {
  const random = seeded(seedOf('individual', seed));
  // (about normal: three uniforms summed, held within two standard deviations)
  const normal = () => Math.max(-2, Math.min(2, (random() + random() + random() - 1.5) * 2));
  const cadence = 1 + SPREAD.cadence * normal(), phase = 2 * Math.PI * random();
  return {
    cadence,
    cadenceAt: (time) => cadence * (1 + STRIDES * irregular(time, phase, 0.83, 1.97, 3.11)),
    arms: 1 + SPREAD.arms * normal(),
    sway: 1 + SPREAD.sway * normal(),
    delay: SPREAD.delay * random(),
  };
}

/** the default person, as tuned: no individual difference */
export const TUNED: Individual = { cadence: 1, cadenceAt: () => 1, arms: 1, sway: 1, delay: 0 };

const SPREAD = { cadence: 0.04, arms: 0.15, sway: 0.2, delay: 0.15 };
const STRIDES = 0.02;
