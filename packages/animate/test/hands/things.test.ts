import { Euler, Object3D, Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { attempt, Body, carry, grab, humanoid, Missed, release, wait } from '../../src/index';
import { CHEWBACCA } from '../kit/skeletons/chewbacca';
import { person, play, run } from '../kit/bodies';
import { armed, box, empty, roomOf, worldOf, named } from '../kit/things';

describe('what a body wears', () => {





  // (however fast its app spins it, a soldier turning on the spot takes a magazine from its chest and puts it into the well of the rifle
  // it holds, aimed the way the body faces — spun faster than its feet let it follow, its root led it by more than half a turn and it
  // turned back the other way, the well swinging off as the carry closed on it)
  it('lets go of the rifle with a hand that takes something else, the rifle staying on its mount in the other hand', () => {
    const { body, rifle, orient } = armed((body) => body.facing);
    const magazine = new Object3D();
    magazine.userData.mass = 0.5;
    empty(body.bones.chest, 'pouch', new Vector3(0.1, -0.12, 0.14)).add(magazine);
    empty(magazine, 'base', new Vector3(0, -0.05, 0));
    const mount = rifle.parent;
    let held: boolean | undefined;
    play(function* () { held = yield* grab(body, magazine, { left: 'base' }, { speed: 1.8 }); }, [body], 4, () => (orient(), held !== undefined));
    expect(held).toBe(true);
    expect([body.holds(magazine), body.holds(rifle), rifle.parent]).toEqual([true, true, mount]);
    expect(body.log).toEqual([]);
  });

  it('lets the rifle hang on its mount for both hands to work, and takes it back with one grab of both grips', () => {
    const { body, rifle, aim } = armed((body) => body.facing);
    const mount = rifle.parent;
    if (!mount) throw new Error('no mount');
    // (hanging: the muzzle down and across the body; the mount eased back to the aim as both hands come to it)
    const hang = (share: number) => aim().multiply(new Quaternion().setFromEuler(new Euler(1.1 * share, 0.5 * share, 0)));
    let turned = 0, taking = false;
    const steps: unknown[] = [];
    play(function* () {
      release(body, rifle);
      turned = 1;
      yield* wait(0.5);
      steps.push(!body.holds(rifle));
      taking = true;
      steps.push(yield* grab(body, rifle, { left: 'foregrip', right: 'pistol' }));
    }, [body], 8, () => {
      if (taking) turned = Math.max(0, turned - 1 / 30);
      body.orient(mount, hang(turned));
      return steps.length === 2;
    });
    expect(steps).toEqual([true, true]);
    expect(rifle.parent).toBe(mount);
    expect(body.log).toEqual([]);
  });

  it('takes what it wears and carries it into a slot on what it holds while its app spins it', () => {
    const { root, body, rifle, orient } = armed((body) => body.facing);
    const well = empty(rifle, 'well', new Vector3(0, -0.1, 0.3)), magazine = new Object3D();
    magazine.userData.mass = 0.5;
    empty(body.bones.chest, 'pouch', new Vector3(0.1, -0.12, 0.14)).add(magazine);
    empty(magazine, 'base', new Vector3(0, -0.05, 0));
    const results: boolean[] = [];
    play(function* () {
      results.push(yield* grab(body, magazine, { left: 'base' }, { speed: 1.8 }));
      results.push(yield* carry(body, magazine, well, { speed: 1.8 }));
    }, [body], 8, () => {
      root.yaw += 6 / 60;
      orient();
      return results.length === 2;
    });
    expect(results).toEqual([true, true]);
    expect(body.log).toEqual([]);
  });

  // (a soldier sprinting takes the spent magazine out of its rifle's well and stows it in a pouch on its chest: the pouch goes on with the
  // body faster than the hand carries it, and followed as a goal of its own speed, it was let go of as a jump and left behind)
  it('carries a thing from what it holds to a pouch on its chest while its app runs it', () => {
    const { root, body, rifle, orient } = armed((body) => body.facing);
    const magazine = new Object3D();
    magazine.userData.mass = 0.5;
    empty(rifle, 'well', new Vector3(0, -0.1, 0.3)).add(magazine);
    empty(magazine, 'base', new Vector3(0, -0.05, 0));
    const pouch = empty(body.bones.chest, 'pouch', new Vector3(0.1, -0.12, 0.14));
    const results: boolean[] = [];
    play(function* () {
      results.push(yield* grab(body, magazine, { left: 'base' }, { speed: 1.8 }));
      results.push(yield* carry(body, magazine, pouch, { speed: 1.8 }));
    }, [body], 4, () => {
      // (set off as a runner does, at its acceleration, not at once)
      root.velocity = new Vector3(0, 0, Math.min(3.5, (root.velocity?.z ?? 0) + 8 / 60));
      root.position.addScaledVector(root.velocity, 1 / 60);
      orient();
      return results.length === 2;
    });
    expect(results).toEqual([true, true]);
    expect(body.log).toEqual([]);
  });
});

describe('a part of a held thing', () => {
  it('comes off it in the other hand: a pin pulled from a grenade', () => {
    const body = person({ dev: true }), room = roomOf(body);
    const grenade = box(room, new Vector3(-0.15, 1.0, 0.35), { size: new Vector3(0.06, 0.1, 0.06), mass: 0.4, solid: false, name: 'grenade' });
    const pin = empty(grenade, 'pin', new Vector3(0.05, 0.05, 0));
    pin.userData.mass = 0.01;
    empty(pin, 'ring', new Vector3(0.02, 0, 0));
    const results: boolean[] = [];
    play(function* () {
      results.push(yield* grab(body, grenade, { right: 'right' }));
      results.push(yield* grab(body, pin, { left: 'ring' }));
      results.push(yield* carry(body, pin, body.object.localToWorld(new Vector3(0.3, 1.1, 0.35))));
    }, [body], 8, () => results.length === 3);
    expect(results).toEqual([true, true, true]);
    expect([pin.parent, grenade.parent]).toEqual([body.bones.leftHand, body.bones.rightHand]);
    expect(body.log).toEqual([]);
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
  });
});

describe('hands that cannot get there', () => {
  it('given until, what cannot get there misses all the same: a grab out of the arms, a carry stopped short', () => {
    // (driven: nothing walks it up to what it reaches for)
    const root = { position: new Vector3(), velocity: new Vector3(), yaw: 0 };
    const body = person({ dev: true, drive: () => root }), room = roomOf(body);
    const far = box(room, new Vector3(0, 1, 3), { solid: false, name: 'far' });
    let ended = false, miss: Missed | null = null;
    play(function* () {
      miss = yield* attempt(grab(body, far, { left: 'left', right: 'right' }, { until: 6 }));
      ended = true;
    }, [body], 7, () => ended);
    expect(ended).toBe(true);
    expect(miss).toBeInstanceOf(Missed);
    expect(body.holds(far)).toBe(false);
    const near = box(room, new Vector3(0, 1.1, 0.35), { solid: false, name: 'near' });
    ended = false;
    play(function* () {
      yield* grab(body, near, { left: 'left', right: 'right' });
      miss = yield* attempt(carry(body, near, new Vector3(0, 1.1, 1.3), { until: 6 }));
      ended = true;
    }, [body], 12, () => ended);
    expect(ended).toBe(true);
    expect(miss).toBeInstanceOf(Missed);
    expect(body.holds(near)).toBe(true);
  });
});

// (the trial that found it: a bearer's medal hanging from his still right hand by its ribbon's loop swung at 6 m/s as his left hand took
// the next one, riding the free twist of his wrist)
describe('a thing in one hand by a grip that sets no turn', () => {
  it.each([['the default person', () => person({ dev: true })], ['a 2.3 m skeleton', () => new Body(humanoid(CHEWBACCA), { dev: true })]])(
    'stays in the hand as it took it, turning no faster than the body, as the other hand bows for something low: %s', (_name, make) => {
      const body = make(), room = roomOf(body), scale = body.species.scale, hips = body.species.person?.hipHeight ?? 0;
      const medal = new Object3D();
      medal.name = 'medal';
      medal.userData.mass = 0.1;
      medal.position.set(-0.25 * scale, hips + 0.1 * scale, 0.3 * scale);
      empty(medal, 'loop', new Vector3(0, 0.34, 0));
      room.add(medal);
      // (low, half the hips' height: a bow down for it)
      const low = box(room, new Vector3(0.2 * scale, 0.5 * hips, 0.4 * scale), { size: new Vector3(0.1, 0.1, 0.1), mass: 0.3, name: 'low' });
      let took = false, kept: Quaternion | null = null, slipped = 0, fastest = 0;
      const was = new Quaternion();
      // (its turn in the hand it hangs from, and in the world)
      const inHand = () => medal.parent ? medal.parent.getWorldQuaternion(new Quaternion()).invert().multiply(medal.getWorldQuaternion(new Quaternion())) : new Quaternion();
      play(function* () {
        yield* grab(body, medal, { right: 'loop' });
        kept = inHand();
        was.setFromAxisAngle(new Vector3(0, 1, 0), -body.facing).multiply(medal.getWorldQuaternion(new Quaternion()));
        took = yield* grab(body, low, { left: 'right' });
      }, [body], 12, () => {
        if (!kept) return false;
        slipped = Math.max(slipped, inHand().angleTo(kept));
        const now = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -body.facing).multiply(medal.getWorldQuaternion(new Quaternion()));
        fastest = Math.max(fastest, now.angleTo(was) * 60);
        was.copy(now);
        return took;
      });
      expect(body.log).toEqual([]);
      expect(took).toBe(true);
      expect(body.holds(medal)).toBe(true);
      // (held as taken: the grasp fixes the hand on it)
      expect(slipped).toBeLessThan(0.01);
      // (turning with the hand kept on the bowing body: 0.7 rad/s at most for the default body, 3–5.7 for the 2.3 m one as the hand settles
      // from the take into its keep; not spun on a free wrist, 12 rad/s for the 2.3 m body when the medal kept its own turn)
      expect(fastest).toBeLessThan(8);
    });
});
