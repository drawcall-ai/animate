import type { Vector3 } from 'three';
import type { Skeleton } from './skeleton';
import type { BonePoint, Cap, Contact, Impulse, Limit, Load, Point, Target } from './types';

/**
 * What behaviours propose in one sub-step. Proposals are copied, so a behaviour may reuse its
 * vectors; the body clears the board before every sub-step.
 */
export class Board {
  readonly targets: Target[] = [];
  readonly contacts: Contact[] = [];
  readonly limits: Limit[] = [];
  readonly caps: Cap[] = [];
  readonly loads: Load[] = [];
  readonly impulses: Impulse[] = [];

  target(t: Target): void {
    this.targets.push(copyTarget(t));
  }

  contact(c: Contact): void {
    this.contacts.push({ ...c, point: copyPoint(c.point), position: c.position.clone(), mask: c.mask?.clone(), rotation: c.rotation?.clone() });
  }

  limit(l: Limit): void {
    this.limits.push({ ...l, neutral: l.neutral?.clone(), twist: [...l.twist], swing: [[...l.swing[0]], [...l.swing[1]]] });
  }

  cap(c: Cap): void {
    this.caps.push({ ...c });
  }

  load(l: Load): void {
    this.loads.push({ ...l, at: l.at.clone() });
  }

  impulse(point: Point, velocity: Vector3): void {
    this.impulses.push({ point: copyPoint(point), velocity: velocity.clone() });
  }

  clear(): void {
    this.targets.length = 0;
    this.contacts.length = 0;
    this.limits.length = 0;
    this.caps.length = 0;
    this.loads.length = 0;
    this.impulses.length = 0;
  }
}

const copyBonePoint = (p: BonePoint): BonePoint => ({ bone: p.bone, at: p.at.clone() });
const copyPoint = (p: Point): Point => (p === 'com' ? p : copyBonePoint(p));

function copyTarget(t: Target): Target {
  switch (t.kind) {
    case 'position':
      return { ...t, claims: t.claims?.slice(), point: copyPoint(t.point), value: t.value.clone(), mask: t.mask?.clone() };
    case 'orientation':
      return { ...t, claims: t.claims?.slice(), point: copyBonePoint(t.point), value: t.value.clone() };
    case 'aim':
      return { ...t, claims: t.claims?.slice(), point: copyBonePoint(t.point), value: t.value.clone(), axis: t.axis.clone() };
    case 'local':
      return { ...t, claims: t.claims?.slice(), point: copyBonePoint(t.point), value: t.value.clone() };
  }
}

/** A board's proposals combined by the merge rules: what the solver works from. */
export interface Merged {
  /**
   * the targets with a weight left, each with its effective weight and (set by the body, when
   * it knows) how fast its value moves: m/s for a position or aim, rad/s for a rotation
   */
  targets: { target: Target; weight: number; velocity?: Vector3 }[];
  /** the winning contacts, at most one per point */
  contacts: Contact[];
  /** each bone's limit, the intersection of those proposed */
  limits: (Limit | undefined)[];
  /** each bone's acceleration cap (rad/s²; Infinity when none) */
  caps: number[];
  /** the root position's acceleration cap (m/s²; Infinity when none) */
  translationCap: number;
  loads: Load[];
  impulses: Impulse[];
  /** each owner's contacts that won and lost */
  outcomes: Map<string, Outcome>;
}

export interface Outcome {
  won: Contact[];
  lost: Contact[];
}

/**
 * Merges a board's proposals, independent of their order: main targets add; a fallback
 * target's weight is scaled by what the main targets of its sort (a position, or a rotation:
 * orientation, aim, local) on its bone, and those of any sort claiming it, leave (1 − Σ
 * weights, ≥ 0); contacts are exclusive per point, the highest priority wins and a tie between different
 * contacts throws; limits intersect; caps take the largest; loads and impulses add. The centre
 * of mass counts as a bone of its own.
 */
export function merge(board: Board, skeleton: Skeleton): Merged {
  const n = skeleton.bones.length;
  const bone = (i: number, what: string) => {
    if (!(Number.isInteger(i) && i >= 0 && i < n)) throw new Error(`${what} on bone ${i}, which the skeleton (${n} bones) has not`);
  };
  const point = (p: Point, what: string) => {
    if (p !== 'com') bone(p.bone, what);
  };

  // the main weight on each bone (the centre of mass's last), positions' and rotations' apart
  const main = new Array<number>(2 * (n + 1)).fill(0);
  const slot = (t: Target, bone: number | 'com') => 2 * (bone === 'com' ? n : bone) + (t.kind === 'position' ? 0 : 1);
  for (const t of board.targets) {
    point(t.point, `${t.kind} target`);
    if (!(t.weight >= 0 && t.weight <= 1)) throw new Error(`${t.kind} target weight ${t.weight} is outside 0..1`);
    if (t.stiffness !== undefined && !(t.stiffness > 0)) throw new Error(`${t.kind} target stiffness ${t.stiffness} is not positive`);
    if (t.kind === 'position' && t.mask) mask(t.mask, 'position target', (x) => x >= 0 && x <= 1);
    for (const b of t.claims ?? []) bone(b, `${t.kind} target's claim`);
    if (t.tier === 'fallback') continue;
    // its own bone's fallbacks of its sort; a claimed bone's of either (its own bone at most once each)
    const own = t.point === 'com' ? 'com' : t.point.bone;
    const yields = new Set([slot(t, own), ...(t.claims ?? []).flatMap((b) => [2 * b, 2 * b + 1])]);
    for (const s of yields) main[s] += t.weight;
  }
  const left = (t: Target) => Math.max(0, 1 - main[slot(t, t.point === 'com' ? 'com' : t.point.bone)]);
  const targets = board.targets
    .map((target) => ({ target, weight: target.tier === 'fallback' ? target.weight * left(target) : target.weight }))
    .filter((t) => t.weight > 0);

  for (const c of board.contacts) {
    point(c.point, 'contact');
    if (c.mask) mask(c.mask, 'contact', (x) => x === 0 || x === 1);
    if (c.point === 'com' && c.rotation) throw new Error('a contact on the centre of mass cannot hold a rotation');
    if (c.support !== undefined && !(c.support >= 0 && c.support <= 1)) throw new Error(`contact support ${c.support} is outside 0..1`);
  }

  const { contacts, outcomes } = mergeContacts(board.contacts);

  const limits = new Array<Limit | undefined>(n);
  for (const l of board.limits) {
    bone(l.bone, 'limit');
    limits[l.bone] = intersect(limits[l.bone], l);
  }

  const most = new Array<number>(n).fill(-1);
  let translation = -1;
  for (const c of board.caps) {
    bone(c.bone, 'cap');
    if (!(c.acceleration >= 0)) throw new Error(`cap ${c.acceleration} on bone ${c.bone} is negative`);
    if (c.kind !== 'translation') most[c.bone] = Math.max(most[c.bone], c.acceleration);
    else if (c.bone === 0) translation = Math.max(translation, c.acceleration);
    else throw new Error(`a translation cap on bone ${c.bone}: only the root (bone 0) translates`);
  }
  const caps = most.map((a) => (a < 0 ? Infinity : a));
  const translationCap = translation < 0 ? Infinity : translation;

  for (const l of board.loads) {
    bone(l.bone, 'load');
    if (!(l.mass >= 0)) throw new Error(`load mass ${l.mass} on bone ${l.bone} is negative`);
  }
  for (const i of board.impulses) point(i.point, 'impulse');

  return { targets, contacts, limits, caps, translationCap, loads: [...board.loads], impulses: [...board.impulses], outcomes };
}

function mask(m: Vector3, what: string, valid: (x: number) => boolean): void {
  if (!m.toArray().every(valid)) throw new Error(`${what} mask (${m.x}, ${m.y}, ${m.z}) has a component out of range`);
}

function mergeContacts(proposed: readonly Contact[]) {
  const winners = new Map<string, Contact>();
  for (const c of proposed) {
    const best = winners.get(pointKey(c.point));
    if (!best || c.priority > best.priority) winners.set(pointKey(c.point), c);
    else if (c.priority === best.priority && !same(c, best)) {
      throw new Error(`contacts of equal priority ${c.priority} disagree at ${pointKey(c.point)} (owners ${best.owner}, ${c.owner})`);
    }
  }
  const outcomes = new Map<string, Outcome>();
  for (const c of proposed) {
    if (c.owner === undefined) continue;
    let g = outcomes.get(c.owner);
    if (!g) outcomes.set(c.owner, (g = { won: [], lost: [] }));
    const w = winners.get(pointKey(c.point));
    // an identical contact of equal priority shares the win
    const won = w === c || (w !== undefined && w.priority === c.priority && same(w, c));
    (won ? g.won : g.lost).push(c);
  }
  return { contacts: [...winners.values()], outcomes };
}

/** contacts are exclusive per point: the same bone and the same bone-local point, or the centre of mass */
export const pointKey = (p: Point) => (p === 'com' ? 'com' : `bone ${p.bone} (${p.at.x}, ${p.at.y}, ${p.at.z})`);

const same = (a: Contact, b: Contact) =>
  a.position.equals(b.position) &&
  (a.support ?? 0) === (b.support ?? 0) &&
  (a.mask && b.mask ? a.mask.equals(b.mask) : a.mask === b.mask) &&
  (a.rotation && b.rotation ? a.rotation.equals(b.rotation) : a.rotation === b.rotation);

function intersect(a: Limit | undefined, b: Limit): Limit {
  const span = (r: [number, number], what: string): [number, number] => {
    if (!(r[0] <= r[1])) throw new Error(`limit on bone ${b.bone} has an empty ${what} range [${r[0]}, ${r[1]}]`);
    return r;
  };
  if (!a) return { ...b, twist: span(b.twist, 'twist'), swing: [span(b.swing[0], 'swing'), span(b.swing[1], 'swing')] };
  if (a.axis !== b.axis) throw new Error(`limits on bone ${b.bone} twist about different axes (${a.axis}, ${b.axis})`);
  if (!(a.neutral && b.neutral ? a.neutral.equals(b.neutral) : a.neutral === b.neutral)) {
    throw new Error(`limits on bone ${b.bone} are measured from different neutrals`);
  }
  const both = (x: [number, number], y: [number, number], what: string) => span([Math.max(x[0], y[0]), Math.min(x[1], y[1])], what);
  return { bone: b.bone, axis: b.axis, neutral: b.neutral, twist: both(a.twist, b.twist, 'twist'), swing: [both(a.swing[0], b.swing[0], 'swing'), both(a.swing[1], b.swing[1], 'swing')] };
}
