import { Object3D, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { selfOf } from '../../src/body';
import { finder } from '../../src/things/target';
import { dt, person, run } from '../kit/bodies';
import { roomOf } from '../kit/things';
import { claim, insides } from './insides';

describe('requests', () => {
  it("only the request that has a part moves it; the legs' others keep their count, unheard", () => {
    const body = person(), h = insides(body);
    const runs = { trunk: [0, 0], legs: [0, 0] };
    const borrowed = claim(body, 'trunk', () => void runs.trunk[0]++, 'borrowed');
    const asked = claim(body, 'trunk', () => void runs.trunk[1]++);
    claim(body, 'legs', () => void runs.legs[0]++, 'borrowed');
    claim(body, 'legs', () => {
      runs.legs[1]++;
      return { to: new Vector3(0, 0, 1), speed: 1, accel: 1 };
    });
    run(body, 0.5);
    expect(runs.trunk).toEqual([0, 30]);
    expect(runs.legs).toEqual([30, 30]);
    expect(h.asks.legGoal?.to.z).toBe(1);
    asked();
    run(body, 0.5);
    expect(runs.trunk).toEqual([30, 30]);
    borrowed();
  });

});

describe('targets', () => {
  it("a function's object is found where it leaves it each sub-step, not eased across the update", () => {
    const body = person(), room = roomOf(body), marker = new Object3D();
    room.add(marker);
    const find = finder(selfOf(body), (time) => {
      marker.position.set(time, 1, 1);
      return marker;
    });
    const off: number[] = [];
    claim(body, 'look', (f) => void off.push(Math.abs(find(f).position.x - f.time)), 'borrowed');
    body.update(dt);
    body.update(4 * dt);
    expect(Math.max(...off)).toBeLessThan(1e-9);
  });

});

