import { Mesh, Object3D, BoxGeometry, Vector3 } from 'three';
import { parallel, runTimeline } from '@pmndrs/timeline';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { attempt, Body, carry, dog, grab, grip, lookAt, Missed, play, pose, reach, wait, walkTo } from '../../src/index';
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

  it('a key a grip does not know throws at the grab', () => {
    const body = person(), thing = box(roomOf(body), new Vector3(0, 1, 0.4), { mass: null });
    thing.getObjectByName('right')!.userData.radious = 0.02;
    expect(() => play([body], grab(body, thing, { right: 'right' }))).toThrow(/userData\.radious/);
  });

  it('`carry` of what no hand holds throws, naming the fix', () => {
    const body = person(), thing = box(roomOf(body), new Vector3(0, 1, 0.4));
    expect(() => play(body, carry(body, thing, new Vector3()))).toThrow(/grab it first/);
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

  it('prints nothing', () => {
    const log = vi.spyOn(console, 'log');
    const body = person();
    play(body, wait(0.1));
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
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
