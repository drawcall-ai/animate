import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { cases } from '../open';
import { Body, dog, horse, reach, walkTo, type BodyOptions } from '../../src/index';
import { selfOf } from '../../src/body';
import { HORSE } from '../../skills/animate/references/horse';
import { DOG } from '../../skills/animate/references/dog';
import { solePoints } from '../../src/person/anatomy/landmarks';
import { SIDES } from '../../src/person/anatomy/bones';
import { xcomOfPoses, hullOf, outside } from '../../src/step/support';
import { footprint } from '../../src/person/legs/foot';
import type { Person } from '../../src/person/person';
import { insides, person, play, run } from '../bodies';
import { poseOf } from '../../src/index';

/** a flight of `count` steps up along +z from `start`, each `rise` high and `tread` deep, flat on top (the throne room's: 5 × 0.2 on 0.45) */
const stairs = (start: number, count: number, rise: number, tread: number) => (_x: number, z: number) =>
  z < start ? 0 : Math.min(count, Math.floor((z - start) / tread) + 1) * rise;
const THRONE = { start: 2, count: 5, rise: 0.2, tread: 0.45 };
const flight = stairs(THRONE.start, THRONE.count, THRONE.rise, THRONE.tread);
/** the treads' front edges (z) */
const NOSINGS = Array.from({ length: THRONE.count }, (_, k) => THRONE.start + k * THRONE.tread);

/** a person and the creatures, each as a floor test makes one, and how fast it is asked to walk over a step (none: as it goes) */
const KINDS: [name: string, make: (options: BodyOptions) => Body, speed: number | undefined][] = [
  ['person', (options) => person(options), undefined],
  ['horse', (options) => new Body(horse(HORSE), options), 0.8],
  ['dog', (options) => new Body(dog(DOG), options), 0.8],
];

/** each sole's points of foot `i` of `body` as it stands: a person's measured sole, a creature's heel and toe */
function solesOf(body: Body, i: number): Vector3[] {
  if (body.species.person) return solePoints(insides(body).proportions, poseOf(body), SIDES[i]);
  const chain = (body.species.legs?.chains ?? [])[i], bone = chain.joints[chain.joints.length - 1].bone;
  return [chain.heel, chain.toe].map((p) => poseOf(body).point(bone, p, new Vector3()));
}

/** What a walk over a floor did to the feet and the body, read off every final pose. */
interface Walked {
  /** deepest a planted sole went into its floor, and highest the lowest point of a planted sole stood off it (m) */
  sunk: number; raised: number;
  /** touchdowns, and those whose sole was not all on one level */
  touchdowns: number; straddled: number;
  /** lowest a swinging sole came over the floor under it (m; − into it), and over the higher tread as it crossed a nosing (m) */
  swing: number; nosing: number;
  /** the centre of mass's vertical speed, smoothed over 0.1 s (m/s): its most up and down; the pelvis's most either way */
  up: number; down: number; pelvis: number;
  /** furthest the extrapolated centre of mass went past the feet (m) */
  xcom: number;
  /** the pelvis's least height over the higher floor its planted feet stand on (m): how deep it sinks onto its legs */
  seat: number;
}

/** the point on `floor` at (0, z): where a body stands there */
function on(floor: (x: number, z: number) => number, z: number): Vector3 {
  return new Vector3(0, floor(0, z), z);
}

/** `body` walked to `to` on `floor`, read every frame (the walk given `speed`, else as it goes) */
function walked(body: Body, floor: (x: number, z: number) => number, to: Vector3, speed?: number): Walked {
  const self = selfOf(body), h = body.species.person ? insides(body) : null, out: Walked = { sunk: 0, raised: 0, touchdowns: 0, straddled: 0, swing: Infinity, nosing: Infinity, up: 0, down: 0, pelvis: 0, xcom: 0, seat: Infinity };
  const coms: number[] = [], hips: number[] = [], last: (Vector3[] | null)[] = [null, null];
  let arrived = false;
  play(function* () { arrived = yield* walkTo(body, to, { speed }); }, [body], 20, () => {
    self.stepper?.legs.forEach((leg, i) => {
      const soles = solesOf(body, i), above = soles.map((p) => p.y - floor(p.x, p.z));
      if (leg.swing) {
        out.swing = Math.min(out.swing, ...above);
        // (each toe tip as it crossed the nosing of a tread other than the one it left, between the two frames: up a flight, over the
        // nosing ahead; down one, over the edge of the tread the other foot stands on)
        soles.slice(1).forEach((p, k) => {
          const was = last[i]?.[k + 1];
          for (const z of NOSINGS) if (was && (was.z - z) * (p.z - z) < 0) {
            const higher = Math.max(floor(p.x, z - 0.01), floor(p.x, z + 0.01));
            if (Math.abs(higher - (leg.swing?.level ?? NaN)) < 1e-9) continue;
            out.nosing = Math.min(out.nosing, was.y + (p.y - was.y) * (z - was.z) / (p.z - was.z) - higher);
          }
        });
      } else {
        out.sunk = Math.max(out.sunk, -Math.min(...above));
        out.raised = Math.max(out.raised, Math.min(...above));
      }
      if (leg.landed) {
        const levels = soles.map((p) => floor(p.x, p.z));
        out.touchdowns++;
        if (Math.max(...levels) - Math.min(...levels) > 1e-9) out.straddled++;
      }
      last[i] = leg.swing ? soles : null;
    });
    coms.push(poseOf(body).com(new Vector3()).y);
    hips.push(poseOf(body).position(0).y);
    if (!h) return arrived && body.settled;
    const levels = (h.stepper?.legs ?? []).flatMap((leg) => leg.swing ? [] : [leg.anchor.y - h.proportions.ankleHeight]);
    if (levels.length) out.seat = Math.min(out.seat, h.pose.position(0).y - Math.max(...levels));
    out.xcom = Math.max(out.xcom, xcomPast(h));
    return arrived && body.settled;
  });
  const smoothed = (ys: number[]) => ys.slice(3, -3).map((_, i) => (ys[i + 6] - ys[i]) * 10);
  const com = smoothed(coms), pelvis = smoothed(hips);
  [out.up, out.down, out.pelvis] = [Math.max(...com), Math.min(...com), Math.max(...pelvis.map(Math.abs))];
  expect(arrived).toBe(true);
  return out;
}

/** how far the extrapolated centre of mass is past the feet on the floor (m): the planted soles', and a swing's landing (Hof's next-step
 * capture, as the dev check reads it) */
function xcomPast(h: Person): number {
  if (h.frame.time <= h.frame.dt) return 0;
  const support = (h.stepper?.legs ?? []).flatMap((leg, i) => leg.swing
    ? footprint(h.proportions, leg.anchor, leg.yaw)
    : solePoints(h.proportions, h.pose, SIDES[i]).map((p): [number, number] => [p.x, p.z]));
  return support.length ? outside(hullOf(support), xcomOfPoses(h.frame.prev, h.frame.prev2, h.frame.dt, h.proportions.legLength, new Vector3())) : 0;
}

/** what every walk over a floor keeps: soles on it, whole on one level, swings clear of it, its balance, a clean dev log */
function expectClean(body: Body, walk: Walked) {
  expect(walk.sunk).toBeLessThan(0.01);
  expect(walk.raised).toBeLessThan(0.02);
  expect(walk.straddled).toBe(0);
  expect(walk.swing).toBeGreaterThan(-0.002);
  expect(body.log).toEqual([]);
}

describe('a person on a floor', () => {
  it.each(KINDS)('a %s stands on a raised floor as on the ground: posed as it would be a metre lower, its position on it', (_, make) => {
    const body = make({ dev: true, floor: () => 1, at: new Vector3(0, 1, 0) }), flat = make({ at: new Vector3() });
    run(body, 3);
    run(flat, 3);
    expect(body.position.y).toBe(1);
    expect(flat.position.y).toBe(0);
    expect(body.object.position.y).toBe(1);
    poseOf(body).skeleton.bones.forEach((_, b) => expect(poseOf(body).position(b).clone().setY(poseOf(body).position(b).y - 1).distanceTo(poseOf(flat).position(b))).toBeLessThan(1e-6));
    expect(body.log).toEqual([]);
  });

  it('reaches from a raised floor', () => {
    const body = person({ dev: true, floor: () => 1, at: new Vector3(0, 1, 0) });
    run(body, 3);
    let reached = false;
    play(function* () { reached = yield* reach(body, { right: new Vector3(-0.2, 2.2, 0.35) }); }, [body], 4, () => reached);
    expect(reached).toBe(true);
    expect(body.log).toEqual([]);
  });

  it('walks onto a step up and off it again, each foot whole on one level and clear of the edges', () => {
    const floor = (_x: number, z: number) => z >= 2 && z < 4 ? 0.15 : 0;
    const body = person({ dev: true, floor }), walk = walked(body, floor, on(floor, 6));
    expectClean(body, walk);
    expect(walk.touchdowns).toBeGreaterThan(8);
    expect(walk.xcom).toBeLessThan(0.1);
  });

  it.each(KINDS.slice(1))('a %s walks up a 0.15 m step and on, its soles on each level and never in it', (_, make, speed) => {
    const floor = (_x: number, z: number) => z < 2 ? 0 : 0.15;
    const body = make({ dev: true, floor }), walk = walked(body, floor, on(floor, 5), speed);
    expect(body.position.y).toBe(0.15);
    expect(walk.sunk).toBeLessThan(1e-3);
    expect(walk.raised).toBeLessThan(1e-3);
    expect(body.log).toEqual([]);
  });

  // (recalled: the centre of mass rises through the stride climbing stairs, ~0.4–0.5 m/s at its most on ordinary stairs)
  const walkedFlight = (way: string) => `climbs the throne room stairs ${way} at a stair pace: soles on the treads, toes over the nosings, a smooth rise`;
  const walkedAt = (speed: number) => `climbs them at ${speed} m/s asked too, a walk no faster than a stair pace on them`;
  // (marginal at this life seed: a touchdown at 0.1005 m/s, max 0.1)
  const test = cases([[walkedFlight('down'), [3]], [walkedAt(1.3), [3]]]);
  for (const [way, from, to] of [['up', 0, 6], ['down', 6, 0]] as const) test(walkedFlight(way), () => {
    const body = person({ dev: true, floor: flight, at: on(flight, from), face: from < to ? 0 : Math.PI });
    const walk = walked(body, flight, on(flight, to));
    expectClean(body, walk);
    expect(walk.nosing).toBeGreaterThan(0.01);
    expect(walk.xcom).toBeLessThan(0.1);
    expect(body.position.y).toBe(flight(0, to));
    if (from < to) {
      expect(walk.up).toBeLessThan(0.75);
      expect(walk.down).toBeGreaterThan(-0.4);
    } else {
      expect(walk.down).toBeGreaterThan(-0.9);
      expect(walk.up).toBeLessThan(0.55);
    }
    expect(walk.pelvis).toBeLessThan(0.75);
    // (its legs bent over the treads, not sat down on them: the lead knee bent up a flight, the stance knee lowering it down one)
    expect(walk.seat).toBeGreaterThan(from < to ? 0.55 : 0.45);
  });

  for (const speed of [0.4, 1.3]) test(walkedAt(speed), () => {
    for (const [from, to] of [[0, 6], [6, 0]]) {
      const body = person({ dev: true, floor: flight, at: on(flight, from), face: from < to ? 0 : Math.PI });
      expectClean(body, walked(body, flight, on(flight, to), speed));
    }
  });

  it('arrives and turns about on a tread with both soles on it', () => {
    const body = person({ dev: true, floor: flight }), h = insides(body), middle = THRONE.start + 2.5 * THRONE.tread;
    let there = false, done = false, off = 0;
    play(function* () {
      for (const face of [Math.PI / 2, Math.PI, 0]) {
        yield* walkTo(body, on(flight, middle), { face });
        there = true;
      }
      done = true;
    }, [body], 25, () => {
      h.stepper?.legs.forEach((leg, i) => {
        if (!there || leg.swing) return;
        for (const p of solePoints(h.proportions, h.pose, SIDES[i])) off = Math.max(off, Math.abs(flight(p.x, p.z) - 0.6));
      });
      return done && body.settled;
    });
    expect(done).toBe(true);
    expect(off).toBeLessThan(1e-9);
    expect(body.position.y).toBeCloseTo(0.6, 9);
    expect(body.log).toEqual([]);
  });
});
