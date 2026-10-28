import { Vector3 } from 'three';
import { parallel } from '@pmndrs/timeline';
import { describe, expect, it } from 'vitest';
import { Body, humanoid, walkTo, type Stride } from '../../src/index';
import { PERSON } from '../../skills/animate/references/person';
import { insides, play } from '../bodies';

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

/** a person `height` m tall (the default person scaled, its legs × height / 1.75), `x` m to the side, striding as `stride` has it */
function sized(height: number, x = 0, stride?: Stride): Body {
  const k = height / 1.75;
  const skeleton = PERSON.map((bone) => ({ ...bone, position: [bone.position[0] * k, bone.position[1] * k, bone.position[2] * k] as const }));
  return new Body(humanoid(skeleton, { stride }), { dev: true, at: new Vector3(x, 0, 0), life: { seed: 7 } });
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
    expect(gait.cadence / target(speed, height / 1.75)).toBeCloseTo(1, 1);
    expect(body.log).toEqual([]);
  });
});

describe('a person\'s stride', () => {
  // (each measured against the same person walking unstyled at the same pace)
  const plain = walked([sized(1.75)], 1.2)[0];

  // (a style's cadence is a multiplier on the cadence its balance may still quicken: a wider landing is caught sooner)
  it('swaggers: slower steps, wider apart and turned out, the pelvis swaying further', () => {
    const body = sized(1.75, 0, { cadence: 0.85, width: 1.3, toeOut: 1.3 }), [gait] = walked([body], 1.2);
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

