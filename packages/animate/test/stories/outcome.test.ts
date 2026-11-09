import { Object3D, Vector3 } from 'three';
import { parallel, runTimeline } from '@pmndrs/timeline';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { attempt, Body, carry, grab, grip, humanoid, lookAt, Missed, play, pose, reach, release, wait, walkTo } from '../../src/index';
import { PERSON } from '../../skills/animate/references/person';
import { person } from '../kit/bodies';
import { box, roomOf } from '../kit/things';

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
    expect(() => play(body, lookAt(body, new Vector3(0, 1.5, 3)), { limit: 0.5 })).toThrow(/^story still running after 0\.5 s: lookAt \(outcome\.test\.ts:\d+, since 0\.0 s, it ends only on its until \(a pose's: or hold\)\)/);
  });

  it('calls `frame` after the bodies update, each frame, with the time', () => {
    const body = person();
    let seen = 0, last = 0;
    const { time } = play(body, wait(0.5), { frame: (now) => { seen++; last = now; } });
    expect(last).toBe(time);
    expect(seen).toBeCloseTo(time * 60, 0);
  });

});
