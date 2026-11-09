import { Object3D, Vector3 } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { carry, grab, reach, release, track, walkTo, Body, dog, type Root } from '../../src/index';
import { DOG } from '../../skills/animate/references/dog';
import { dt, person, play, run } from '../bodies';
import { box, empty, roomOf } from '../things';

const BOTH = { left: 'left', right: 'right' } as const;

/** `story` run on `body` for a moment: a misuse in it throws out of the frame it is found in */
const playing = (body: Body, story: Parameters<typeof play>[0]) => () => play(story, [body], 0.5);

describe('a misuse throws, saying what is wrong', () => {
  it('tracking a creature: thrown as the verb is called, naming it', () => {
    expect(() => track(new Body(dog(DOG)), { head: new Vector3() })).toThrow(/^track: for a person \(a humanoid species\) only; this body is a dog/);
  });

  it('a driven root whose physics support and jump both own its vertical movement', () => {
    const root: Root = { position: new Vector3(), velocity: new Vector3(), yaw: 0, support: new Vector3(), jump: 3 };
    const body = person({ drive: () => root });
    expect(() => body.update(dt)).toThrow('support owns vertical motion');
  });

  it('a driven root with physics support but no velocity relative to its platform', () => {
    const root: Root = { position: new Vector3(), yaw: 0, support: new Vector3() };
    const body = person({ drive: () => root });
    expect(() => body.update(dt)).toThrow('physics support requires velocity relative to its platform');
  });

  it('a grip the thing has no empty for', () => {
    const body = person(), room = roomOf(body);
    const load = box(room, new Vector3(0, 0.9, 0.5));
    expect(playing(body, function* () { yield* grab(body, load, { right: 'handle' }); })).toThrow('"box" has no empty named "handle"');
  });

  it('a hand the body does not have', () => {
    // (as a script without types would name it)
    const body: Body = person(), room = roomOf(body);
    const load = box(room, new Vector3(0, 0.9, 0.5));
    expect(playing(body, function* () { yield* grab(body, load, { tail: 'left' }); })).toThrow('has no hand "tail", only left, right');
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

it('rejects malformed placement speed instead of defaulting it', () => {
  for (const speed of ['slow', 0, -1, NaN, Infinity]) {
    const body = person(), room = roomOf(body);
    const load = box(room, new Vector3(0, 0.9, 0.45), { mass: 1, solid: false });
    const slot = empty(room, 'slot', new Vector3(0.1, 1, 0.45));
    slot.userData.speed = speed;
    expect(() => play(function* () {
      yield* grab(body, load, BOTH);
      yield* carry(body, load, slot);
    }, [body], 6)).toThrow('invalid userData.speed');
  }
});

it('rejects creature carry routes it cannot traverse', () => {
  for (const route of ['waypoints', 'destination', 'source', 'speed']) {
    const body = new Body(dog(DOG)), room = roomOf(body);
    const load = box(room, new Vector3(0, 0.25, 0.65), { mass: 0.1, solid: false });
    const slot = empty(room, 'slot', new Vector3(0, 0.3, 0.7));
    if (route === 'destination') {
      empty(room, 'front', new Vector3(0, 0.3, 0.6));
      slot.userData.approach = ['front'];
    }
    if (route === 'speed') slot.userData.speed = 0.2;
    expect(() => play(function* () {
      if (!(yield* grab(body, load, { jaw: 'left' }))) throw new Error('fixture grab failed');
      if (route === 'source') {
        if (!load.parent) throw new Error('fixture has no parent');
        empty(load.parent.parent ?? load.parent, 'front', new Vector3(0, 0.3, 0.6));
        load.parent.userData.approach = ['front'];
      }
      yield* carry(body, load, route === 'waypoints' ? [new Vector3(0, 0.4, 0.6), slot] : slot);
    }, [body], 12)).toThrow(/creature hands do not support/);
  }
});

it.each(['reach', 'grab', 'carry'] as const)('uses creature %s pace in its motion', (verb) => {
  const after = (speed: number) => {
    const body = new Body(dog(DOG)), room = roomOf(body);
    const load = box(room, new Vector3(0, 0.4, 0.48), { mass: 0.1, solid: false });
    if (verb === 'carry') {
      play(function* () { yield* grab(body, load, { jaw: 'left' }); }, [body], 6);
      expect(body.holds(load)).toBe(true);
    }
    play(function* () {
      if (verb === 'reach') yield* reach(body, { jaw: new Vector3(0, 0.4, 0.48) }, { speed });
      else if (verb === 'grab') yield* grab(body, load, { jaw: 'left' }, { speed });
      else yield* carry(body, load, new Vector3(0, 0.4, 0.48), { speed });
    }, [body], 0.3);
    return body.bones.jaw.getWorldPosition(new Vector3());
  };
  expect(after(0.2)).not.toEqual(after(0.8));
});

it('lifts an attached item when a creature starts carrying it', () => {
  const body = new Body(dog(DOG)), room = roomOf(body);
  const load = box(room, new Vector3(0, 0.4, 0.48), { mass: 0.1, solid: false });
  body.bones.trunk.attach(load);
  let finished = false;
  play(function* () {
    if (!(yield* grab(body, load, { jaw: 'left' }))) throw new Error('fixture grab failed');
    expect(load.parent).toBe(body.bones.trunk);
    yield* carry(body, load, new Vector3(0, 0.45, 0.5), { until: 0.2 });
    finished = true;
  }, [body], 12, () => finished);
  expect(finished).toBe(true);
  expect(load.parent).toBe(body.bones.jaw);
});

// (a body stands on its floor: a height asked of where it stands that is off the floor there is ignored, and it warns, once)
describe('a height off the floor is said, once, and ignored', () => {
  afterEach(() => void vi.restoreAllMocks());
  /** reads what the library warned since */
  const warnings = () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    return () => warn.mock.calls.map(([message]) => String(message));
  };
  const raised = () => 0.5;
  it.each([
    ['a person', 0, 1, () => person({ dev: true, at: new Vector3(0, 1, 0) })],
    ['a creature', 0, 1, () => new Body(dog(DOG), { dev: true, at: new Vector3(0, 1, 0) })],
    ['a person on a raised floor', 0.5, 0.5, () => person({ dev: true, floor: raised, at: new Vector3(0, 0, 0) })],
  ])('%s made to stand off it', (_, floor, off, make) => {
    const warned = warnings(), body = make();
    run(body, 0.5);
    expect(warned()).toEqual([expect.stringContaining(`${off.toFixed(3)} m off it`)]);
    expect(body.feet.every((foot) => foot.planted)).toBe(true);
    expect(body.position.y).toBe(floor);
  });

  it.each(['a point', 'an empty'])('a walk to %s above it', (what) => {
    const warned = warnings(), body = person(), mark = empty(roomOf(body), 'mark', new Vector3(0, 0.5, 1));
    play(function* () { yield* walkTo(body, what === 'a point' ? mark.position.clone() : mark); }, [body], 6);
    expect(warned()).toEqual([expect.stringContaining('0.50 m off the floor')]);
  });

  it('a driven root above it', () => {
    const warned = warnings(), body = person({ drive: (time) => ({ position: new Vector3(0, 0.3, time * 0.1), yaw: 0 }) });
    run(body, 1);
    expect(warned()).toEqual([expect.stringContaining('a root driven')]);
  });
});
