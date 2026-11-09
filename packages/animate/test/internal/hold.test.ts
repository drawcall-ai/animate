import { Object3D, Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { carry, grab, reach, release, wait } from '../../src/index';
import type { Miss, Request } from '../../src/kernel/requests';
import { coordinatesOf } from '../../src/kernel/limits';
import { pointSegmentDistance } from '../../src/kernel/math';
import { clearBody } from '../../src/person/hands/load-clearance';
import { grasp } from '../../src/things/hold';
import { Thing } from '../../src/things/thing';
import { INDEX, dt, feetOf, person, play, readings, run } from '../kit/bodies';
import { armed, box, empty, roomOf, worldOf } from '../kit/things';
import { insides, palmAt } from './insides';

const BOTH = { left: 'left', right: 'right' } as const;

/** a body wearing 10 kg 30 cm out to its left at the chest, stood a while */
const loaded = () => {
  const body = person(), h = insides(body);
  roomOf(body);
  const load = new Object3D();
  load.userData.mass = 10;
  load.position.set(0.3, 0, 0.2);
  body.bones.chest.add(load);
  run(body, 3);
  return { body, h, load };
};

describe('two hands', () => {
  it('takes and holds a load at hip height standing: its weight shifting over planted feet is no walk', () => {
    // (it once was, which switched the loaded reach's bow off and on every sub-step)
    const body = person({ dev: true }), h = insides(body), room = roomOf(body);
    const load = box(room, new Vector3(0, 0.88, 0.61), { size: new Vector3(0.44, 0.25, 0.3), mass: 5 });
    let planted = 0, walking = 0;
    play(function* () {
      yield* grab(body, load, BOTH);
      yield* carry(body, load, new Vector3(0, 0.93, 0.5), { until: 3 });
    }, [body], 8, () => {
      if (!feetOf(readings(body)).every((foot) => foot.phase === 'planted')) return;
      planted++;
      if (h.locomotion.moving) walking++;
    });
    expect(planted).toBeGreaterThan(400);
    expect(walking).toBe(0);
    expect(body.log).toEqual([]);
  });

});

describe('a load kept clear of the head', () => {
  it.each([0.02, 0.22])('clears a %s m load from the neck→head segment, above the trunk too', (radius) => {
    const body = person(), h = insides(body), room = roomOf(body);
    run(body, 1);
    const size = new Vector3(2, 2, 2).multiplyScalar(radius);
    const thing = Thing.of(box(room, new Vector3(), { size, name: `${radius} m` }));
    const neck = h.pose.position(INDEX.neck), head = h.pose.point(INDEX.head, h.proportions.headCenter, new Vector3());
    const reserve = radius + 0.06 * h.proportions.height;
    for (const part of [0, 0.5, 1]) {
      const at = neck.clone().lerp(head, part);
      clearBody(h, h.frame, thing, at, new Quaternion(), { position: at.clone(), quaternion: new Quaternion() });
      expect(head.distanceTo(at)).toBeGreaterThan(reserve);
      expect(pointSegmentDistance(at, neck, head)).toBeGreaterThan(reserve);
    }
  });

});

describe('a grip taken', () => {
  it.each([false, true])('is checked against the palm as the hand takes it (10 cm off: %s)', (off) => {
    const body = person({ dev: true }), h = insides(body), room = roomOf(body);
    run(body, 0.5);
    const rope = new Object3D(), palm = palmAt(h, 'left');
    rope.name = 'loose rope';
    rope.position.copy(palm).add(new Vector3(off ? 0.1 : 0, 0, 0));
    room.add(rope);
    empty(rope, 'end', new Vector3());
    // (the hand bone a palm back from the end, as a person's grip has it)
    const missed: Miss[] = [];
    grasp(h, 'left', { thing: Thing.of(rope), grip: 'end', goal: { position: h.pose.position(h.hands.left).clone().sub(palm) }, by: { fail: (miss: Miss) => void missed.push(miss) } as Request });
    body.update(dt);
    if (off) expect(missed).toEqual([expect.objectContaining({ off: expect.closeTo(0.1, 1), where: 'loose rope left end' })]);
    else expect(missed).toEqual([]);
  });

});

// (both hands held still out before the shoulders, a little above them: the clavicles go where the hands ask, swaying only with the body's
// breath and sway — shrugged on from where they stood each sub-step, they rose 30–40° up their range)
it('holds the clavicles where still hands ask, not shrugging them on, on both sides', () => {
  const body = person({ dev: true }), h = insides(body);
  run(body, 0.5);
  const targets = (['left', 'right'] as const).map((side) => body.armPoint(side, new Vector3(0, 0.15, 1), 0.85));
  // (each clavicle's protraction and elevation, °, the left's signs for both)
  const clavicles = () => (['left', 'right'] as const).map((side) => {
    const bone = INDEX[`${side}Shoulder`], [protraction, elevation] = coordinatesOf(h.pose.local(bone), h.pose.skeleton.limits[bone]!).value;
    return [protraction, elevation].map((x) => (side === 'left' ? x : -x) / (Math.PI / 180));
  });
  const seen: number[][][] = [];
  play(function* () { yield* reach(body, { left: targets[0], right: targets[1] }, { until: Infinity }); }, [body], 6, (time) => {
    if (time >= 2) seen.push(clavicles());
  });
  for (const [k, side] of (['left', 'right'] as const).entries()) {
    const elevations = seen.map((c) => c[k][1]), protractions = seen.map((c) => c[k][0]);
    expect(Math.max(...elevations), `${side} elevation`).toBeLessThan(20);
    expect(Math.max(...elevations) - Math.min(...elevations), `${side} elevation`).toBeLessThan(8);
    expect(Math.max(...protractions) - Math.min(...protractions), `${side} protraction`).toBeLessThan(8);
    expect(worldOf(body.bones[`${side}Hand`]).distanceTo(targets[k]), side).toBeLessThan(0.01);
  }
  expect(body.log).toEqual([]);
});

describe('what a body wears', () => {
  it('counts worn mass at its location and balances it over planted feet', () => {
    const { body, h, load } = loaded();
    const pose = h.pose;
    const segments = pose.skeleton.bones.reduce((sum, bone, i) => sum.addScaledVector(pose.point(i, bone.com, new Vector3()), bone.mass), new Vector3());
    const mass = pose.skeleton.bones.reduce((sum, bone) => sum + bone.mass, 0);
    expect(pose.com(new Vector3()).distanceTo(segments.addScaledVector(worldOf(load), 10).divideScalar(mass + 10))).toBeLessThan(1e-6);
    expect(h.borne.get([...h.borne.keys()][0])?.kg).toBeCloseTo(10, 6);
    const feet = feetOf(readings(body))[0].position.clone().add(feetOf(readings(body))[1].position).multiplyScalar(0.5);
    expect(Math.abs(h.pose.com(new Vector3()).x - feet.x)).toBeLessThan(0.02);
  });

  it('counts what it wears from its first sub-step, where it is then', () => {
    const body = person(), h = insides(body);
    roomOf(body);
    const before = h.pose.com(new Vector3());
    const load = new Object3D();
    load.userData.mass = 8;
    load.position.set(0.2, 0, 0);
    body.bones.chest.add(load);
    body.update(1 / 60);
    expect(h.borne.get([...h.borne.keys()][0])?.kg).toBe(8);
    expect(h.pose.com(new Vector3()).distanceTo(before)).toBeGreaterThan(0.01);
  });

  it('bears what it carries off its support, and none of it once it is put down', () => {
    const body = person(), h = insides(body), room = roomOf(body);
    const taken = new Vector3(0, 1.0, 0.4);
    const load = box(room, taken, { mass: 4, solid: false });
    const kg = { carried: -1, down: -1 };
    let done = false;
    play(function* () {
      yield* grab(body, load, { left: 'left', right: 'right' });
      yield* carry(body, load, new Vector3(0, 1.05, 0.35));
      yield* wait(1);
      kg.carried = [...h.borne.values()][0]?.kg ?? 0;
      yield* carry(body, load, taken);
      release(body, load);
      yield* wait(1);
      kg.down = [...h.borne.values()][0]?.kg ?? 0;
      done = true;
    }, [body], 12, () => done);
    expect(kg.carried).toBeCloseTo(4, 3);
    expect(kg.down).toBe(0);
    expect(h.borne.size).toBe(0);
  });

  it('keeps a rifle on its chest at the aim its app gives while it turns, both hands on its grips', () => {
    const { root, body, rifle, grips, aim, orient } = armed((_, root) => root.yaw), h = insides(body);
    let aimed = 0, gripped = 0;
    // (the chest turns within each update: a mount the app turned from the chest as it stood before it was off the aim by that turn)
    for (let frame = 0; frame < 180; frame++) {
      root.yaw += 2 / 60;
      orient();
      body.update(1 / 60);
      aimed = Math.max(aimed, rifle.getWorldQuaternion(new Quaternion()).angleTo(aim()));
      for (const side of ['left', 'right'] as const) gripped = Math.max(gripped, palmAt(h, side).distanceTo(worldOf(grips[side])));
    }
    expect(aimed).toBeLessThan(1e-6);
    expect(gripped).toBeLessThan(0.005);
  });

});

