import type { Asks } from '../../core/asks';
import type { Humanoid } from '../humanoid';
import { Vector3 } from 'three';
import { smoothstep } from '../../core/math';
import { irregular } from '../../core/random';
import { Life as Rhythms, type Rhythm } from '../../core/life';
import type { Side } from '../bones';

/**
 * A person's weight shift standing quiet. Tuned: the first after a 10–20 s observation window; recalled
 * in the research brief: spontaneous shifts roughly every 10–30 s, each held 20–40 s, to the other side
 * each time; tuned: ten quiet seconds after activity before the next.
 */
const WEIGHT: Rhythm = { first: [10, 20], every: [10, 30], hold: [20, 40], quiet: 10, pick: (last, rand) => last === 0 ? (rand() < 0.5 ? 1 : -1) : -last };

/** Quiet stance goals, owned by balance rather than added to a finished pose. */
export class Life {
  readonly drift = new Vector3();
  breath = 0;
  private time = 0;
  private amount = 0;
  private quietTime = 0;
  private readonly rhythms: Rhythms<'weight'>;

  constructor(seed: number) {
    this.rhythms = new Rhythms(seed, [['weight', WEIGHT]]);
  }

  get onto(): Side | null {
    const weight = this.rhythms.value('weight');
    return weight > 0 ? 'left' : weight < 0 ? 'right' : null;
  }

  quiet(asks: Asks, h: Humanoid): boolean {
    return !asks.go && !h.locomotion.moving && !h.holding.left && !h.holding.right && asks.lower === 0 && asks.bow === 0;
  }

  update(dt: number, quiet: boolean, speed: number) {
    this.time += dt;
    this.quietTime = quiet ? this.quietTime + dt : 0;
    // Tuned: half quiet motion at 0.1 m/s, recovered with a 0.5 s time constant.
    const amount = 1 / (1 + speed / 0.1);
    this.amount += (amount - this.amount) * (1 - Math.exp(-2 * dt));
    this.rhythms.update(this.time, dt, quiet);
    const t = this.time, phase = this.rhythms.phase;
    // Seeded smooth drift: incommensurate components, 5–10 mm of quiet CoM travel.
    const noise = (a: number, b: number, c: number) => irregular(t, phase, a, b, c);
    this.drift.set(0.007 * noise(0.79, 1.37, 2.11), 0, 0.009 * noise(0.93, 1.61, 2.47)).multiplyScalar(this.amount);
    // Recalled: breathing 12–20/min (retained brief, PMC5973601). Tuned: 1° active, 1.5° after 1–2 s quiet.
    this.breath = Math.sin(2 * Math.PI * 0.25 * t + phase) * (1 + 0.5 * smoothstep(1, 2, this.quietTime)) * Math.PI / 180 * this.amount;
  }
}
