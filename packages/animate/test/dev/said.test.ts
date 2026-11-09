// What the library says, and goes on: a warning for an app, with no dev flag.
import { BoxGeometry, Mesh, Object3D, Vector3 } from 'three';
import { parallel } from '@pmndrs/timeline';
import { describe, expect, it, vi } from 'vitest';
import { Body, carry, grab, grip, play, release, wait, walkTo } from '../../src/index';
import { dt, person } from '../kit/bodies';
import { box, empty, roomOf } from '../kit/things';

describe('a grip\'s keys', () => {
  it('a key on a grip nothing reads is said once, naming what a grip takes; the grab goes on', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const body = person(), thing = box(roomOf(body), new Vector3(0, 1, 0.4), { mass: null });
    thing.getObjectByName('right')!.userData.radious = 0.02;
    expect(play(body, function* () {
      yield* grab(body, thing, { right: 'right' });
      release(body, thing);
      return yield* grab(body, thing, { right: 'right' });
    }).result).toBe(true);
    const said = warn.mock.calls.map(([message]) => String(message));
    warn.mockRestore();
    expect(said).toEqual([expect.stringMatching(/userData\.radious.*approach and speed/)]);
  });

  it('a thing gripped by its own name keeps its data unremarked', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const body = person(), thing = box(roomOf(body), new Vector3(-0.2, 1, 0.35));
    thing.name = 'crate';
    thing.userData.gameId = 7;
    play(body, grab(body, thing, { right: 'crate' }));
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('a door swung with the body standing still', () => {
  const door = (body: Body) => {
    const room = roomOf(body), hinge = new Object3D(), leaf = new Mesh(new BoxGeometry(0.8, 2, 0.04));
    hinge.position.set(-0.7, 0, 0.55);
    room.add(hinge);
    leaf.name = 'door';
    leaf.position.set(0.4, 1, 0);
    hinge.add(leaf);
    grip(leaf, 'handle', [0.3, 0, -0.03], { handle: [0, 1, 0], radius: 0.015 });
    room.updateMatrixWorld(true);
    const swing = (rate = 1.2) => wait(() => {
      hinge.rotation.y -= rate / 60;
      hinge.updateMatrixWorld(true);
      return hinge.rotation.y < -1.8;
    });
    return { leaf, swing };
  };

  it('keeps its hold, and is said once with no dev flag, naming the thing, how far and the fix', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const body = person({ life: { seed: 1 } }), { leaf, swing } = door(body);
    play(body, function* () {
      yield* grab(body, leaf, { right: 'handle' }, { step: false });
      yield* swing();
      yield* wait(0.3);
    });
    const said = warn.mock.calls.map(([message]) => String(message));
    warn.mockRestore();
    expect(body.holds(leaf)).toBe(true);
    expect(said).toEqual([expect.stringMatching(/hand holding "door" has fallen [\d.]+ cm off its grip.*walk the body with what moves it, or release it/)]);
  });

  it('walked with, it is not', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const body = person({ life: { seed: 1 } }), { leaf, swing } = door(body);
    play(body, function* () {
      yield* grab(body, leaf, { right: 'handle' }, { step: false });
      yield* parallel('all', swing(0.4), walkTo(body, new Vector3(-0.6, 0, 0.75), { speed: 0.4, face: 0 }));
    });
    const said = warn.mock.calls.map(([message]) => String(message));
    warn.mockRestore();
    expect(said).toEqual([]);
  });
});

describe('a verb never yielded', () => {
  const warned = (story: (body: Body) => void) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const body = person();
    story(body);
    for (let k = 0; k < 90; k++) body.update(dt);
    const said = warn.mock.calls.map(([message]) => String(message));
    warn.mockRestore();
    return said;
  };

  it('is said once, after a second, with where it was called', () => {
    const said = warned((body) => void walkTo(body, new Vector3(0, 0, 1)));
    expect(said).toEqual([expect.stringMatching(/walkTo \(said\.test\.ts:\d+\) was called but never run/)]);
  });

  it('nothing is said of one run', () => {
    const body = person();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    play(body, walkTo(body, new Vector3(0, 0, 0.5)));
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
