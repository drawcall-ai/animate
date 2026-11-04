import { clamp, wrapAngle } from '../kernel/math';

/** how much of a gaze shift the eyes take (the head turns the rest: 70–80% of a large shift), and how much of their comfortable range at most */
export const EYES = 0.25;
export const EYES_MOST = 0.3;
/** how slowly the eyes re-centre on their resting share through a gaze shift, or, having absorbed the body's travel under a steady look,
 * once it is still (s, time constant; tuned: a few hundred ms, as the eyes re-centre in the head after the vestibulo-ocular phase —
 * recalled, not checked) */
const RECENTRE = 0.3;
/** how slowly the line of sight may turn with the body's travel for the body to count as still under the look (rad/s; tuned: ~3°/s) */
const STILL = 0.05;

/**
 * How far the eyes look down in the head under one look (rad, + down, within `range`): set at their resting share on a new sight, eased
 * back to it through a gaze shift, and under a look the head has reached absorbing the body's travel (`absorbs`: a gazer that bows to see
 * low down), the head held still as the trunk moves beneath it — re-centring once the body is still, if `recentring` (a look asked for;
 * one borrowed by the hands, or idle, leaves the head where it is).
 */
export class EyePitch {
  value = 0;
  /** the line of sight's pitch in the world the sub-step before (rad, + down) */
  private declination = 0;

  constructor(private readonly range: number, private readonly absorbs: boolean, private readonly recentring: boolean) {}

  /** a new sight along a line pitched `down` in the world, the eyes at rest at `resting` */
  sight(down: number, resting: number): void {
    this.value = resting;
    this.declination = down;
  }

  /**
   * the line pitched `down` in the world, `aimed` as it was to where the target was the sub-step before (the target's own turn the
   * difference), the head still `shifting` to it or not
   */
  step(dt: number, down: number, aimed: number, resting: number, shifting: boolean): void {
    const change = wrapAngle(down - this.declination);
    this.declination = down;
    // (through a gaze shift the line's change from the carried eyes is the head's own turn, not the body's travel)
    if (shifting) return this.recentre(dt, resting);
    if (!this.absorbs) return;
    // (moving, the eyes absorb the body's travel and pursue the target with the usual eye/head share; once the body is still under the
    // look they re-centre, the head taking back what they absorbed: else a look begun as a bow straightens keeps the head up by all of
    // the bow's change)
    const turn = wrapAngle(down - aimed);
    const share = clamp(change - (1 - EYES) * turn, Math.min(EYES * change, change), Math.max(EYES * change, change));
    this.value = clamp(this.value + share, 0, this.range);
    if (this.recentring && Math.abs(change - turn) < STILL * dt) this.recentre(dt, resting);
  }

  private recentre(dt: number, resting: number): void {
    this.value += (resting - this.value) * (1 - Math.exp(-dt / RECENTRE));
  }
}
