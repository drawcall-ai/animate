import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { Body, humanoid } from '../../src/index';
import { PERSON } from '../../skills/animate/references/person';
import { play, readings } from '../kit/bodies';
import { sized, walked } from '../kit/gait';

// A person's cadence is dynamically similar to its legs' length, and its stride can be styled.

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

  it('stand in a crowd without swaying or glancing in step', () => {
    const bodies = [0, 1, 2, 3, 4].map((k) => new Body(humanoid(PERSON), { dev: true, at: new Vector3(k * 0.8, 0, 0) }));
    const sways = bodies.map(() => [] as number[]), heads = bodies.map(() => [] as number[]);
    play(function* () { yield* (function* () {})(); }, bodies, 25, () => {
      bodies.forEach((body, i) => {
        const h = readings(body);
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
    // (and they do look aside: not a crowd all eyes ahead)
    expect(Math.max(...heads[0].map((x, k) => Math.abs(x - heads[1][k])))).toBeGreaterThan(0.19);
    for (const body of bodies) expect(body.log).toEqual([]);
  });
});
