// A person's weight on a seat: its feet planted where they stand, its hips carried off them onto the surface and back.
import { MathUtils, Vector3 } from 'three';
import type { Go } from '../../kernel/go';
import type { Miss } from '../../kernel/requests';
import { forwardOf, minimumJerk } from '../../kernel/math';
import { OVER_ANKLES, standingFeet } from '../../species/humanoid/stance';
import { footprint } from './foot';
import { squatOf } from './posture';
import { levelUnder } from '../floor';
import type { PersonLegged } from './legged';

/** Tuned (× the thigh): the ankles stand this far ahead of the hips seated, nearer than under the knee. Recalled: feet drawn back ease rising (Janssen et al. 2002) */
const FEET = 0.62;
/** Recalled: the hip joint rests ~9 cm over the surface, on the sit bones (m, default body) */
const HIPS_ABOVE = 0.09;
/** Tuned: the hips go at this speed at most (m/s), taking `QUICKEST` s at the least; a sit of ~1.5 s. Recalled: 1.5–2.5 s (Janssen et al. 2002) */
const PACE = 0.5, QUICKEST = 1.2;
/** Tuned (rad): the trunk bows this far as the weight goes over, and the phase's skew that has it still bowed as the hips touch */
const BOW = 1, LATE = 1.8;
/** Tuned: the hips bear on the seat from this high over their rest (m, default body), over a surface this far either way (m, default body) */
const TOUCH = 0.05, SURFACE = 0.15;
/** Tuned (rad): the arms seated, the hands lying on the thighs (`ArmPosture`) */
const LAP = { forward: 0.2, elbow: 0.8, out: -0.2 };
/** Tuned: no higher than the legs reach this share of their length, feet flat */
const REACHES = 0.97;

/** Where a person sits on a seat: its hips (world), where it stands to sit (the floor), how far its hips go down (m). */
export interface Seating { hips: Vector3; stand: Vector3; lower: number; seconds: number }

/** How `person` sits on the surface at `at` facing `yaw`, or what stops it: the seat too high or too low for its legs, or no level floor for its feet. */
export function seating(person: PersonLegged, at: Readonly<Vector3>, yaw: number): Seating | Miss {
  const p = person.proportions, s = p.scale, ahead = FEET * p.thigh;
  const stand = forwardOf(yaw).multiplyScalar(ahead + OVER_ANKLES * s).add(at).setY(0);
  const feet = forwardOf(yaw).multiplyScalar(-OVER_ANKLES * s).add(stand), floor = person.floor(feet.x, feet.z);
  if (levelUnder(person.floor, standingFeet(p, feet.x, feet.z, yaw).flatMap((foot) => footprint(p, foot.position, foot.yaw))) === null) return { where: 'seat', off: Infinity, limit: 0, why: 'no room for its feet: no level floor before the seat' };
  const height = at.y + HIPS_ABOVE * s - floor, leg = Math.hypot(ahead, height - p.ankleHeight), most = REACHES * p.legLength;
  if (leg > most) return { where: 'seat', off: leg - most, limit: 0, why: `out of reach, ${(at.y - floor).toFixed(2)} m over the floor: its legs reach ${(leg - most).toFixed(2)} m short with its feet flat` };
  // (from its standing height, however it stands now: already seated or crouched, a sit's way down is the balance's to carry from where it is)
  const lower = p.hipHeight - height, deepest = squatOf(p);
  if (lower > deepest) return { where: 'seat', off: lower - deepest, limit: 0, why: `too low, ${(at.y - floor).toFixed(2)} m over the floor: its knees fold ${(lower - deepest).toFixed(2)} m short` };
  return { hips: new Vector3(at.x, at.y + HIPS_ABOVE * s, at.z), stand, lower, seconds: Math.max(QUICKEST, 1.875 * lower / (PACE * s)) };
}

/**
 * A person's weight going onto a seat, resting there and going back over its feet, kept with the person until it has stood: the legs asked
 * elsewhere (`Go`), or `rising`, stand it. Its feet stay planted throughout; balance carries its hips over `hips` by `share`, lets them down
 * `lower` by it, bows the trunk over the feet on the way (the same way down and up) and lays its free arms in its lap.
 */
export class Seat {
  rising = false;
  private time = 0;

  constructor(private readonly person: PersonLegged, readonly seating: Seating) {}

  /** a sub-step on: this seat, or none once it has stood */
  step(dt: number, asked: Go | null): Seat | null {
    this.rising ||= !!asked;
    this.time = MathUtils.clamp(this.time + (this.rising ? -dt : dt) * this.person.tempo / this.seating.seconds, 0, 1);
    if (this.rising && this.time === 0) return (this.person.seat = null);
    for (const arm of Object.values(this.person.armPose)) {
      arm.forward += LAP.forward * this.share;
      arm.elbow += LAP.elbow * this.share;
      arm.out += LAP.out * this.share;
    }
    return this;
  }

  get seated(): boolean { return this.time === 1 && !this.rising; }
  /** seconds till it is seated */
  get left(): number { return (1 - this.time) * this.seating.seconds / this.person.tempo; }
  /** 0 standing … 1 seated */
  get share(): number { return minimumJerk(this.time); }
  get bow(): number { return BOW * Math.sin(Math.PI * this.time ** LATE); }

  /** the surface it bears on, on the floor's plane: none till its hips have come down to it */
  get support(): [number, number][] {
    const { hips, lower } = this.seating, s = this.person.scale, r = SURFACE * s;
    if ((1 - this.share) * lower > TOUCH * s) return [];
    return [[-r, -r], [-r, r], [r, r], [r, -r]].map(([x, z]) => [hips.x + x, hips.z + z]);
  }
}
