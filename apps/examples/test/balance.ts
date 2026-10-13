import { Vector3 } from 'three';
import { jointOf } from '../src/joints';
import { FIXED_DT } from '../src/scenario';
import { forwardOf, leftOf } from '../src/math';
import { Peak, type Frame, type Actor } from './frame';
import { holding } from './climb';
import { jumpSpans } from './flight';

/** below this ground speed a body counts as standing (m/s) */
const STANDING = 0.1;
/** below this horizontal CoM speed the body is still: its CoM must be over the feet (m/s) */
const STILL = 0.05;
/** above this ground speed (m/s) nobody walks: a run, before its first flight phase too (the walk–run transition is ~2 m/s) */
const RUN_SPEED = 2.3;
/** a running stride: two steps at ≥ 2.5 steps/s, each with a flight phase (s) */
const RUN_STRIDE = 0.8;
/** a jump's push-off launches the body past its feet: fore-aft it is not judged from this long before takeoff (s) */
const TAKEOFF = 0.3;
/** the hip joints' height above the seat surface when seated (m, default body; the core's seat task) */
const SEAT_HIP = 0.085;
/** hips this close to resting on the seat count as seated: the chair carries the body (m) */
const SEAT_CONTACT = 0.03;

/**
 * Balance. Dynamic (Hof's extrapolated centre of mass): XCoM = CoM + v/ω0, ω0 = √(g / leg
 * length), must stay within the base of support in every frame no seat carries the body.
 * The base of support is the convex hull of the planted soles plus the footprint a swinging
 * foot is landing on. Why the landing footprint: walking balance is foot placement — the
 * XCoM runs ahead of the stance foot by design and is caught when the swing lands (Hof
 * 2008), so the step being taken counts; a foot held up (a kick) supports nothing. The
 * whole 2D margin counts, fore-aft as well as sideways, at any speed — except fore-aft in a
 * running stride (a flight phase within the last RUN_STRIDE, or past RUN_SPEED): running is a bouncing gait,
 * not an inverted pendulum — the stance leg brakes and relaunches the body, which flies
 * between steps — so the pendulum's XCoM leads every touchdown by about v/ω0 minus half a
 * stance (~0.5 m at 3 m/s) in a perfectly steady run; sideways it is foot placement again
 * and judged. A two-footed jump is judged the same way through its push-off (the last
 * TAKEOFF before takeoff: the legs launch the body past its feet on purpose), its flight and
 * its landing (a flight phase, as running's). Static: the CoM stays over the feet while
 * standing still.
 */
export class Balance {
  /** per actor and frame: how far the XCoM lies outside the base, and outside it sideways, and whether only sideways counts */
  private readonly samples = new Map<Actor, { t: number; out: number; side: number; running: boolean; planted: boolean[]; held: boolean }[]>();
  private judged: { xcom: Peak; outAt: number[] } | null = null;
  private readonly standing = new Peak();
  private readonly prevCom = new Map<Actor, Vector3>();
  /** the seat each actor was last given (the chair stays when the seat target goes) */
  private readonly seats = new Map<Actor, Vector3>();
  /** when each actor last had no foot on the floor (s) */
  private readonly airborne = new Map<Actor, number>();

  get com() {
    return this.standing.value;
  }

  get xcom() {
    return this.judge().xcom;
  }

  get xcomFrames() {
    return this.judge().outAt.length;
  }

  /** the XCoM against the base, frame by frame: fore-aft too, except in a flight's running strides and a jump's push-off */
  private judge() {
    if (this.judged) return this.judged;
    const xcom = new Peak();
    const outAt: number[] = [];
    for (const samples of this.samples.values()) {
      const jumps = jumpSpans(samples);
      for (const s of samples) {
        const jump = jumps.some(([a, b]) => s.t >= a - TAKEOFF && s.t <= b);
        const out = s.running || jump ? s.side : s.out;
        xcom.see(out, s.t);
        if (out > 0.1) outAt.push(s.t);
      }
    }
    this.judged = { xcom, outAt };
    return this.judged;
  }

  see({ t, h, input }: Frame) {
    const com = comOf(h);
    const prev = this.prevCom.get(h);
    this.prevCom.set(h, com);
    if (input.seat) this.seats.set(h, input.seat.position.clone());
    // (riding, the mount balances: riding is judged by its own measures)
    if (h.mounted) return;
    // (hands holding an edge carry the body: a climb is judged by its own measures)
    if (holding(h, input)) return this.sample(h, { t, out: 0, side: 0, running: false, planted: h.feet.map((f) => f.phase === 'planted'), held: true });
    if (h.feet.every((f) => f.phase === 'swing')) this.airborne.set(h, t);
    if (!prev || this.onSeat(h)) return;
    const velocity = com.clone().sub(prev).divideScalar(FIXED_DT);
    // (a force the hands exert holds the centre of mass off the feet: its moment f·h / g)
    const held = com.clone().sub(leanOf(h, input));
    this.dynamic(t, h, held, velocity);
    const speed = Math.hypot(h.velocity.x, h.velocity.z);
    const still = speed < STANDING && Math.hypot(velocity.x, velocity.z) < STILL && h.feet.every((f) => f.phase === 'planted');
    if (still) this.standing.see(outsideHull(this.soles(h), [held.x, held.z]), t);
  }

  /** the seat carries the body: the hip joints rest on it (within SEAT_CONTACT) */
  private onSeat(h: Actor): boolean {
    const seat = this.seats.get(h);
    if (!seat || h.seated <= 0) return false;
    const hips = (jointOf(h, 'leftUpperLeg').y + jointOf(h, 'rightUpperLeg').y) / 2;
    return hips < seat.y + SEAT_HIP * h.proportions.scale + SEAT_CONTACT;
  }

  private dynamic(t: number, h: Actor, com: Vector3, velocity: Vector3) {
    const p = h.proportions;
    const x = com.clone().addScaledVector(velocity, 1 / Math.sqrt(9.81 / p.legLength));
    const pts = this.soles(h, true);
    h.feet.forEach((f) => {
      if (f.phase !== 'swing') return;
      const fw = forwardOf(f.yaw);
      const l = leftOf(f.yaw);
      for (const [k, s] of [[-p.heelBack, 0], [p.toeFront, 0.04], [p.toeFront, -0.04]]) pts.push([f.position.x + fw.x * k + l.x * s, f.position.z + fw.z * k + l.z * s]);
    });
    if (pts.length < 3) throw new Error(`${t.toFixed(2)} s: no base of support`);
    const running = t - (this.airborne.get(h) ?? -Infinity) < RUN_STRIDE || Math.hypot(h.velocity.x, h.velocity.z) > RUN_SPEED;
    this.sample(h, { t, out: outsideHull(pts, [x.x, x.z]), side: sideways(pts, x, h.yaw), running, planted: h.feet.map((f) => f.phase === 'planted'), held: false });
  }

  private sample(h: Actor, s: { t: number; out: number; side: number; running: boolean; planted: boolean[]; held: boolean }) {
    const samples = this.samples.get(h) ?? [];
    this.samples.set(h, samples);
    samples.push(s);
    this.judged = null;
  }

  /** the >10 cm frames as time spans, e.g. " (0.85–1.87 s, 11.98 s)" */
  private episodes(): string {
    const spans: [number, number][] = [];
    for (const t of [...this.judge().outAt].sort((a, b) => a - b)) {
      const last = spans[spans.length - 1];
      if (last && t - last[1] < 2.5 * FIXED_DT) last[1] = t;
      else spans.push([t, t]);
    }
    if (!spans.length) return '';
    return ` (${spans.map(([a, b]) => (a === b ? `${a.toFixed(2)}` : `${a.toFixed(2)}–${b.toFixed(2)}`)).join(', ')} s)`;
  }

  /** the sole points (x, z) of both feet, or of the planted ones */
  private soles(h: Actor, plantedOnly = false): [number, number][] {
    return (['left', 'right'] as const)
      .filter((_, s) => !plantedOnly || h.feet[s].phase === 'planted')
      .flatMap((n) => [`${n}Heel`, `${n}BigToe`, `${n}SmallToe`].map((j) => jointOf(h, j)))
      .map((v): [number, number] => [v.x, v.z]);
  }

  toString() {
    return `balance: XCoM outside support max ${this.xcom}, frames >10 cm out: ${this.xcomFrames}${this.episodes()}; standing CoM outside the feet max ${this.standing}`;
  }
}

/** how far `x` lies beyond the base's sideways extent (across `yaw`) */
function sideways(pts: [number, number][], x: Vector3, yaw: number): number {
  const l = leftOf(yaw);
  const across = pts.map(([px, pz]) => px * l.x + pz * l.z);
  const q = x.x * l.x + x.z * l.z;
  return Math.max(0, q - Math.max(...across), Math.min(...across) - q);
}

/** the body's joints by name */
type Joints = (name: string) => Vector3;

/** a limb's mass centre: 40 % of the way from its root joint to its end (Dempster) */
const along = (j: Joints, a: string, b: string) => j(a).lerp(j(b), 0.4);

/**
 * Segment mass fractions after Dempster (they sum to 1): head, abdomen, thorax, each arm and leg.
 * Deliberately independent of the core's own estimate (`centreOfMass` in pose/mass.ts): the
 * head sits at the skull centre from the head bone's rotation rather than between the ears,
 * so a mistake in either shows up as disagreement instead of agreeing with itself.
 */
const SEGMENTS: [mass: number, at: (j: Joints, skull: Vector3) => Vector3][] = [
  [0.081, (_, skull) => skull],
  [0.25, (j) => j('spine')],
  [0.247, (j) => j('chest')],
  [0.05, (j) => along(j, 'leftUpperArm', 'leftHand')],
  [0.05, (j) => along(j, 'rightUpperArm', 'rightHand')],
  [0.161, (j) => along(j, 'leftUpperLeg', 'leftFoot')],
  [0.161, (j) => along(j, 'rightUpperLeg', 'rightFoot')],
];

/**
 * Centre of mass: the mass-weighted mean of the segments. Summed relative to the hips, so
 * the result does not depend on where in the world the body stands.
 */
/** the body's centre of mass (Dempster's segments from the posed joints) */
export function comOf(h: Actor): Vector3 {
  const j: Joints = (name) => jointOf(h, name);
  const hips = j('hips');
  // (the OpenPose skeleton's bone frames are the normalized ones the proportions are given in)
  const head = h.model.scene.getObjectByName('head');
  if (!head) throw new Error('no head');
  const skull = head.localToWorld(h.proportions.headCenter.clone());
  const sum = new Vector3();
  const offset = new Vector3();
  let total = 0;
  for (const [mass, at] of SEGMENTS) {
    sum.addScaledVector(offset.subVectors(at(j, skull), hips), mass);
    total += mass;
  }
  return sum.divideScalar(total).add(hips);
}

/** distance from `q` to the convex hull of `pts` (0 inside) */
export function outsideHull(pts: [number, number][], q: [number, number]): number {
  // monotone chain hull
  const P = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: number[][] = [];
  const up: number[][] = [];
  for (const p of P) {
    while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop();
    lo.push(p);
  }
  for (const p of [...P].reverse()) {
    while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop();
    up.push(p);
  }
  const H = lo.slice(0, -1).concat(up.slice(0, -1));
  let inside = true;
  let best = Infinity;
  for (let i = 0; i < H.length; i++) {
    const a = H[i];
    const b = H[(i + 1) % H.length];
    if (cross(a, b, q) < 0) inside = false;
    const abx = b[0] - a[0];
    const aby = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((q[0] - a[0]) * abx + (q[1] - a[1]) * aby) / (abx * abx + aby * aby || 1)));
    best = Math.min(best, Math.hypot(q[0] - a[0] - t * abx, q[1] - a[1] - t * aby));
  }
  return inside ? 0 : best;
}

/** where a force the hands exert holds the centre of mass off the feet (m): f·h / g, h the wrists' height over the feet, as far as the hands hold on */
function leanOf(h: Actor, input: Frame['input']): Vector3 {
  const f = input.handForce;
  const hands = [input.leftHand, input.rightHand].filter((e) => e && (e.weight ?? 1) > 0);
  if (!f || !hands.length) return new Vector3();
  const w = Math.min(1, hands.reduce((a, e) => a + (e?.weight ?? 1), 0) / hands.length);
  const feet = Math.min(...h.feet.map((ft) => ft.position.y - h.proportions.ankleHeight));
  const wrists = (jointOf(h, 'leftHand').y + jointOf(h, 'rightHand').y) / 2;
  return new Vector3(f.x, 0, f.z).multiplyScalar(((wrists - feet) / 9.81) * w);
}
