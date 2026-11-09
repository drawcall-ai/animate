// What the library says, and goes on: a warning for an app, with no dev flag.
import { BoxGeometry, Group, Mesh, Object3D, Vector3 } from 'three';
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

  it('shows in the dev log from 8 cm off, its worst value, well before it is said; walked with, not at all', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const rows = (walked: boolean) => {
      const body = person({ dev: true, life: { seed: 1 } }), { leaf, swing } = door(body);
      play(body, function* () {
        yield* grab(body, leaf, { right: 'handle' }, { step: false });
        if (walked) yield* parallel('all', swing(0.4), walkTo(body, new Vector3(-0.6, 0, 0.75), { speed: 0.4, face: 0 }));
        else yield* swing(0.4);
      });
      return body.log.filter((row) => row.check === 'held grip distance (m)');
    };
    const fallen = rows(false), kept = rows(true);
    warn.mockRestore();
    expect(fallen).toEqual([expect.objectContaining({ where: 'door right', limit: 0.08 })]);
    expect(fallen[0].worst).toBeGreaterThan(0.1);
    expect(kept).toEqual([]);
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

describe('a target taken out of the scene', () => {
  it('stands where it was, said once, a hand keeping to it staying put', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const body = person(), room = roomOf(body), cup = box(room, new Vector3(-0.28, 1, 0.25), { size: new Vector3(0.08, 0.1, 0.08), mass: 0.3 });
    const mouth = empty(body.bones.chest, 'mouth', new Vector3(-0.1, 0.1, 0.35));
    let lowest = Infinity, gone = false;
    play(body, function* () {
      yield* grab(body, cup, { right: 'right' }, { already: true });
      yield* carry(body, cup, mouth);
      mouth.removeFromParent();
      gone = true;
      yield* wait(2);
    }, { frame: () => { if (gone) lowest = Math.min(lowest, body.bones.rightHand.getWorldPosition(new Vector3()).y); } });
    const said = warn.mock.calls.map(([message]) => String(message));
    warn.mockRestore();
    expect(lowest).toBeGreaterThan(0.9);
    expect(said).toEqual([expect.stringContaining('"mouth" was taken out of the scene')]);
  });

  it('a target never in a scene is unremarked: its numbers are the world\'s', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const body = person(), spot = new Object3D();
    spot.position.set(0, 0, 1);
    play(body, walkTo(body, spot));
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('a carry\'s way', () => {
  const said = (story: (body: Body, room: Object3D, load: Object3D) => Generator<unknown, unknown, unknown>) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const body = person(), room = roomOf(body), load = box(room, new Vector3(0, 1, 0.4), { solid: false, mass: 2, size: new Vector3(0.3, 0.1, 0.2) });
    play(body, story(body, room, load) as Parameters<typeof play>[1], { limit: 20 });
    const lines = warn.mock.calls.map(([message]) => String(message));
    warn.mockRestore();
    return lines;
  };
  const BOTH = { left: 'left', right: 'right' };

  it('an approach the arms cannot take it through is said, with how far short, and the carry goes on', () => {
    expect(said(function* (body, room, load) {
      const shelf = empty(room, 'shelf', new Vector3(0, 1.3, 0.55)), slot = empty(shelf, 'slot', new Vector3());
      empty(shelf, 'above', new Vector3(0, 1.2, 0));
      slot.userData.approach = ['above'];
      room.updateMatrixWorld(true);
      yield* grab(body, load, BOTH);
      yield* carry(body, load, slot);
    })).toEqual([expect.stringMatching(/approach "above" than \d+ cm/)]);
  });

  it('a waypoint out of reach is said; one in reach is not', () => {
    const end = new Vector3(0, 1.05, 0.45);
    expect(said(function* (body, _room, load) {
      yield* grab(body, load, BOTH);
      yield* carry(body, load, [new Vector3(0, 2.4, 0.4), end]);
    })).toEqual([expect.stringMatching(/waypoint 1 than \d+ cm/)]);
    expect(said(function* (body, _room, load) {
      yield* grab(body, load, BOTH);
      yield* carry(body, load, [new Vector3(0, 1.3, 0.4), end]);
    })).toEqual([]);
  });
});

describe('a target taken out of the scene', () => {
  const told = (fn: () => void) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    fn();
    const lines = warn.mock.calls.map(([message]) => String(message));
    warn.mockRestore();
    return lines;
  };
  /** an empty in a group a little way off in the room, that group taken away as `carry` goes to the empty */
  const inGroup = () => {
    const body = person(), room = roomOf(body), load = box(room, new Vector3(0, 1, 0.4), { solid: false }), furniture = new Group();
    furniture.position.set(0.8, 0, 0.8);
    room.add(furniture);
    const spot = empty(furniture, 'spot', new Vector3(-0.8, 1.2, -0.3));
    room.updateMatrixWorld(true);
    return { body, room, load, furniture, spot };
  };

  it('with what it hangs from: said once, and the thing goes on to where it last was, not to its local numbers', () => {
    const { body, load, furniture, spot } = inGroup();
    let ended: boolean | null = null;
    const lines = told(() => play(body, function* () {
      yield* grab(body, load, { left: 'left', right: 'right' }, { already: true });
      yield* parallel('all', function* () { ended = yield* carry(body, load, spot); }, function* () {
        yield* wait(0.2);
        furniture.removeFromParent();
      });
    }, { limit: 12 }));
    expect(lines).toEqual([expect.stringMatching(/target "spot" was taken out of the scene/)]);
    expect(ended).toBe(true);
    expect(load.getWorldPosition(new Vector3()).distanceTo(new Vector3(0, 1.2, 0.5))).toBeLessThan(0.02);
  });

  it('a release onto one left outside the scene says the thing went with it', () => {
    const { body, load, furniture, spot } = inGroup();
    const lines = told(() => play(body, function* () {
      yield* grab(body, load, { left: 'left', right: 'right' }, { already: true });
      yield* carry(body, load, spot);
      furniture.removeFromParent();
      release(body, load, spot);
    }, { limit: 12 }));
    expect(lines).toEqual([expect.stringMatching(/put onto "spot", which is not in the body's scene/)]);
  });

  it('one never in the scene, and a function\'s, are places of their own numbers: nothing is said', () => {
    const { body, load } = inGroup(), free = new Object3D();
    free.position.set(0, 1.1, 0.45);
    const lines = told(() => play(body, function* () {
      yield* grab(body, load, { left: 'left', right: 'right' }, { already: true });
      yield* carry(body, load, free);
      const made = new Object3D();
      made.position.set(0, 1.05, 0.45);
      yield* carry(body, load, () => made);
    }, { limit: 12 }));
    expect(lines).toEqual([]);
  });
});
