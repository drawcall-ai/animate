import { Vector3 } from 'three';
import { lerp } from '../../core/math';
import { seeded } from '../../core/random';
import type { Side } from '../bones';

/** Quiet stance goals, owned by balance rather than added to a finished pose. */
export class Life {
  readonly drift = new Vector3();
  breath = 0;
  onto: Side | null = null;
  private time = 0;
  private amount = 0;
  private next: number;
  private until = 0;
  private readonly phase: number;
  private readonly rand: () => number;

  constructor(seed: number) {
    this.rand = seeded(seed);
    this.phase = this.rand() * 2 * Math.PI;
    this.next = lerp(10, 20, this.rand());
  }

  update(dt: number, quiet: boolean, speed: number) {
    this.time += dt;
    const amount = 1 / (1 + speed / 0.1);
    this.amount += (amount - this.amount) * (1 - Math.exp(-2 * dt));
    if (!quiet) {
      this.next = this.time + 10;
      this.until = 0;
    }
    if (quiet && this.time >= this.next) {
      this.onto = this.rand() < 0.5 ? 'left' : 'right';
      this.until = this.time + lerp(20, 40, this.rand());
      // Recalled in the research brief: spontaneous shifts roughly every 10–30 s.
      this.next = this.until + lerp(10, 30, this.rand());
    }
    if (this.time >= this.until) this.onto = null;
    const t = this.time;
    // Seeded smooth drift: incommensurate components, 5–10 mm of quiet CoM travel.
    const noise = (a: number, b: number, c: number) => (Math.sin(a * t + this.phase) + 0.5 * Math.sin(b * t + 2 * this.phase) + 0.25 * Math.sin(c * t + 3 * this.phase)) / 1.75;
    this.drift.set(0.007 * noise(0.79, 1.37, 2.11), 0, 0.009 * noise(0.93, 1.61, 2.47)).multiplyScalar(this.amount);
    // Read in the brief: breathing 12–20/min (PMC5973601); 1° pitch is a recalled animation amplitude.
    this.breath = Math.sin(2 * Math.PI * 0.25 * t + this.phase) * Math.PI / 180 * this.amount;
  }
}
