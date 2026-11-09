import { Mesh, Object3D, BoxGeometry, Vector3 } from 'three';
import { parallel, runTimeline } from '@pmndrs/timeline';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { attempt, Body, carry, dog, grab, grip, humanoid, lookAt, Missed, play, pose, reach, release, wait, walkTo } from '../../src/index';
import { PERSON } from '../../skills/animate/references/person';
import { selfOf } from '../../src/body/body';
import { DOG } from '../../skills/animate/references/dog';
import { person } from '../bodies';
import { box, roomOf } from '../things';

const dt = 1 / 60;

describe('a verb\'s ending', () => {
  it('a reach cut short is judged where the hand is as it ends, not where it once was', () => {
    const body = person(), target = new Vector3(-0.2, 1.15, 0.45);
    const { result } = play([body], function* () {
      // (on it, then the target taken far away a moment before the end)
      yield* parallel('all', function* () {
        yield* wait(3);
        target.set(-0.2, 1.15, 3.4);
      }, wait(0));
      return yield* reach(body, { right: () => target }, { until: 0.05 });
    });
    expect(result).toBe(false);
    const stays = person(), near = new Vector3(-0.2, 1.15, 0.45);
    expect(play([stays], reach(stays, { right: near }, { until: 3 })).result).toBe(true);
  });

  it('a reach cut short on a target that moves ends true with the hand on it, moving', () => {
    const body = person();
    const moving = (time: number) => new Vector3(-0.2 + 0.1 * Math.sin(time), 1.15, 0.45);
    expect(play([body], reach(body, { right: moving }, { step: false, until: 4 })).result).toBe(true);
  });

  it('an aimer, and a pose with no goal, end true', () => {
    const body = person();
    expect(play([body], lookAt(body, new Vector3(0, 1.5, 3), { until: 0.2 })).result).toBe(true);
    expect(play([body], pose(body, { bow: 0.1 }, { until: 0.2 })).result).toBe(true);
  });

  it('a walk cut short ends false, standing short', () => {
    const body = person();
    expect(play([body], walkTo(body, new Vector3(0, 0, 9), { until: 0.5 })).result).toBe(false);
  });

  it('what cannot get there misses at the same moment, `until` or not, with `attempt` seeing it', () => {
    const missOf = (until?: number) => {
      const body = person({ drive: () => ({ position: new Vector3(), velocity: new Vector3(), yaw: 0 }) }), thing = box(roomOf(body), new Vector3(0, 1, 3));
      return play(body, function* () {
        const miss = yield* attempt(grab(body, thing, { right: 'right' }, { until }));
        return miss;
      }, { limit: 12 });
    };
    expect(missOf().result).toBeInstanceOf(Missed);
    for (const until of [5, Infinity]) expect(missOf(until).result).toBeInstanceOf(Missed);
    expect(missOf(5).time).toBeCloseTo(missOf().time, 1);
    const body = person();
    expect(() => play(body, reach(body, { right: new Vector3(-0.2, 1.1, 3) }, { step: false, until: 3 }))).toThrow(Missed);
  });

  it('a hand behind a moving target has failed nothing, one off a target gone still has', () => {
    const body = person(), at = new Vector3(-0.2, 1.15, 0.45);
    expect(() => play(body, function* () {
      yield* parallel('race', reach(body, { right: (time) => at.set(-0.2 + 0.15 * Math.sin(6 * time), 1.15, 0.45) }, { step: false, until: 3 }), wait(3));
    })).not.toThrow();
    const left = person(), still = new Vector3(-0.2, 1.15, 3);
    expect(() => play(left, reach(left, { right: (time) => still.set(-0.2, 1.15, Math.max(0.45, Math.min(3, 0.45 + time))) }, { step: false, until: 8 }))).toThrow(Missed);
  });

  it('a carry to the head judges the target, not where it stopped clear of the face, and misses naming the clearance', () => {
    const body = new Body(humanoid(PERSON)), cup = box(roomOf(body), new Vector3(-0.2, 1, 0.35));
    const mouth = grip(body.bones.head, 'mouth', [0, -0.06, 0.08]);
    const { result } = play(body, function* () {
      yield* grab(body, cup, { right: 'right' });
      return yield* attempt(carry(body, cup, mouth));
    });
    expect(result).toBeInstanceOf(Missed);
    expect(result?.why).toMatch(/head's clearance.*cm off its end.*target clear of the head/);
    expect(result?.off).toBeGreaterThan(0.015);
  });
});

describe('Missed', () => {
  afterEach(() => void vi.restoreAllMocks());
  const far = () => {
    const body = person(), thing = box(roomOf(body), new Vector3(0, 4, 0.5));
    return { body, thing };
  };

  it('says the verb, its call site, the part, how far off and why, with no dev flag', () => {
    const { body, thing } = far();
    let miss: unknown;
    try {
      play([body], grab(body, thing, { right: 'right' }));
    } catch (error) { miss = error; }
    expect(miss).toBeInstanceOf(Missed);
    expect(miss).toMatchObject({ verb: 'grab', site: expect.stringContaining('outcome.test.ts'), where: 'box right right', off: expect.any(Number), limit: expect.any(Number), why: expect.stringContaining('no stand reaches it') });
    expect((miss as Missed).message).toContain('grab (outcome.test.ts:');
  });

  it('`attempt` hands it back, is null when all went well and lets anything else through', () => {
    const { body, thing } = far();
    const { result } = play([body], function* () {
      const miss = yield* attempt(grab(body, thing, { right: 'right' }));
      const none = yield* attempt(walkTo(body, new Vector3(0, 0, 0.5)));
      return { miss, none };
    });
    expect(result.miss).toBeInstanceOf(Missed);
    expect(result.none).toBeNull();
    const other = person();
    expect(() => play([other], attempt((function* () { throw new RangeError('not a miss'); })()))).toThrow('not a miss');
  });

  it('`attempt` composes with parallel: the branch that misses ends the rest', () => {
    const { body, thing } = far();
    const { result } = play([body], attempt(parallel('all', grab(body, thing, { right: 'right' }), wait(30))));
    expect(result).toBeInstanceOf(Missed);
    expect(play([body], wait(0.1)).time).toBeLessThan(1);
  });

  it('names the newer verb that took the legs from an older walk', () => {
    const body = person();
    const story = () => play(body, parallel('all', walkTo(body, new Vector3(0, 0, 3)), walkTo(body, new Vector3(0, 0, -3))));
    expect(story).toThrow(/walkTo \(outcome\.test\.ts:\d+\) took the legs from it/);
  });

  it('a release during a carry says so, not a blank', () => {
    const body = person(), thing = box(roomOf(body), new Vector3(-0.2, 1, 0.35));
    const { result } = play(body, function* () {
      yield* grab(body, thing, { right: 'right' });
      return yield* attempt(parallel('all', carry(body, thing, new Vector3(-0.3, 1.3, 0.4)), function* () {
        yield* wait(0.1);
        release(body, thing);
      }));
    }, { limit: 15 });
    expect(result?.why).toMatch(/let go during the carry/);
  });

  it('a release onto an empty too far off throws at the call: a `try`, not `attempt`', () => {
    const body = person(), thing = box(roomOf(body), new Vector3(-0.2, 1, 0.35)), shelf = new Object3D();
    roomOf(body).add(shelf);
    shelf.position.set(0, 2, 2);
    const { result } = play(body, function* () {
      yield* grab(body, thing, { right: 'right' });
      try { release(body, thing, shelf); } catch (miss) { return miss; }
    });
    expect(result).toBeInstanceOf(Missed);
  });

  it('reaches the app\'s update once, drops its requests and does not come again', () => {
    const { body, thing } = far();
    const step = runTimeline(function* () { yield* grab(body, thing, { right: 'right' }); });
    const frame = () => { step(undefined, dt); body.update(dt); };
    let thrown = 0;
    for (let k = 0; k < 120; k++) {
      try { frame(); } catch (error) {
        expect(error).toBeInstanceOf(Missed);
        thrown++;
      }
    }
    expect(thrown).toBe(1);
    expect(body.owners.hands.right).toBeUndefined();
  });

  it('is caught around `yield*`, and the story goes on', () => {
    const { body, thing } = far();
    const { result } = play([body], function* () {
      try {
        yield* grab(body, thing, { right: 'right' });
      } catch (error) {
        if (!(error instanceof Missed)) throw error;
      }
      return yield* walkTo(body, new Vector3(0, 0, 0.5));
    });
    expect(result).toBe(true);
  });
});

describe('misuse', () => {
  it('a walk to a body says what to pass', () => {
    const body = person(), other = person({ at: new Vector3(0, 0, 3) });
    expect(() => play([body], walkTo(body, other as unknown as Vector3))).toThrow(/\.position/);
  });

  it('a hand the body does not have throws', () => {
    const pup = new Body(dog(DOG)), toy = box(roomOf(pup), new Vector3(0, 0.2, 0.8));
    expect(() => play(pup, grab(pup, toy, { right: 'right' } as never))).toThrow('has no hand "right", only jaw');
  });

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

  it('`carry` of what no hand holds throws, naming the fix', () => {
    const body = person(), thing = box(roomOf(body), new Vector3(0, 1, 0.4));
    expect(() => play(body, carry(body, thing, new Vector3()))).toThrow(/grab it first/);
  });

  it('a misuse in staging reaches the story\'s `try` once, its `finally` runs and nothing stays filed', () => {
    const body = person(), thing = box(roomOf(body), new Vector3(0, 1, 0.4));
    let caught = 0, cleaned = 0, thrown = 0;
    const step = runTimeline(function* () {
      try {
        yield* carry(body, thing, new Vector3());
      } catch { caught++; } finally { cleaned++; }
    });
    for (let k = 0; k < 30; k++) {
      try { step(undefined, dt); body.update(dt); } catch { thrown++; }
    }
    expect({ caught, cleaned, thrown }).toEqual({ caught: 1, cleaned: 1, thrown: 0 });
    expect(selfOf(body).requests.filter(({ verb }) => verb === 'carry')).toEqual([]);
  });

  it('a value of another copy of three is said at the first target, naming the fix', () => {
    class Other { isVector3 = true; x = 0; y = 0; z = 1; }
    const body = person();
    expect(() => play(body, walkTo(body, new Other() as never))).toThrow(/another copy of three/);
    expect(() => new Body(humanoid(PERSON), { at: new Other() as never })).toThrow(/another copy of three/);
  });
});

describe('play', () => {
  it('runs a story to its end, reporting its result and how long it took, a body alone or several', () => {
    const body = person(), { result, time } = play(body, function* () {
      yield* wait(0.5);
      return 'done';
    });
    expect(result).toBe('done');
    expect(time).toBeCloseTo(0.5, 1);
  });

  it('throws at its limit naming what still runs and where, what never ends saying so', () => {
    const body = person();
    expect(() => play(body, lookAt(body, new Vector3(0, 1.5, 3)), { limit: 0.5 })).toThrow(/^story still running after 0\.5 s: lookAt \(outcome\.test\.ts:\d+, since 0\.0 s, never ends without until\)/);
  });

  it('calls `frame` after the bodies update, each frame, with the time', () => {
    const body = person();
    let seen = 0, last = 0;
    const { time } = play(body, wait(0.5), { frame: (now) => { seen++; last = now; } });
    expect(last).toBe(time);
    expect(seen).toBeCloseTo(time * 60, 0);
  });

  it('prints nothing', () => {
    const log = vi.spyOn(console, 'log');
    const body = person();
    play(body, wait(0.1));
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
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
    expect(said).toEqual([expect.stringMatching(/walkTo \(outcome\.test\.ts:\d+\) was called but never run/)]);
  });

  it('nothing is said of one run', () => {
    const body = person();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    play(body, walkTo(body, new Vector3(0, 0, 0.5)));
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('grip', () => {
  it('adds a named empty that a grab takes, its spec its userData', () => {
    const body = person(), room = roomOf(body), rod = new Mesh(new BoxGeometry(0.03, 0.2, 0.03));
    rod.name = 'rod';
    rod.position.set(-0.2, 1, 0.3);
    rod.userData.mass = 0.2;
    room.add(rod);
    const handle = grip(rod, 'shaft', new Vector3(0, 0.02, 0), { handle: [0, 1, 0], radius: 0.015 });
    expect(handle).toBeInstanceOf(Object3D);
    expect(handle.parent).toBe(rod);
    expect(handle.userData).toEqual({ handle: [0, 1, 0], radius: 0.015 });
    expect(grip(rod, 'tip', [0, 0.1, 0]).position.y).toBe(0.1);
    expect(play(body, grab(body, rod, { right: 'shaft' })).result).toBe(true);
    expect(body.holds(rod)).toBe(true);
  });
});
