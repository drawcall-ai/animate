import { Vector3 } from 'three';
import { parallel } from '@pmndrs/timeline';
import { describe, expect, it } from 'vitest';
import { Body, humanoid, walkTo, type Stride } from '../../src/index';
import { PERSON } from '../../skills/animate/references/person';
import { insides, play } from '../bodies';
import { individualOf } from '../../src/legs/person/individual';

// A person's cadence is dynamically similar to its legs' length, and its stride can be styled.

/** how a person walked over the steady stretch of a walk up +Z */
interface Gait {
  /** steps a minute */
  cadence: number;
  /** its feet's touchdowns (s) */
  touchdowns: number[];
  /** the feet's mean lateral spacing at a touchdown (m), and the landing foot's mean turn out from the way it walks (rad) */
  width: number;
  toeOut: number;
  /** the pelvis's vertical and lateral range (m) */
  bob: number;
  sway: number;
}

/** `bodies` walked side by side up +Z at `speed` (m/s), each measured from `from` s to `to` s */
function walked(bodies: readonly Body[], speed: number, from = 3, to = 15): Gait[] {
  const seen = bodies.map(() => ({ touchdowns: [] as number[], width: 0, toeOut: 0, low: Infinity, high: -Infinity, left: Infinity, right: -Infinity }));
  const swinging = bodies.map(() => [false, false]);
  const story = () => parallel('all', ...bodies.map((body) => walkTo(body, new Vector3(body.position.x, 0, 40), { speed, until: Infinity })));
  play(story, bodies, to, (time) => {
    bodies.forEach((body, i) => {
      const h = insides(body), legs = h.stepper?.legs ?? [], pelvis = h.pose.position(0), at = seen[i];
      legs.forEach((leg, side) => {
        const was = swinging[i][side];
        swinging[i][side] = !!leg.swing;
        if (time < from || !was || leg.swing) return;
        at.touchdowns.push(time);
        at.width += Math.abs(leg.anchor.x - legs[1 - side].anchor.x);
        at.toeOut += Math.abs(leg.yaw);
      });
      if (time < from) return;
      [at.low, at.high, at.left, at.right] = [Math.min(at.low, pelvis.y), Math.max(at.high, pelvis.y), Math.min(at.left, pelvis.x), Math.max(at.right, pelvis.x)];
    });
  });
  return seen.map(({ touchdowns, width, toeOut, low, high, left, right }) => ({
    cadence: 60 * (touchdowns.length - 1) / (touchdowns[touchdowns.length - 1] - touchdowns[0]),
    touchdowns, width: width / touchdowns.length, toeOut: toeOut / touchdowns.length, bob: high - low, sway: right - left,
  }));
}

/**
 * The cadence a person keeps (steps a minute) at `speed` (m/s) on legs `legs` × the default body's: the default body's 1.75 + 0.3 v steps
 * a second, dynamically similar — its pace v / √legs, its cadence that one's / √legs
 */
const target = (speed: number, legs: number) => 60 * (1.75 + 0.3 * speed / Math.sqrt(legs)) / Math.sqrt(legs);

/** the life seed the people here are made with: their individual cadence is `individualOf(SEED)`'s */
const SEED = 7;

/** a person `height` m tall (the default person scaled, its legs × height / 1.75), `x` m to the side, striding as `stride` has it */
function sized(height: number, x = 0, stride?: Stride): Body {
  const k = height / 1.75;
  const skeleton = PERSON.map((bone) => ({ ...bone, position: [bone.position[0] * k, bone.position[1] * k, bone.position[2] * k] as const }));
  return new Body(humanoid(skeleton, { stride }), { dev: true, at: new Vector3(x, 0, 0), life: { seed: SEED } });
}

describe('a person\'s cadence', () => {
  it('differs with its legs: three people of 1.55, 1.75 and 2.1 m walking abreast at 1 m/s step out of phase, the tallest slowest', () => {
    const bodies = [sized(1.55, 1.2), sized(1.75), sized(2.1, -1.4)];
    const [short, middle, tall] = walked(bodies, 1);
    expect(short.cadence).toBeGreaterThan(middle.cadence * 1.05);
    expect(middle.cadence).toBeGreaterThan(tall.cadence * 1.05);
    // (out of phase: over the stretch, each one's touchdowns drift across the others' — a touchdown near one of the middle one's,
    // and one half a step from any)
    for (const other of [short, tall]) {
      const offsets = other.touchdowns.map((t) => Math.min(...middle.touchdowns.map((m) => Math.abs(t - m))));
      expect(Math.min(...offsets)).toBeLessThan(0.06);
      expect(Math.max(...offsets)).toBeGreaterThan(0.15);
    }
    for (const body of bodies) expect(body.log).toEqual([]);
  });

  it.each([[1.75, 0.6], [1.75, 1.3], [1.55, 0.9], [2.1, 0.9], [2.1, 1.4]])('keeps the dynamically similar cadence: %s m tall at %s m/s', (height, speed) => {
    const body = sized(height), [gait] = walked([body], speed);
    expect(gait.cadence / (target(speed, height / 1.75) * individualOf(SEED).cadence)).toBeCloseTo(1, 1);
    expect(body.log).toEqual([]);
  });
});

describe('a person\'s stride', () => {
  // (each measured against the same person walking unstyled at the same pace)
  const plain = walked([sized(1.75)], 1.2)[0];

  // (a style's cadence is a multiplier on the cadence its balance may still quicken: a wider landing is caught sooner)
  it('swaggers: slower steps, wider apart and turned out, the pelvis swaying further', () => {
    const body = sized(1.75, 0, { cadence: 0.8, width: 1.3, toeOut: 1.3 }), [gait] = walked([body], 1.2);
    expect(gait.cadence).toBeLessThan(plain.cadence * 0.98);
    expect(gait.width).toBeGreaterThan(plain.width + 0.03);
    expect(gait.toeOut).toBeGreaterThan(plain.toeOut * 1.2);
    expect(gait.sway).toBeGreaterThan(plain.sway * 1.15);
    expect(body.log).toEqual([]);
  });

  it('lumbers: slower, its pelvis bobbing more, its feet wider apart and its body swaying over them', () => {
    const body = sized(1.75, 0, { cadence: 0.85, width: 1.25, bob: 1.4 }), [gait] = walked([body], 1.2);
    expect(gait.cadence).toBeLessThan(plain.cadence * 0.95);
    expect(gait.bob).toBeGreaterThan(plain.bob * 1.3);
    expect(gait.width).toBeGreaterThan(plain.width + 0.03);
    expect(gait.sway).toBeGreaterThan(plain.sway * 1.15);
    expect(body.log).toEqual([]);
  });
});



describe('people of one build', () => {
  // (each its own: its individuality seeded by where it was made, as its idle life is, unless a life seed is given)
  // (two given their own life seeds, 3 and 11, whose cadences are 4.8% apart at the spreads first given: placed anywhere, two may be
  // all but alike — at a 2% spread, a quarter of pairs within 1%; their cadences differ as their individualities do)
  it('walk side by side out of step: their cadences differ as they are, and their touchdowns drift across each other', () => {
    const person = (x: number, seed: number) => new Body(humanoid(PERSON), { dev: true, at: new Vector3(x, 0, 0), life: { seed } });
    const bodies = [person(0.7, 3), person(-0.7, 11)];
    const [a, b] = walked(bodies, 1.2), own = individualOf(11).cadence / individualOf(3).cadence;
    expect(Math.abs(own - 1)).toBeGreaterThan(0.01);
    // (as much as half again or as little as half their own difference: their strides vary by `STRIDES` one to the next, and a balance
    // quickens a step as it needs)
    expect((b.cadence / a.cadence - 1) / (own - 1)).toBeGreaterThan(0.5);
    expect((b.cadence / a.cadence - 1) / (own - 1)).toBeLessThan(1.5);
    const offsets = b.touchdowns.map((t) => Math.min(...a.touchdowns.map((m) => Math.abs(t - m))));
    expect(Math.max(...offsets) - Math.min(...offsets)).toBeGreaterThan(0.1);
    for (const body of bodies) expect(body.log).toEqual([]);
  });

  it('stand in a crowd without swaying or glancing in step', () => {
    const bodies = [0, 1, 2, 3, 4].map((k) => new Body(humanoid(PERSON), { dev: true, at: new Vector3(k * 0.8, 0, 0) }));
    const sways = bodies.map(() => [] as number[]), heads = bodies.map(() => [] as number[]);
    play(function* () { yield* (function* () {})(); }, bodies, 25, () => {
      bodies.forEach((body, i) => {
        const h = insides(body);
        sways[i].push(h.pose.com(new Vector3()).x);
        heads[i].push(new Vector3(0, 0, 1).applyQuaternion(h.pose.rotation(h.pose.skeleton.index('head'))).x);
      });
    });
    /** the correlation of how two series move, sub-step to sub-step, over their last 20 s (a weight shift each, made at its own moment,
     * is a step each way that would correlate whenever made) */
    const correlation = (p: number[], q: number[]) => {
      const moves = (v: number[]) => v.slice(-1201).slice(1).map((a, k) => a - v.slice(-1201)[k]);
      const [x, y] = [moves(p), moves(q)], mean = (v: number[]) => v.reduce((sum, a) => sum + a, 0) / v.length;
      const [mx, my] = [mean(x), mean(y)];
      const cov = x.reduce((sum, a, k) => sum + (a - mx) * (y[k] - my), 0);
      return cov / Math.sqrt(x.reduce((sum, a) => sum + (a - mx) ** 2, 0) * y.reduce((sum, a) => sum + (a - my) ** 2, 0));
    };
    // (over the ten pairs: mostly unlike, and none alike. Two of five shifting their weight within a second of each other — as likely as
    // not in a 10 s window for the first — move alike for seconds after, and a 20 s drift of a few slow cycles correlates by chance: a
    // pair at 0.93 is that, not a crowd in step)
    const pairs = [0, 1, 2, 3, 4].flatMap((i) => [0, 1, 2, 3, 4].filter((j) => j > i).map((j) => [i, j]));
    const median = (v: number[]) => [...v].sort((a, b) => a - b)[v.length >> 1];
    for (const [name, series] of [['sway', sways], ['glances', heads]] as const) {
      const r = pairs.map(([i, j]) => Math.abs(correlation(series[i], series[j])));
      expect(median(r), name).toBeLessThan(0.3);
      expect(Math.max(...r), name).toBeLessThan(0.97);
    }
    for (const body of bodies) expect(body.log).toEqual([]);
  });
});
