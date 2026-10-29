import { Object3D, Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { Body, carry, grab, humanoid, release, wait } from '../../src/index';
import { CHEWBACCA } from '../skeletons/chewbacca';
import { insides, person, play, run, feetOf } from '../bodies';
import { box, empty, roomOf, worldOf, named } from '../things';

describe('what a body wears', () => {
  /** a body wearing 10 kg 30 cm out to its left at the chest, stood a while */
  const loaded = () => {
    const body = person(), h = insides(body);
    roomOf(body);
    const load = new Object3D();
    load.userData.mass = 10;
    load.position.set(0.3, 0, 0.2);
    body.bones.chest.add(load);
    run(body, 3);
    return { body, h, load };
  };

  it('counts worn mass at its location and balances it over planted feet', () => {
    const { h, load } = loaded();
    const pose = h.pose;
    const segments = pose.skeleton.bones.reduce((sum, bone, i) => sum.addScaledVector(pose.point(i, bone.com, new Vector3()), bone.mass), new Vector3());
    const mass = pose.skeleton.bones.reduce((sum, bone) => sum + bone.mass, 0);
    expect(pose.com(new Vector3()).distanceTo(segments.addScaledVector(worldOf(load), 10).divideScalar(mass + 10))).toBeLessThan(1e-6);
    expect(h.borne.get([...h.borne.keys()][0])?.kg).toBeCloseTo(10, 6);
    const feet = feetOf(h)[0].position.clone().add(feetOf(h)[1].position).multiplyScalar(0.5);
    expect(Math.abs(h.pose.com(new Vector3()).x - feet.x)).toBeLessThan(0.02);
  });

  it('counts what it wears from its first sub-step, where it is then', () => {
    const body = person(), h = insides(body);
    roomOf(body);
    const before = h.pose.com(new Vector3());
    const load = new Object3D();
    load.userData.mass = 8;
    load.position.set(0.2, 0, 0);
    body.bones.chest.add(load);
    body.update(1 / 60);
    expect(h.borne.get([...h.borne.keys()][0])?.kg).toBe(8);
    expect(h.pose.com(new Vector3()).distanceTo(before)).toBeGreaterThan(0.01);
  });

  it('bears what it carries off its support, and none of it once it is put down', () => {
    const body = person(), h = insides(body), room = roomOf(body);
    const taken = new Vector3(0, 1.0, 0.4);
    const load = box(room, taken, { mass: 4, solid: false });
    const kg = { carried: -1, down: -1 };
    let done = false;
    play(function* () {
      yield* grab(body, load, { left: 'left', right: 'right' });
      yield* carry(body, load, new Vector3(0, 1.05, 0.35));
      yield* wait(1);
      kg.carried = [...h.borne.values()][0]?.kg ?? 0;
      yield* carry(body, load, taken);
      release(body, load);
      yield* wait(1);
      kg.down = [...h.borne.values()][0]?.kg ?? 0;
      done = true;
    }, [body], 12, () => done);
    expect(kg.carried).toBeCloseTo(4, 3);
    expect(kg.down).toBe(0);
    expect(h.borne.size).toBe(0);
  });
});

describe('a sword in a scabbard on the hips', () => {
  /** a scabbard at the left hip, its throat presented before the belly as a left hand tilts it (the reference knight's), its mouth up
   * and an approach out of it; a sword in it, its hilt at the mouth */
  function knight() {
    const body = person({ dev: true }), room = roomOf(body);
    run(body, 0.5);
    const scabbard = new Object3D();
    scabbard.name = 'scabbard';
    scabbard.userData.mass = 0.8;
    scabbard.position.set(0.15, 0.06, 0.22);
    scabbard.rotation.set(1.0, 0, 0.3);
    body.bones.hips.add(scabbard);
    // (in the hips' frame: down its length; the mouth and the way out above it)
    empty(scabbard, 'mouth', new Vector3(0, 0.05, 0)).userData.approach = ['drawn', 'out'];
    empty(scabbard, 'out', new Vector3(0, 0.3, 0.05));
    empty(scabbard, 'drawn', new Vector3(0, 0.75, 0.15));
    const sword = new Object3D();
    sword.name = 'sword';
    sword.userData.mass = 1.2;
    sword.position.set(0, 0.05, 0);
    named(scabbard, 'mouth').add(sword);
    empty(sword, 'hilt', new Vector3(0, 0.1, 0));
    room.updateMatrixWorld(true);
    return { body, room, scabbard, sword, mouth: named(scabbard, 'mouth'), out: named(scabbard, 'out') };
  }

  it('draws it out the way its scabbard comes in, holds it before itself, and sheathes it again', () => {
    const { body, sword, mouth, out } = knight();
    const guard = empty(body.object, 'guard', new Vector3(0.05, 1.25, 0.45));
    let nearOut = Infinity, done = false;
    const outcomes: boolean[] = [];
    play(function* () {
      outcomes.push(yield* grab(body, sword, { right: 'hilt' }));
      outcomes.push(yield* carry(body, sword, guard));
      outcomes.push(yield* wait(0.5));
      outcomes.push(yield* carry(body, sword, mouth));
      release(body, sword, mouth);
      done = true;
    }, [body], 15, () => {
      nearOut = Math.min(nearOut, worldOf(sword).distanceTo(worldOf(out)));
      return done;
    });
    expect(outcomes).toEqual([true, true, true, true]);
    // (it passes through the way out on its way)
    expect(nearOut).toBeLessThan(0.05);
    expect(sword.parent).toBe(mouth);
    expect(sword.position.length()).toBe(0);
    expect(sword.quaternion.angleTo(new Quaternion())).toBe(0);
    expect(body.log).toEqual([]);
  }, 20000);
});

describe('hands that cannot get there', () => {
  it('fail visibly, never by throwing: a reach out of the arms is late in the log and keeps going, as does a carry', () => {
    // (driven: nothing walks it up to what it reaches for)
    const root = { position: new Vector3(), velocity: new Vector3(), yaw: 0 };
    const body = person({ dev: true, drive: () => root }), h = insides(body), room = roomOf(body);
    const far = box(room, new Vector3(0, 1, 3), { solid: false, name: 'far' });
    let ended = false;
    play(function* () {
      yield* grab(body, far, { left: 'left', right: 'right' }, { until: 6 });
      ended = true;
    }, [body], 7, () => ended);
    expect(ended).toBe(true);
    expect(body.log.filter(({ check }) => check.startsWith('late reach')).map(({ where }) => where)).toEqual(['far left left', 'far right right']);
    expect(body.holds(far)).toBe(false);
    const near = box(room, new Vector3(0, 1.1, 0.35), { solid: false, name: 'near' });
    ended = false;
    play(function* () {
      yield* grab(body, near, { left: 'left', right: 'right' });
      yield* carry(body, near, new Vector3(0, 1.1, 1.3), { until: 6 });
      ended = true;
    }, [body], 12, () => ended);
    expect(ended).toBe(true);
    expect(body.log.filter(({ check }) => check.startsWith('late carry')).map(({ where }) => where)).toEqual(['near']);
    expect(h.holding.left?.thing.object).toBe(near);
  });
});

// (the trial that found it: a bearer's medal hanging from his still right hand by its ribbon's loop swung at 6 m/s as his left hand took
// the next one, riding the free twist of his wrist; and a forearm holding a thing flailed at ~1200°/s as the trunk bowed over a hand kept
// in the pelvis's frame)
describe('a thing in one hand by a grip that sets no turn', () => {
  it.each([['the default person', () => person({ dev: true })], ['a 2.3 m skeleton', () => new Body(humanoid(CHEWBACCA), { dev: true })]])(
    'keeps its turn in the world, but for the facing, as the other hand bows for something low, the arm holding it calm: %s', (_name, make) => {
      const body = make(), room = roomOf(body), scale = body.species.scale, hips = body.species.person?.hipHeight ?? 0;
      const medal = new Object3D();
      medal.name = 'medal';
      medal.userData.mass = 0.1;
      medal.position.set(-0.25 * scale, hips + 0.1 * scale, 0.3 * scale);
      empty(medal, 'loop', new Vector3(0, 0.34, 0));
      room.add(medal);
      const low = box(room, new Vector3(0.25, 0.3, 0.45).multiplyScalar(scale), { size: new Vector3(0.1, 0.1, 0.1), mass: 0.3, name: 'low' });
      let took = false, kept: Quaternion | null = null, turned = 0, forearm = 0, before: Quaternion | null = null;
      // (its turn with the body's facing taken out)
      const unfaced = () => new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -body.facing).multiply(medal.getWorldQuaternion(new Quaternion()));
      play(function* () {
        yield* grab(body, medal, { right: 'loop' });
        kept = unfaced();
        took = yield* grab(body, low, { left: 'right' });
      }, [body], 12, () => {
        const turn = body.bones.rightLowerArm.getWorldQuaternion(new Quaternion());
        if (kept && before) {
          turned = Math.max(turned, unfaced().angleTo(kept));
          forearm = Math.max(forearm, turn.angleTo(before) * 60);
        }
        before = turn;
        return took;
      });
      expect(took).toBe(true);
      expect(body.holds(medal)).toBe(true);
      expect(turned).toBeLessThan(0.01);
      // (an idle holding arm goes along with the trunk: ~130–220°/s as it bows, against 420–460 kept in the pelvis's frame — rad/s here)
      expect(forearm).toBeLessThan(5);
      expect(body.log).toEqual([]);
    }, 20000);
});
