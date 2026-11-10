import { describe, expect, it } from 'vitest';
import { Body, humanoid } from '../../src/index';
import { PERSON } from '../../skills/animate/references/person';
import { dt, feetOf, person, readings, run } from '../kit/bodies';
import { claim, personSelf } from './self';

describe('balance', () => {
  it('stands its soles flat on hips set ahead of its root, their reach measured from where they are', () => {
    const skeleton = PERSON.map((bone) => {
      const position: [number, number, number] = [...bone.position];
      if (bone.name.endsWith('UpperLeg')) position[2] += 0.04;
      return { ...bone, position };
    });
    const body = new Body(humanoid(skeleton), { dev: true, life: { seed: 1 } }), h = personSelf(body);
    let most = 0;
    run(body, 5, () => { most = Math.max(most, ...(h.stepper?.legs ?? []).map((leg) => Math.abs(leg.pitch))); });
    expect(most).toBe(0);
  });

  it('stands still where it starts, its feet planted, and reads and clears what it is asked every sub-step', () => {
    const asked: number[] = [];
    const body = person(), h = personSelf(body), r = readings(body);
    claim(body, 'trunk', () => void (asked.push(h.asks.lower), h.asks.add({ lower: 0.01 })));
    body.update(dt);
    const start = feetOf(r).map((f) => f.position.clone());
    run(body, 2);
    expect(feetOf(r).every((f, s) => f.phase === 'planted' && f.position.equals(start[s]))).toBe(true);
    expect(h.locomotion.settled).toBe(true);
    // (cleared by balance before each sub-step's tasks ask again)
    expect(asked.every((x) => x === 0)).toBe(true);
  });

});

