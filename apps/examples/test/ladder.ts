import { Vector3 } from 'three';
import type { Box, Ladder } from '@prohuman/core';
import { jointOf } from '../src/joints';
import { depthIn, PARTS, type Part } from './climb';
import type { Frame, Actor } from './frame';

/** the rung and stile sizes drawn (m): a rung's radius, a stile's half depth and half width; how far the stiles reach above the top */
const RUNG = 0.015;
const STILE = { depth: 0.025, width: 0.015 };
const RAILS = 1;
/** a wrist or the ball of a foot this close to a rung or stile holds it (m) */
const ON = 0.06;

/** a ladder's frame: its foot, into it, across it; rung spacing and count; stiles' half spacing */
function frame(l: Ladder) {
  const dir = new Vector3(Math.sin(l.yaw), 0, Math.cos(l.yaw));
  const left = new Vector3(Math.cos(l.yaw), 0, -Math.sin(l.yaw));
  const spacing = l.spacing ?? 0.3;
  const base = new Vector3(l.position.x, l.position.y, l.position.z);
  return { base, dir, left, spacing, rungs: Math.round((l.height - base.y) / spacing), half: (l.width ?? 0.46) / 2, top: l.height };
}

/** how far a point lies from the ladder's rungs and stiles (m; − = inside one) */
export function ladderDistance(l: Ladder, p: Vector3): number {
  const f = frame(l);
  const rel = p.clone().sub(f.base);
  const along = rel.dot(f.dir);
  const across = rel.dot(f.left);
  const up = rel.y;
  let best = Infinity;
  // the rungs: segments across between the stiles
  const i = Math.min(f.rungs, Math.max(1, Math.round(up / f.spacing)));
  const a = Math.max(0, Math.abs(across) - f.half);
  best = Math.min(best, Math.hypot(along, up - i * f.spacing, a) - RUNG);
  // the stiles: boxes up to the rails' tops
  for (const side of [-1, 1]) {
    const dx = Math.max(0, Math.abs(across - side * f.half) - STILE.width);
    const dz = Math.max(0, Math.abs(along) - STILE.depth);
    const dy = Math.max(0, up - (f.top - f.base.y + RAILS), -up);
    const out = Math.hypot(dx, dz, dy);
    best = Math.min(best, out > 0 ? out : -Math.min(STILE.width - Math.abs(across - side * f.half), STILE.depth - Math.abs(along)));
  }
  return best;
}

/** a hand holds a ladder's rung or stile */
export const onLadder = (h: Actor, ladders: readonly Ladder[] | undefined) =>
  !!ladders?.some((l) => (['left', 'right'] as const).some((s) => ladderDistance(l, jointOf(h, `${s}Hand`)) < ON));

/** one ladder climb's measures (m, s, m/s) */
export interface LadderMeasure {
  /** off the floor, and standing on the top */
  from: number;
  to: number;
  /** frames with fewer than three limbs on the ladder (the three-point rule), and with no hand on it */
  threePoint: number;
  noHand: number;
  /** the deepest each part reaches into the ladder or the wall behind it (m, with its radius) */
  depth: Record<Part, number>;
  /** the chest's distance out from the rungs, and the hip joints' (mean m) */
  chest: number;
  hips: number;
  /** vertical speed (m/s) */
  speed: number;
  /** hand moves and foot moves, and how many of the foot moves followed the opposite hand's (contralateral) or the same hand's within 0.5 s */
  handMoves: number;
  footMoves: number;
  opposite: number;
  same: number;
}

interface Sample {
  t: number;
  /** each limb [left hand, right hand, left foot, right foot] on the ladder */
  on: boolean[];
  depth: Record<Part, number>;
  chest: number;
  hips: number;
  height: number;
  floor: boolean;
}

/**
 * Climbing a ladder, of the first actor: three limbs on it at all times while off the floor,
 * nothing of the body in the rungs, stiles or the wall behind, the trunk close to the rungs,
 * a hand and the opposite foot moving together, and how fast it goes up.
 */
export class LadderClimbing {
  private readonly samples: Sample[] = [];
  private cached: LadderMeasure[] | null = null;
  private ladder: Ladder | null = null;

  see({ t, h, input }: Frame) {
    const l = input.ladders?.[0];
    if (!l) return;
    this.ladder = l;
    const H = h.proportions.height;
    const f = frame(l);
    const j = (n: string) => jointOf(h, n);
    const wall: readonly Box[] = input.ground ?? [];
    const depth = {} as Record<Part, number>;
    for (const k of Object.keys(PARTS) as Part[]) {
      const { r, joints } = PARTS[k];
      // (the hands hold it, the soles stand on it: only the wall behind counts for them)
      depth[k] = Math.max(...joints.flatMap((n) => [k === 'hand' || k === 'sole' ? -1 : r * H - ladderDistance(l, j(n)), ...wall.map((o) => depthIn(o, j(n)) + (k === 'sole' ? 0 : r * H))]));
    }
    const out = (p: Vector3) => -p.clone().sub(f.base).dot(f.dir);
    this.samples.push({
      t,
      // (a foot standing on the floor or the top is a contact too)
      on: [j('leftHand'), j('rightHand'), j('leftToes'), j('rightToes')].map((p, i) => ladderDistance(l, p) < ON || (i > 1 && h.feet[i - 2].phase === 'planted')),
      depth,
      chest: out(j('chest')),
      hips: out(j('leftUpperLeg').add(j('rightUpperLeg')).multiplyScalar(0.5)),
      height: h.model.scene.position.y,
      floor: h.feet.some((ft) => ft.phase === 'planted'),
    });
    this.cached = null;
  }

  get climbs(): LadderMeasure[] {
    this.cached ??= this.measure();
    return this.cached;
  }

  private measure(): LadderMeasure[] {
    const S = this.samples;
    const from = S.findIndex((s) => !s.floor);
    if (!this.ladder || from < 0) return [];
    let to = from;
    while (to + 1 < S.length && !S[to + 1].floor) to++;
    let threePoint = 0;
    let noHand = 0;
    let chest = 0;
    let hips = 0;
    // (the three-point rule holds on the ladder: not stepping off onto the top)
    const stepOff = S.findIndex((s, k) => k > from && s.height > this.ladder!.height - 0.6);
    const climbEnd = stepOff < 0 ? to : stepOff;
    for (let k = from; k <= climbEnd; k++) {
      const n = S[k].on.filter(Boolean).length;
      if (n < 3) threePoint++;
      if (!S[k].on[0] && !S[k].on[1]) noHand++;
      chest += S[k].chest;
      hips += S[k].hips;
    }
    const depth = {} as Record<Part, number>;
    for (const p of Object.keys(PARTS) as Part[]) depth[p] = Math.max(...S.map((s) => s.depth[p]));
    // limb moves: leaving the ladder and back on
    const starts: number[][] = [[], [], [], []];
    for (let k = from + 1; k <= climbEnd; k++) for (let i = 0; i < 4; i++) if (S[k - 1].on[i] && !S[k].on[i]) starts[i].push(S[k].t);
    let opposite = 0;
    let same = 0;
    for (let i = 2; i < 4; i++)
      for (const t of starts[i]) {
        // (the hand leads its foot by up to half a second)
        const near = (hand: number) => starts[hand].some((u) => t - u > -0.1 && t - u < 0.5);
        if (near(i === 2 ? 1 : 0)) opposite++;
        if (near(i === 2 ? 0 : 1)) same++;
      }
    const span = climbEnd - from;
    return [
      {
        from: S[from].t,
        to: S[to].t,
        threePoint,
        noHand,
        depth,
        chest: chest / (span + 1),
        hips: hips / (span + 1),
        speed: (S[climbEnd].height - S[from].height) / Math.max(1e-6, S[climbEnd].t - S[from].t),
        handMoves: starts[0].length + starts[1].length,
        footMoves: starts[2].length + starts[3].length,
        opposite,
        same,
      },
    ];
  }

  toString() {
    const cm = (m: number) => (m * 100).toFixed(1);
    return (
      this.climbs
        .map(
          (c) =>
            `ladder: off the floor ${c.from.toFixed(2)}–${c.to.toFixed(2)} s, up at ${c.speed.toFixed(2)} m/s; frames with < 3 limbs on it ${c.threePoint}, with no hand ${c.noHand}; ` +
            `deepest into the ladder or wall: ${Object.entries(c.depth).map(([k, d]) => `${k} ${cm(d)}`).join(', ')} cm; out from the rungs: chest ${cm(c.chest)}, hips ${cm(c.hips)} cm; ` +
            `moves: ${c.handMoves} hand, ${c.footMoves} foot, ${c.opposite} foot with the opposite hand, ${c.same} with the same`,
        )
        .join('\n') || 'ladder: none'
    );
  }
}
