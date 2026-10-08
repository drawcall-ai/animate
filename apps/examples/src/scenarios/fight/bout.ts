import type { Humanoid } from '@prohuman/core';
import { jointOf } from '../../joints';
import { leftOf, random } from '../../math';
import { isKick, MOVES, other, STRENGTH, type Defence, type Move, type LeftRight, type Strike, type Who } from './moves';

const COMBOS: [Strike, LeftRight][][] = [
  [['jab', 'left']],
  [['jab', 'left'], ['cross', 'right']],
  [['jab', 'left'], ['jab', 'left'], ['cross', 'right']],
  [['jab', 'left'], ['cross', 'right'], ['hook', 'left']],
  [['body', 'right'], ['hook', 'left']],
  [['cross', 'right'], ['hook', 'left']],
  [['uppercut', 'right'], ['hook', 'left']],
  [['roundhouse', 'right']],
  [['frontKick', 'right']],
];

/** body velocity change per unit of hit strength (m/s) */
const PUSH = 0.45;
/** no new combos after this (s) */
const LAST_ATTACK = 14.5;

interface Fighter {
  nextAttack: number;
  busyUntil: number;
  /** footwork: range changes (step in +, out −) starting at `at` */
  steps: { at: number; dist: number }[];
  aggression: number;
}

/** a strike reaching the defender `who` at `at` */
interface Hit {
  at: number;
  who: Who;
  kind: Strike;
  landed: boolean;
}

/**
 * What happens in the fight: each fighter picks combos at irregular moments; the other
 * perceives each strike after a human reaction time and defends — or is too late and gets
 * hit. A seeded RNG keeps every run identical.
 */
export class Bout {
  readonly fighters: [Fighter, Fighter];
  /** every move either fighter has made or scheduled, in the order they were decided */
  readonly moves: Move[] = [];
  private hits: Hit[] = [];
  private readonly rand = random(7);

  constructor() {
    this.fighters = [this.fighter(0, 1.0), this.fighter(1, 0.85)];
  }

  /** start combos: whoever is ready, and standing on both feet, attacks */
  decide(t: number, actors: Humanoid[]) {
    for (const who of [0, 1] as const) {
      const f = this.fighters[who];
      const planted = actors[who].feet.every((ft) => ft.phase === 'planted');
      if (t >= f.nextAttack && t >= f.busyUntil && t < LAST_ATTACK && planted) this.combo(t, who);
    }
  }

  /** hits arriving by `t` push the defender: a landed one hard (and it stuns), one on the guard lightly */
  land(t: number, actors: Humanoid[]) {
    const due = this.hits.filter((h) => t >= h.at);
    this.hits = this.hits.filter((h) => t < h.at);
    for (const h of due) {
      const def = actors[h.who];
      const att = actors[other(h.who)];
      const dir = jointOf(def, 'hips').sub(jointOf(att, 'hips')).setY(0).normalize();
      if (!h.landed) {
        def.push(dir.multiplyScalar(PUSH * 0.2), 'chest');
        continue;
      }
      if (h.kind === 'hook') dir.add(leftOf(att.yaw).multiplyScalar(-0.8)).normalize();
      const head = !isKick(h.kind) && h.kind !== 'body';
      def.push(dir.multiplyScalar(PUSH * STRENGTH[h.kind]), head ? 'head' : 'chest');
      const f = this.fighters[h.who];
      f.busyUntil = Math.max(f.busyUntil, t + 0.5);
      f.nextAttack = Math.max(f.nextAttack, t + 0.6);
    }
  }

  private between(a: number, b: number) {
    return a + (b - a) * this.rand();
  }

  private fighter(who: Who, aggression: number): Fighter {
    return { nextAttack: 0.8 + who * 0.9 + this.between(0, 0.4), busyUntil: 0, steps: [], aggression };
  }

  private combo(t: number, who: Who) {
    const f = this.fighters[who];
    const combo = COMBOS[Math.floor(this.rand() * COMBOS.length)];
    let at = t;
    const kicking = combo.some(([k]) => isKick(k));
    // step in to punching range, step out after (kicks already reach from here)
    if (!kicking) f.steps.push({ at: at - 0.05, dist: 0.16 });
    const handFree: Record<LeftRight, number> = { left: at, right: at };
    for (const [kind, side] of combo) {
      // the same fist goes again only once it's (nearly) back in guard
      at = Math.max(at, handFree[side]);
      const end = this.strike(at, who, kind, side);
      handFree[side] = end - 0.06;
      at = Math.max(at + this.between(0.26, 0.38), end - 0.18);
      if (isKick(kind)) at = end;
    }
    if (!kicking) f.steps.push({ at: at + 0.1, dist: -0.16 });
    f.busyUntil = at + 0.3;
    f.nextAttack = at + this.between(1.0, 2.2) / f.aggression;
  }

  /** schedules a strike and the opponent's perceived reaction; returns when the strike is over */
  private strike(t: number, who: Who, kind: Strike, side: LeftRight): number {
    const [rise, hold, fall] = MOVES[kind].timing;
    const arrive = t + rise;
    const def = other(who);
    const react = t + this.between(0.17, 0.32);
    const defence = this.defend(kind);
    const defRise = defence === 'step' ? 0.2 : MOVES[defence].timing[0];
    // too slow, or simply beaten: the shot lands
    const inTime = react + defRise * 0.7 <= arrive + (isKick(kind) ? 0.3 : 0.02);
    const landed = !inTime || this.rand() < 0.2;
    this.moves.push({ at: t, who, kind, side, landed });
    if (!landed || this.rand() < 0.5) {
      const defSide: LeftRight = kind === 'hook' || side === 'left' ? 'right' : 'left';
      if (defence === 'step') this.fighters[def].steps.push({ at: react, dist: -0.25 });
      else this.moves.push({ at: react, who: def, kind: defence, side: defSide, landed: false });
    }
    this.hits.push({ at: arrive, who: def, kind, landed });
    // a good defence invites a counter
    if (!landed && this.rand() < 0.55) this.fighters[def].nextAttack = Math.min(this.fighters[def].nextAttack, arrive + this.between(0.12, 0.35));
    return arrive + hold + fall;
  }

  /** the defence against a strike: a guard, a head movement, or a step back */
  private defend(kind: Strike): Defence | 'step' {
    const r = this.rand();
    if (isKick(kind)) return r < 0.5 ? 'blockBody' : 'step';
    if (kind === 'body') return 'blockBody';
    if (kind === 'hook') return r < 0.5 ? 'duck' : 'block';
    if (kind === 'uppercut') return r < 0.6 ? 'lean' : 'block';
    return r < 0.45 ? 'block' : r < 0.8 ? 'slip' : 'parry';
  }
}
