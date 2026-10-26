import { Vector3 } from 'three';
import { parallel } from '@pmndrs/timeline';
import { describe, expect, it } from 'vitest';
import { Body, carry, dog, grab, horse, lookAt, release, wait, walkTo } from '../../src/index';
import { insides, person, play } from '../bodies';
import { DOG } from '../skeletons/dog';
import { HORSE } from '../skeletons/horse';
import { box, empty, roomOf, worldOf } from '../things';

describe('bodies together', () => {
  it('hands a box over: one carries it out, the other takes it from those hands, the first lets go into them', () => {
    const giver = person({ dev: true }), taker = person({ dev: true, at: new Vector3(0, 0, 1.6), face: Math.PI });
    const room = roomOf(giver, taker);
    const load = box(room, new Vector3(0, 0.9, 0.45), { mass: 2, solid: false });
    const shelf = empty(room, 'shelf', new Vector3(0.8, 1.0, 1.2));
    const steps: string[] = [];
    play(function* () {
      yield* grab(giver, load, { left: 'left', right: 'right' });
      // (held out between them, the giver keeping it there as the taker's hands come on it)
      yield* parallel('race', carry(giver, load, new Vector3(0, 1.05, 0.8), { until: Infinity }), function* () {
        yield* wait(1.5);
        steps.push(`taken ${yield* grab(taker, load, { left: 'right', right: 'left' })}`);
      });
      release(giver, load);
      steps.push(insides(taker).carried.has(load) ? 'the taker moves it' : 'nobody moves it');
      steps.push(`carried ${yield* carry(taker, load, shelf)}`);
    }, [giver, taker], 15, () => steps.length === 3);
    expect(steps).toEqual(['taken true', 'the taker moves it', 'carried true']);
    expect(giver.holds(load)).toBe(false);
    expect(taker.holds(load)).toBe(true);
    expect(worldOf(load).distanceTo(worldOf(shelf))).toBeLessThan(0.01);
    expect([...giver.log, ...taker.log]).toEqual([]);
  }, 20000);

  it('a dog fetches a stick to a person, who takes it from its jaw', () => {
    const owner = person({ dev: true, at: new Vector3(0, 0, -1.5) });
    const labrador = new Body(dog(DOG), { dev: true, at: new Vector3(0, 0, 0.5), face: Math.PI });
    const room = roomOf(owner, labrador);
    const stick = box(room, new Vector3(0.3, 0.03, 3), { size: new Vector3(0.04, 0.04, 0.5), mass: 0.2, solid: false, name: 'stick' });
    empty(stick, 'middle', new Vector3()).userData.free = true;
    const steps: string[] = [];
    play(function* () {
      steps.push(`fetched ${yield* grab(labrador, stick, { jaw: 'middle' })}`);
      steps.push(`brought ${yield* carry(labrador, stick, new Vector3(0, 0.55, -0.9))}`);
      steps.push(`taken ${yield* grab(owner, stick, { right: 'right' })}`);
      release(labrador, stick);
      steps.push(stick.parent === owner.bones.rightHand ? 'in the owner\'s hand' : 'elsewhere');
    }, [owner, labrador], 30, () => steps.length === 4);
    expect(steps).toEqual(['fetched true', 'brought true', 'taken true', 'in the owner\'s hand']);
    expect(owner.holds(stick)).toBe(true);
    expect(labrador.holds(stick)).toBe(false);
    expect([...owner.log, ...labrador.log]).toEqual([]);
  }, 20000);

  it('a horse walks after a person and looks at it, whichever of them updates first', () => {
    const run = (horseFirst: boolean) => {
      const groom = person({ dev: true, at: new Vector3(1, 0, 0) });
      const mare = new Body(horse(HORSE), { dev: true, at: new Vector3(-2, 0, 0) });
      roomOf(groom, mare);
      const head = groom.bones.head;
      let done = false;
      play(function* () {
        yield* parallel('race', walkTo(groom, new Vector3(1, 0, 6)), walkTo(mare, head, { until: Infinity }), lookAt(mare, head, { until: Infinity }));
        yield* wait(2);
        done = true;
      }, horseFirst ? [mare, groom] : [groom, mare], 20, () => done);
      expect(done).toBe(true);
      expect([...groom.log, ...mare.log]).toEqual([]);
      return { groom: groom.position.clone(), mare: mare.position.clone() };
    };
    const after = run(false), before = run(true);
    // (each reads the other as it was before this frame's updates: the order they update in changes nothing)
    expect(before.mare.equals(after.mare) && before.groom.equals(after.groom)).toBe(true);
    expect(after.mare.distanceTo(new Vector3(-2, 0, 0))).toBeGreaterThan(3);
  }, 20000);
});
