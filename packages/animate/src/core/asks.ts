import type { Vector3 } from 'three';
import { action, type UntilCondition } from '@pmndrs/timeline';
import type { Body, Frame } from './body';
import { live, type Behaviour, type Live } from './goal';

/** Walking somewhere: the point on the floor the body goes to, its velocity, and how fast the body may go (m/s, m/s²). */
export interface Go {
  to: Vector3;
  velocity?: Vector3;
  speed: number;
  accel: number;
  /** arriving, the feet are squared into the stance (default true; false: they stay as they land) */
  plant?: boolean;
}

/** How the body stands when nothing asks for more. */
export interface Stance {
  /** half the distance between the ankles, sideways (m) */
  width: number;
  /** the left foot forward (+) or back (−) of the right (m) */
  stagger: number;
  /** how far the pelvis is let down, the knees bent (m): a ready stance */
  crouch: number;
  /** the pelvis and feet turned off the facing (rad): a bladed stance */
  blade: number;
  /** each foot turned out (rad) */
  toeOut: number;
}

/**
 * What the tasks ask of the base, which alone moves the root, the legs and the trunk's posture. A task asks what it needs every
 * sub-step it runs (`request`), and asks of several tasks combine, one rule a field: the deepest `lower` and `bow` (rising onto the
 * toes or leaning back only while none asks down), the least `bowLimit`, the larger `twist`, `lean` and `steady`; `go`, `face`, `look` and
 * `stance` have one owner each, the last to ask. The base reads them at the start of its update and clears them (so it acts on them
 * a sub-step later).
 */
export interface Asks {
  /** walk there */
  go: Go | null;
  /** turn to face `yaw` (rad), at most `rate` (rad/s) */
  face: { yaw: number; rate?: number } | null;
  /** let the pelvis down by the knees (m; negative: up onto the toes) */
  lower: number;
  /** bend the trunk forward at the hips and lower back (rad) */
  bow: number;
  /** maximum bow while preparing or carrying a load (rad); constraints combine by minimum */
  bowLimit: number;
  /** axial chest turn from the standing facing (rad) */
  twist: number;
  /** where the eyes are (`lookAt`): a species without a neck chain turns its head there in its posture */
  look: Readonly<Vector3> | null;
  /** stand otherwise than the body's stance */
  stance: Partial<Stance> | null;
  /** standing, shift the weight this far (m, on the floor) within the feet: toward what a hand falls short of */
  lean: Vector3 | null;
  /** hold still (0 at ease … 1 aiming): the base's quiet life — breathing, sway, weight shifts — fades by it */
  steady: number;
}

/** nothing asked */
export const createAsks = (): Asks => ({ go: null, face: null, lower: 0, bow: 0, bowLimit: Infinity, twist: 0, look: null, stance: null, lean: null, steady: 0 });

/** `more` asked of the base on top of what `asks` holds already, each field combined by its rule (`Asks`) */
export function request(asks: Asks, more: Partial<Asks>): void {
  const { lower, bow, bowLimit, twist, lean, steady, ...owned } = more;
  if (lower !== undefined) asks.lower = deeper(asks.lower, lower);
  if (bow !== undefined) asks.bow = deeper(asks.bow, bow);
  if (bowLimit !== undefined) asks.bowLimit = Math.min(asks.bowLimit, bowLimit);
  if (twist !== undefined && Math.abs(twist) > Math.abs(asks.twist)) asks.twist = twist;
  if (lean && lean.length() > (asks.lean?.length() ?? 0)) asks.lean = lean;
  if (steady !== undefined) asks.steady = Math.max(asks.steady, steady);
  for (const [field, value] of Object.entries(owned)) if (value !== undefined) (asks as unknown as Record<string, unknown>)[field] = value;
}

/** down (+) wins, the deepest; up (−) only while none asks down, the highest */
const deeper = (was: number, asked: number) => asked > 0 ? Math.max(was, asked) : was <= 0 ? Math.min(was, asked) : was;

/** what `asks` holds, copied into `into`, and `asks` cleared */
export function takeAsks(asks: Asks, into: Asks): Asks {
  Object.assign(into, asks);
  Object.assign(asks, createAsks());
  return into;
}

/**
 * Asks the base for what `asks` gives (the fields it has, combined with what other tasks ask: `request`), every
 * sub-step, endless or until `until`: a task of its own for what no other task asks (shift weight, turn to a facing while the hands work).
 */
export function ask(h: Body, asks: Live<Partial<Asks>>, until?: UntilCondition<Frame>): Behaviour {
  return function* () {
    yield* action<Frame>({
      update: (f) => {
        request(h.asks, live(asks, f));
      },
      until,
    });
  };
}
