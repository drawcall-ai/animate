import { Vector3 } from 'three';
import type { Proportions } from '../proportions';
import type { Box } from '../input';
import { clamp, hypot, lerp } from '../math';
import { swingProgress, type Swing } from './foot';
import type { Gait } from './gait';

/** boxes up to this top height (× body height) are stepped over; taller ones only weigh on where the planner stands (no path goes around them) */
const STEP_OVER = 0.2;
/** how far a foot standing on ground may reach out past its edge, heel or toes; and the room it keeps from higher ground, a riser (m, default body) */
const OVERHANG = 0.06;
const ROOM = 0.04;
/** a step up or down onto other ground (× height): one stair riser takes a stride; more costs, and beyond STEP_UP no step goes */
const RISE = 0.12;
const STEP_UP = 0.26;
/** a step's rise weighs this much more than its length: the leg lifts or lowers the body over it (one stair tread a step, not two) */
const CLIMB = 3.5;

/** a box low enough to step over */
export const steppable = (o: Box, d: Proportions) => o.max.y < STEP_OVER * d.height;

/** scratch: the stretches (m along a traced line) where it runs through each obstacle, and their tops */
const _enter: number[] = [];
const _exit: number[] = [];
const _top: number[] = [];
const _box: Box[] = [];

/**
 * Traces the line from `a` toward `b` (+Z when they coincide; its direction into `dir`)
 * through the boxes, filling the scratch; returns how many it crosses.
 */
function trace(boxes: readonly Box[], a: Vector3, b: Vector3, dir: Vector3): number {
  const len = hypot(b.x - a.x, b.z - a.z);
  if (len > 1e-9) dir.set((b.x - a.x) / len, 0, (b.z - a.z) / len);
  else dir.set(0, 0, 1);
  let n = 0;
  for (const o of boxes) {
    let enter = -Infinity;
    let exit = Infinity;
    if (Math.abs(dir.x) > 1e-9) {
      const u = (o.min.x - a.x) / dir.x;
      const v = (o.max.x - a.x) / dir.x;
      enter = Math.min(u, v);
      exit = Math.max(u, v);
    } else if (a.x <= o.min.x || a.x >= o.max.x) continue;
    if (Math.abs(dir.z) > 1e-9) {
      const u = (o.min.z - a.z) / dir.z;
      const v = (o.max.z - a.z) / dir.z;
      enter = Math.max(enter, Math.min(u, v));
      exit = Math.min(exit, Math.max(u, v));
    } else if (a.z <= o.min.z || a.z >= o.max.z) continue;
    if (enter >= exit) continue;
    _enter[n] = enter;
    _exit[n] = exit;
    _top[n] = o.max.y;
    _box[n] = o;
    n++;
  }
  return n;
}

/** the tallest of the `n` traced obstacles over the stretch [from, to] of the line (`to` reaching on by `perTop` × each one's top) */
function tallestOn(n: number, from: number, to: number, perTop = 0): number {
  let h = 0;
  for (let i = 0; i < n; i++) if (from < _exit[i] && to + perTop * _top[i] > _enter[i]) h = Math.max(h, _top[i]);
  return h;
}

const _dir = new Vector3();

/** A stretch of a line that runs across an obstacle: where it enters and leaves it (m along the line), and the line's direction. */
export interface Crossing {
  box: Box | null;
  enter: number;
  exit: number;
  readonly dir: Vector3;
}

/**
 * The nearest of `boxes` the line from `a` to `b` crosses all the way (starting before it,
 * ending past it), into `out`; false when none.
 */
export function crossing(boxes: readonly Box[], a: Vector3, b: Vector3, out: Crossing): boolean {
  const n = trace(boxes, a, b, out.dir);
  const len = hypot(b.x - a.x, b.z - a.z);
  out.box = null;
  out.enter = Infinity;
  for (let i = 0; i < n; i++) {
    if (_enter[i] <= 0 || _exit[i] >= len || _enter[i] >= out.enter) continue;
    out.box = _box[i];
    out.enter = _enter[i];
    out.exit = _exit[i];
  }
  return out.box !== null;
}

/** the highest of `boxes` whose top holds (x, z) (null: none, the floor does) */
export function groundUnder(boxes: readonly Box[], x: number, z: number): Box | null {
  let top: Box | null = null;
  for (const o of boxes) if (x >= o.min.x && x <= o.max.x && z >= o.min.z && z <= o.max.z && (!top || o.max.y > top.max.y)) top = o;
  return top;
}

/** the ground's height at (x, z): the highest box top holding it, else the floor's (0) */
export const groundAt = (boxes: readonly Box[], x: number, z: number) => groundUnder(boxes, x, z)?.max.y ?? 0;

/**
 * The height of the ground a foot stands on with its ankle at (x, z), facing along (ux, uz):
 * the ground under its ball; NaN when it would stand across an edge (heel or toes out past it
 * by more than OVERHANG) or within ROOM of higher ground.
 */
export function footGround(boxes: readonly Box[], x: number, z: number, ux: number, uz: number, d: Proportions): number {
  const at = (k: number) => groundAt(boxes, x + ux * k, z + uz * k);
  const level = at(d.offsets.leftToes.z);
  const o = OVERHANG * d.scale;
  const r = ROOM * d.scale;
  const flat = (k: number) => Math.abs(at(k) - level) < 0.01;
  return flat(o - d.heelBack) && flat(d.toeFront - o) && at(-d.heelBack - r) < level + 0.01 && at(d.toeFront + r) < level + 0.01 ? level : NaN;
}

/** a foot's room from a wall (m, default body) */
const WALL_ROOM = 0.02;

/**
 * Whether a foot standing with its ankle at (x, z), facing along (ux, uz), reaches into one
 * of `boxes` too tall to step over (a wall, a crate): heel, ball or toes over it, with room.
 */
export function inWall(boxes: readonly Box[], x: number, z: number, ux: number, uz: number, d: Proportions): boolean {
  const r = WALL_ROOM * d.scale;
  for (const o of boxes) {
    if (steppable(o, d)) continue;
    for (const k of [-d.heelBack, d.offsets.leftToes.z, d.toeFront]) {
      const px = x + ux * k;
      const pz = z + uz * k;
      if (px > o.min.x - r && px < o.max.x + r && pz > o.min.z - r && pz < o.max.z + r) return true;
    }
  }
  return false;
}

/** the inward normal (into `out`) of the face of box `o` nearest to `p` on it (a vertical face); returns which: 0 −x, 1 +x, 2 −z, 3 +z */
export function faceAt(o: Box, p: Vector3, out: Vector3): number {
  const faces = [p.x - o.min.x, o.max.x - p.x, p.z - o.min.z, o.max.z - p.z].map(Math.abs);
  const f = faces.indexOf(Math.min(...faces));
  out.set(f === 0 ? 1 : f === 1 ? -1 : 0, 0, f === 2 ? 1 : f === 3 ? -1 : 0);
  return f;
}

const _one: Box[] = [];

/** how far along the line from `a` toward `b` it enters box `o` (m; its direction into `dir`; Infinity: it starts inside or misses it) */
export function entering(o: Box, a: Vector3, b: Vector3, dir: Vector3): number {
  _one[0] = o;
  return trace(_one, a, b, dir) && _enter[0] > 0 ? _enter[0] : Infinity;
}

/**
 * how fast a swinging foot rises before ground ahead and sets down after it (m/s); and at most
 * rises off where it lifts off and sets down onto where it lands (nearly straight down onto a
 * lower tread: its heel keeps clear of the nose above)
 */
const GROUND_SPEED = 1.5;
const SET_DOWN = 3;
/** the swing's samples, as shares of its time */
const SWING_SAMPLES = 40;

/**
 * The least height of swing `w`'s ankle at its progress `s` over the ground, its sole's
 * lowest points `toes` and `heel` (offsets from the ankle, as the foot is pitched now): above
 * the ground under them all along the way, the foot rising before an edge and setting down
 * after it at GROUND_SPEED, by `clearance` fading in and out at lift-off and landing; rising
 * off the lift-off and setting down onto the landing no faster than SET_DOWN.
 */
export function groundClearance(g: Gait, w: Swing, s: number, toes: Vector3, heel: Vector3, clearance: number): number {
  const ground = g.steer.ground;
  const { from, to, duration: T } = w;
  let least = -Infinity;
  for (let i = 0; i <= SWING_SAMPLES; i++) {
    const si = i / SWING_SAMPLES;
    const k = swingProgress(si, w.early);
    const x = lerp(from.x, to.x, k);
    const z = lerp(from.z, to.z, k);
    const sole = Math.max(groundAt(ground, x + toes.x, z + toes.z) - toes.y, groundAt(ground, x + heel.x, z + heel.z) - heel.y);
    least = Math.max(least, sole + clearance * Math.sin(Math.PI * si) - GROUND_SPEED * T * Math.abs(s - si));
  }
  return Math.min(least, from.y + SET_DOWN * T * s, to.y + SET_DOWN * T * (1 - s));
}

/** tallest obstacle a footprint sweeps over moving from `a` to `b` */
export function heightAlong(g: Gait, a: Vector3, b: Vector3): number {
  if (!g.lowObstacles.length) return 0;
  const n = trace(g.lowObstacles, a, b, _dir);
  return tallestOn(n, -g.d.heelBack - 0.03, hypot(b.x - a.x, b.z - a.z) + g.d.toeFront + 0.03);
}

/** the part of the swing (progress s) where the foot is above an obstacle */
export function overSpan(g: Gait, w: Swing) {
  const d = g.d;
  const n = trace(g.lowObstacles, w.from, w.to, _dir);
  const len = hypot(w.to.x - w.from.x, w.to.z - w.from.z);
  w.overOn = 1;
  w.overOff = 0;
  for (let s = 0; s <= 1; s += 0.02) {
    const at = len * swingProgress(s, true);
    // (the heel has to be well past it: a long stride's foot trails its path as the leg straightens)
    if (tallestOn(n, at - d.heelBack - 0.08, at + d.toeFront + 0.03) === 0) continue;
    w.overOn = Math.min(w.overOn, s);
    w.overOff = s;
  }
  // the sole only needs to clear the edges by a few cm (the 10 cm margin is for the
  // apex), so the ramps may run on past them: a gentler rise and set-down
  const h = w.clear - d.ankleHeight - 0.1 * d.scale;
  const q = clamp((h + d.ankleHeight + 0.03) / w.clear, 0, 1);
  const x = 0.5 - Math.sin(Math.asin(1 - 2 * q) / 3); // smoothstep(x) = q
  // (and never a vertical snap, even with the obstacle right at the start or end)
  w.overOn = clamp(w.overOn / x, 0.2, 0.5);
  w.overOff = clamp(1 - (1 - w.overOff) / x, w.overOn, 0.8);
}

/**
 * Footstep planning over obstacles and ground: a foot never lands on an obstacle nor
 * in a wall nor across a step's edge, and steps up or down one riser a stride (one stair tread a step);
 * the choice looks one footfall ahead, so the next step can cross with the obstacle
 * mid-step. The adjustment is spread over both steps (as people do) instead of a stutter
 * step or a lunge. Returns true when the landing was moved.
 */
export function avoidLandingOn(g: Gait, s: number, to: Vector3): boolean {
  const { ground, floorObstacles } = g.steer;
  if (!g.lowObstacles.length && !ground.length && g.lowObstacles.length === floorObstacles.length) return false;
  const d = g.d;
  const f = g.feet[s];
  const other = g.feet[1 - s].anchor;
  const len = hypot(to.x - f.anchor.x, to.z - f.anchor.z);
  if (len < 1e-3) return false;
  // every footprint considered lies along this line, facing along it: `dist` m from the anchor
  const n = trace(g.lowObstacles, f.anchor, to, _dir);
  const ux = _dir.x;
  const uz = _dir.z;
  // (heel lands ~10 cm past the edge; stopping short keeps the toe back by about the
  // obstacle's height — room to lift the foot at ~45° before it gets there)
  const front = d.toeFront + 0.05;
  const back = d.heelBack + 0.1;
  // the ground there, and how much the rise from the other foot's costs
  const level = other.y - d.ankleHeight;
  const on = (dist: number) => (ground.length ? footGround(ground, f.anchor.x + ux * dist, f.anchor.z + uz * dist, ux, uz, d) : 0);
  const rise = (dist: number) => 20 * Math.max(0, Math.abs(on(dist) - level) - RISE * d.height) ** 2;
  const overAt = (dist: number) => tallestOn(n, dist - back, dist + front, 1) > 0;
  // (and never into a wall)
  const walled = (dist: number) => inWall(floorObstacles, f.anchor.x + ux * dist, f.anchor.z + uz * dist, ux, uz, d);
  const blockedAt = (dist: number) => overAt(dist) || !(Math.abs(on(dist) - level) <= STEP_UP * d.height) || walled(dist);
  // the next footfall lands about one normal step length further on (the gait's own
  // step, not this possibly adjusted one); reach is judged from the other foot
  const maxStep = lerp(0.55, 1.05, g.run) * d.height;
  const pace = Math.max(g.speed, g.targetSpeed);
  const stepLen = clamp(pace * g.timing().stepT, 0.2 * d.scale, maxStep);
  /** how far the next footfall from `dist` must move off an obstacle (m; ground ahead is the next step's to judge: a wall is walked up to, not onto) */
  const nextFix = (dist: number) => {
    for (let k = 0; k <= 0.5; k += 0.02) {
      if (!overAt(dist + stepLen + k) || !overAt(dist + stepLen - k / 1.5)) return k;
    }
    return 0.5;
  };
  // (a step up or down is always chosen: which tread it lands on)
  if (!blockedAt(len) && nextFix(len) === 0 && !(Math.abs(on(len) - level) > 0.01)) return false;
  let best = -1;
  let bestCost = Infinity;
  for (let dist = 0.05; dist <= 2 * maxStep; dist += 0.02) {
    if (blockedAt(dist)) continue;
    const px = f.anchor.x + ux * dist;
    const pz = f.anchor.z + uz * dist;
    // keep both steps close to a normal step (people regulate step length, not where
    // the body happens to be). Shortening counts extra: it leaves the obstacle still
    // ahead, needing yet another short step — people prefer lengthening
    const along = (px - other.x) * ux + (pz - other.z) * uz;
    const up = ground.length ? on(dist) - level : 0;
    const dev = (up === 0 ? along : Math.sign(along) * hypot(along, CLIMB * up)) - stepLen;
    const length = (dev < 0 ? 1.5 * dev : dev) ** 2;
    // (beyond reach only if nothing else is free: a lunge beats landing on it)
    const lunge = 10 * Math.max(0, hypot(px - other.x, pz - other.z) - maxStep);
    const c = length + nextFix(dist) ** 2 + lunge + (ground.length ? rise(dist) : 0);
    if (c < bestCost) {
      bestCost = c;
      best = dist;
    }
  }
  if (best < 0) return false;
  to.set(f.anchor.x + ux * best, to.y, f.anchor.z + uz * best);
  return true;
}
