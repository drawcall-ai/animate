import type { Go } from '../../kernel/go';
import type { Poise } from '../../kernel/poise';
import type { PersonLegged } from './legged';
import { Vector3 } from 'three';
import { lerp, smoothstep } from '../../kernel/math';
import { irregular, seeded, seedOf } from '../../kernel/random';
import { Life as Rhythms, type Rhythm } from '../../kernel/life';
import type { Side } from '../../species/humanoid/bones';

/**
 * A person's weight shift standing quiet. Tuned: the first after a 10–20 s observation window; recalled
 * in the research brief: spontaneous shifts roughly every 10–30 s, each held 20–40 s, to the other side
 * each time; tuned: ten quiet seconds after activity before the next.
 */
const WEIGHT: Rhythm = { first: [10, 20], every: [10, 30], hold: [20, 40], quiet: 10, pick: (last, rand) => last === 0 ? (rand() < 0.5 ? 1 : -1) : -last };

/**
 * Recalled (Era et al. 1996, Mononen et al. 2007: marksmen's sway as they aim is a fraction of their quiet stance's; they breathe shallow
 * and fire in its pause); tuned: holding fully still (`steady` 1), breathing and sway keep this share.
 */
const STEADY = 0.3;

/** Tuned: a body's quiet drift runs up to `TEMPO` faster or slower than the tuned one, each component its own (recalled: quiet stance's
 * sway differs from person to person — Winter 1995) */
const TEMPO = 0.25;

/** Quiet stance goals, owned by balance rather than added to a finished pose. */
export class Quiet {
  readonly drift = new Vector3();
  breath = 0;
  private time = 0; private amount = 0; private quietTime = 0;
  private readonly rhythms: Rhythms<'weight'>;
  /** its drift's own frequencies, × the tuned ones */
  private readonly tempo: number[];

  /** `sway`: how strongly it sways, as the person it is (1: as tuned) */
  constructor(seed: number, private readonly sway = 1) {
    this.rhythms = new Rhythms(seed, [['weight', WEIGHT]]);
    const random = seeded(seedOf('quiet', seed));
    this.tempo = [0, 1, 2].map(() => lerp(1 - TEMPO, 1 + TEMPO, random()));
  }

  get onto(): Side | null {
    const weight = this.rhythms.value('weight');
    return weight > 0 ? 'left' : weight < 0 ? 'right' : null;
  }

  quiet(go: Go | null, poise: Poise, person: PersonLegged): boolean {
    return !go && !person.locomotion.moving && !person.holding.left && !person.holding.right && poise.lower === 0 && poise.bow === 0 && poise.steady === 0;
  }

  /** `steady`: how still it holds itself (0 … 1: aiming) */
  update(dt: number, quiet: boolean, speed: number, steady: number) {
    this.time += dt;
    this.quietTime = quiet ? this.quietTime + dt : 0;
    // Tuned: half quiet motion at 0.1 m/s, recovered with a 0.5 s time constant.
    const amount = lerp(1, STEADY, steady) / (1 + speed / 0.1);
    this.amount += (amount - this.amount) * (1 - Math.exp(-2 * dt));
    this.rhythms.update(this.time, dt, quiet);
    const t = this.time, phase = this.rhythms.phase;
    // Seeded smooth drift: incommensurate components, 5–10 mm of quiet CoM travel, at frequencies of this body's own (`tempo`): at one
    // set shared by all, only phased apart, two bodies of a crowd phased alike swayed in step (their moves correlated 0.95)
    const noise = (a: number, b: number, c: number) => irregular(t, phase, a * this.tempo[0], b * this.tempo[1], c * this.tempo[2]);
    this.drift.set(0.007 * noise(0.79, 1.37, 2.11), 0, 0.009 * noise(0.93, 1.61, 2.47)).multiplyScalar(this.amount * this.sway);
    // Recalled: breathing 12–20/min (PMC5973601). Tuned: 1° active, 1.5° after 1–2 s quiet.
    this.breath = Math.sin(2 * Math.PI * 0.25 * t + phase) * (1 + 0.5 * smoothstep(1, 2, this.quietTime)) * Math.PI / 180 * this.amount;
  }
}
