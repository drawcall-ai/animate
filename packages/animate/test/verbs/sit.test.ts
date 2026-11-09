import { Object3D, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { parallel } from '@pmndrs/timeline';
import { attempt, Body, dog, humanoid, lookAt, Missed, play, reach, sit, stand, wait, walkTo } from '../../src/index';
import { DOG } from '../../skills/animate/references/dog';
import { PERSON } from '../../skills/animate/references/person';
import { person, insides } from '../bodies';

const seatAt = (height: number) => { const seat = new Object3D(); seat.position.y = height; seat.updateMatrixWorld(true); return seat; };

describe('sit', () => {
  it.each([[0, 3], [0, -3], [3, 0.3]])('comes from (%d, %d), sits with its hips over the seat and its feet still, and walks away clean', (x, z) => {
    const body = person({ dev: true, at: new Vector3(x, 0, z), life: { seed: 1 } }), seat = seatAt(0.45), hips = new Vector3();
    let up = 0;
    play(body, function* () {
      yield* sit(body, seat);
      hips.copy(body.bones.hips.getWorldPosition(new Vector3()));
      up = body.bones.head.getWorldPosition(new Vector3()).y - hips.y;
      yield* lookAt(body, new Vector3(-2, 1.6, 2), { until: 1 });
      yield* reach(body, { right: new Vector3(-0.3, 0.85, 0.45) }, { step: false });
      yield* walkTo(body, new Vector3(0, 0, 3));
    });
    expect(Math.hypot(hips.x, hips.z)).toBeLessThan(0.01);
    expect(hips.y - 0.45).toBeCloseTo(0.09, 2);
    expect(up).toBeGreaterThan(0.58);
    expect(insides(body).seat).toBeNull();
    expect(body.log).toEqual([]);
  });

  it('stands where it sat', () => {
    const body = person({ dev: true, at: new Vector3(0, 0, 2), life: { seed: 1 } });
    play(body, function* () {
      yield* sit(body, seatAt(0.45));
      const feet = body.feet.map((foot) => foot.position.clone());
      yield* stand(body);
      body.feet.forEach((foot, i) => expect(foot.position.distanceTo(feet[i])).toBeLessThan(1e-6));
    });
    expect(body.bones.hips.getWorldPosition(new Vector3()).y).toBeGreaterThan(0.9);
    expect(body.log).toEqual([]);
  });

  it.each([[3, /out of reach/], [0.1, /too low/]])('misses a seat %d m high', (height, why) => {
    const body = person({ at: new Vector3(0, 0, 2) });
    const { result } = play(body, function* () { return yield* attempt(sit(body, seatAt(height))); });
    expect(result?.why).toMatch(why);
  });

  it('misses a seat with no level floor before it', () => {
    const body = person({ at: new Vector3(0, 0, 2), floor: (_, z) => (z > 0.45 && z < 0.9 ? 0.3 : 0) });
    const { result } = play(body, function* () { return yield* attempt(sit(body, seatAt(0.45))); });
    expect(result?.why).toMatch(/no room/);
  });

  it('a reach beyond the arm, step by default, stands it and walks it there', () => {
    const body = person({ dev: true, at: new Vector3(0, 0, 2), life: { seed: 1 } }), at = new Vector3(-0.2, 1.1, -2);
    play(body, function* () {
      yield* sit(body, seatAt(0.45));
      yield* reach(body, { right: at });
    });
    expect(insides(body).seat).toBeNull();
    expect(body.bones.rightHand.getWorldPosition(new Vector3()).distanceTo(at)).toBeLessThan(0.03);
    expect(body.log).toEqual([]);
  });

  it('a newer walk taking the legs stalls its walk there, and it misses saying so', () => {
    const body = person({ at: new Vector3(0, 0, 2) });
    const { result } = play(body, () => attempt(parallel('all', sit(body, seatAt(0.45)), walkTo(body, new Vector3(4, 0, 2), { until: Infinity }))), { limit: 20 });
    expect(result?.why).toMatch(/walkTo \(sit\.test\.ts:\d+\) took the legs from it/);
  });

  it('cut short by its `until`, it ends false and is left standing; seated by then, true', () => {
    const body = person({ at: new Vector3(0, 0, 2), life: { seed: 1 } });
    expect(play(body, sit(body, seatAt(0.45), { until: 1 })).result).toBe(false);
    expect(insides(body).seat).toBeNull();
    const sat = person({ at: new Vector3(0, 0, 2), life: { seed: 1 } });
    expect(play(sat, sit(sat, seatAt(0.45), { until: 8 })).result).toBe(true);
    expect(insides(sat).seat?.seated).toBe(true);
  });

  it('asked of its legs as it sits, it misses saying so and stands', () => {
    const body = person({ at: new Vector3(0, 0, 0.6), life: { seed: 1 } });
    const { result } = play(body, () => attempt(parallel('all', sit(body, seatAt(0.45)), function* () {
      yield* wait(() => insides(body).seat !== null);
      yield* wait(0.3);
      yield* stand(body);
    })));
    expect(result).toBeInstanceOf(Missed);
    expect(result?.why).toMatch(/legs were asked elsewhere/);
    expect(insides(body).seat?.rising).toBe(true);
  });

  it.each([1.5, 2.2])('a body %d m tall sits and stands clean, its seat as high for it', (height) => {
    const share = height / 1.75;
    const scaled = PERSON.map((bone) => ({ ...bone, position: bone.position.map((x) => x * share) as unknown as typeof bone.position })) as unknown as typeof PERSON;
    const body = new Body(humanoid(scaled), { dev: true, at: new Vector3(0, 0, 2), life: { seed: 1 } });
    play(body, function* () {
      yield* sit(body, seatAt(0.45 * share));
      yield* stand(body);
      yield* walkTo(body, new Vector3(0, 0, 3));
    });
    expect(body.log).toEqual([]);
  });

  it('a creature does not sit, a driven body neither', () => {
    const pup = new Body(dog(DOG));
    expect(() => sit(pup, new Vector3())).toThrow(/does not sit; a person does/);
    expect(() => stand(pup)).toThrow(/does not sit/);
    const driven = person({ drive: () => ({ position: new Vector3(), velocity: new Vector3(), yaw: 0 }) });
    expect(() => play(driven, sit(driven, seatAt(0.45)))).toThrow(/drives it/);
  });

  it('standing, `stand` ends at once', () => {
    const body = person();
    expect(play(body, stand(body)).time).toBeLessThan(0.1);
  });
});
