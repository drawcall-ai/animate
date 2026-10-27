import { Object3D, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { carry, grab, release, type Body } from '../../src/index';
import { person, play } from '../bodies';
import { box, empty, roomOf } from '../things';

const BOTH = { left: 'left', right: 'right' } as const;

/** `story` run on `body` for a moment: a misuse in it throws out of the frame it is found in */
const playing = (body: Body, story: () => Generator<unknown, void, unknown>) => () => play(story as never, [body], 0.5);

describe('a misuse throws, saying what is wrong', () => {
  it('a grip the thing has no empty for', () => {
    const body = person(), room = roomOf(body);
    const load = box(room, new Vector3(0, 0.9, 0.5));
    expect(playing(body, function* () { yield* grab(body, load, { right: 'handle' }); })).toThrow('"box" has no empty named "handle"');
  });

  it('a hand the body does not have', () => {
    // (as a script without types would name it)
    const body: Body = person(), room = roomOf(body);
    const load = box(room, new Vector3(0, 0.9, 0.5));
    expect(playing(body, function* () { yield* grab(body, load, { tail: 'left' }); })).toThrow('hands are left and right, not "tail"');
    expect(() => release(body, { tail: load })).toThrow('the body has no hand "tail"');
  });

  it('letting go of what no hand holds, or of what another hand holds', () => {
    const body = person(), room = roomOf(body);
    const load = box(room, new Vector3(0, 0.9, 0.45), { mass: 1, solid: false });
    expect(() => release(body, load)).toThrow('no hand of the body holds "box"');
    let tried = false;
    play(function* () {
      yield* grab(body, load, { right: 'right' });
      expect(() => release(body, { left: load })).toThrow('the left hand does not hold "box"');
      tried = true;
    }, [body], 6, () => tried);
    expect(tried).toBe(true);
  });

  it('a mass that is no number of kilograms', () => {
    for (const mass of [-1, NaN, '2 kg']) {
      const body = person(), room = roomOf(body);
      const load = box(room, new Vector3(0, 0.9, 0.5));
      load.userData.mass = mass;
      expect(playing(body, function* () { yield* grab(body, load, BOTH); })).toThrow(`has userData.mass ${String(mass)}: give it in kg`);
    }
  });

  it('an approach that is no list of names, or names an empty that is not beside it', () => {
    for (const [approach, message] of [['front', 'has a userData.approach that is no list of names'], [['front'], 'approaches by "front", which is not beside it']] as const) {
      const body = person(), room = roomOf(body);
      const load = box(room, new Vector3(0, 0.9, 0.45), { mass: 1, solid: false });
      const shelf = new Object3D();
      room.add(shelf);
      empty(shelf, 'slot', new Vector3(0.1, 1.0, 0.45)).userData.approach = approach;
      expect(() => play(function* () {
        yield* grab(body, load, BOTH);
        yield* carry(body, load, shelf.children[0]);
      }, [body], 6)).toThrow(`"slot" ${message}`);
    }
  });
});
