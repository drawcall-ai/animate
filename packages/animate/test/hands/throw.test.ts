import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { attempt, Body, carry, grab, humanoid, Missed, throwAt, wait } from '../../src/index';
import { SOLDIER } from '../kit/skeletons/soldier';
import { PERSON } from '../../skills/animate/references/person';
import { person, play } from '../kit/bodies';
import { box, empty, roomOf, worldOf } from '../kit/things';

describe('throwAt', () => {
  it('keeps its planted feet on hips set below its pelvis as the pelvis turns into the throw', () => {
    const skeleton = PERSON.map((bone) => {
      const position: [number, number, number] = [...bone.position];
      if (bone.name.endsWith('UpperLeg')) position[1] -= 0.1;
      return { ...bone, position };
    });
    const body = new Body(humanoid(skeleton), { dev: true, life: { seed: 1 } }), room = roomOf(body);
    const ball = box(room, new Vector3(-0.25, 1.1, 0.35), { size: new Vector3(0.06, 0.06, 0.06), mass: 0.15, solid: false });
    Object.assign(empty(ball, 'body', new Vector3()).userData, { handle: [0, 1, 0], radius: 0.03 });
    let thrown = false;
    play(function* () {
      yield* grab(body, ball, { right: 'body' }, { step: false });
      thrown = yield* throwAt(body, ball, new Vector3(0, 1.2, 6));
      yield* wait(1);
    }, [body], 8);
    expect(thrown).toBe(true);
    expect(body.log).toEqual([]);
  });

  for (const [driven, height, low, soldier] of [[false, 1.75, true, false], [true, 1.8, false, true]] as const) it(`throws overhand at a target (${soldier ? 'the short-armed soldier' : `${height} m`}${driven ? ', its root driven' : ''}, taken from ${low ? 'low' : 'before the chest'}): cocked behind the head, whipped through, let go ahead of it aimed at the target, following through, and comes back up, the arm let hang`, () => {
    const root = { position: new Vector3(), velocity: new Vector3(), yaw: 0, support: new Vector3() };
    const options = { dev: true, ...(driven && { drive: () => root }) };
    const body: Body = soldier ? new Body(humanoid(SOLDIER), options) : person(options, height), room = roomOf(body);
    // (taken up from low, before the belly, or from before the chest)
    const ball = box(room, low ? new Vector3(-0.12, 0.55 * height, 0.28) : new Vector3(-0.25, 1.1, 0.35), { size: new Vector3(0.06, 0.1, 0.06), mass: 0.4, solid: false });
    Object.assign(empty(ball, 'body', new Vector3()).userData, { handle: [0, 1, 0], radius: 0.03 });
    const target = new Vector3(0, 0, 15);
    let behind = 0, thrown: Vector3 | null = null, after = new Vector3(), thrownFrom = new Vector3(), ended = false, done = false;
    let ahead = 0, upright = Infinity, raised = -Infinity, hand = new Vector3(), flip = 0, last: Quaternion | null = null;
    play(function* () {
      yield* grab(body, ball, { right: 'body' });
      yield* throwAt(body, ball, target, { released: ({ velocity }) => { thrown = velocity; thrownFrom = worldOf(ball); } });
      after = body.object.worldToLocal(body.bones.rightHand.getWorldPosition(new Vector3()));
      ended = true;
      yield* wait(1.5);
      done = true;
    }, [body], 8, () => {
      // (how far behind the head, at its height, the hand cocks the ball)
      const head = body.bones.head.getWorldPosition(new Vector3()), at = body.bones.rightHand.getWorldPosition(new Vector3());
      if (body.holds(ball) && Math.abs(at.y - head.y) < 0.15) behind = Math.max(behind, head.z - at.z);
      // (the upper arm's largest turn in a sub-step, in the chest's frame)
      const arm = body.bones.chest.getWorldQuaternion(new Quaternion()).invert().multiply(body.bones.rightUpperArm.getWorldQuaternion(new Quaternion()));
      if (last) flip = Math.max(flip, arm.angleTo(last));
      last = arm;
      if (ended) {
        // (once the throw has ended: how far ahead of the feet the head runs on, and how high the free hand swings above its shoulder)
        const local = body.object.worldToLocal(head.clone());
        ahead = Math.max(ahead, local.z);
        upright = local.z;
        raised = Math.max(raised, at.y - body.bones.rightUpperArm.getWorldPosition(new Vector3()).y);
        hand = body.object.worldToLocal(at.clone());
      }
      return done;
    });
    expect(behind).toBeGreaterThan(0.05);
    expect(ball.parent).toBe(room);
    // (aimed: on its arc from where it left the hand, it comes down at the target)
    const v = thrown ?? new Vector3(), flight = (2 * v.y) / 9.81 + 0.3;
    expect(Math.abs(thrownFrom.z + v.z * flight - target.z)).toBeLessThan(3);
    expect(after.y).toBeLessThan(1.1);
    // (the trunk checked rather than bowing on past the follow-through — bowing on, the head ran 0.5 m ahead of the feet — and upright again)
    expect(ahead).toBeLessThan(0.36);
    expect(upright).toBeLessThan(0.05);
    // (the arm, free, let hang by the side: taken over at its whip's speed, it flew up past the shoulder)
    expect(raised).toBeLessThan(-0.2);
    // (no flip of the elbow over the shoulder: a short-armed body's upper arm, its elbow let loose after the release, turned 130–180° in a
    // sub-step; a whip's own swing is under 60°)
    expect(flip).toBeLessThan(Math.PI / 3);
    expect(Math.abs(hand.x)).toBeLessThan(0.35 * height / 1.75);
    expect(body.log).toEqual([]);
  });

  // (crouched as its player drives it, a hand at its chest is no low reach: judged as from standing, the short-armed soldier bowed 57° for
  // a grenade carried up from its vest, its head came into the grenade's way and the carry failed; and it throws from the crouch, its wrist
  // within the joints' speeds — its windup's turn let run to 60 rad/s, the wrist turned at 3100°/s cocking the grenade)
  it('crouched, its root driven: takes a thing up from its chest to before its face, and throws it', () => {
    const root = { position: new Vector3(), velocity: new Vector3(), yaw: 0, crouch: 1 };
    const body = new Body(humanoid(SOLDIER), { dev: true, drive: () => root }), room = roomOf(body);
    play(function* () { yield* wait(1); }, [body], 1);
    const chest = body.object.worldToLocal(body.bones.chest.getWorldPosition(new Vector3()));
    const ball = box(room, new Vector3(-0.15, chest.y, 0.3), { size: new Vector3(0.06, 0.1, 0.06), mass: 0.4, solid: false });
    Object.assign(empty(ball, 'body', new Vector3()).userData, { handle: [0, 1, 0], facing: [0, 0, -1], radius: 0.035 });
    let carrying = false, carried = false, bowed = 0, done = false;
    play(function* () {
      if (!(yield* grab(body, ball, { right: 'body' }, { step: false }))) return;
      carrying = true;
      carried = yield* carry(body, ball, () => body.armPoint('right', new Vector3(0.3, 0.35, 1), 0.8), { step: false });
      carrying = false;
      yield* throwAt(body, ball, new Vector3(0, 0, 15));
      done = true;
    }, [body], 6, () => {
      if (carrying) bowed = Math.max(bowed, Math.asin(-new Vector3(0, 0, 1).applyQuaternion(body.bones.chest.getWorldQuaternion(new Quaternion())).y));
      return done;
    });
    expect(carried).toBe(true);
    expect(done).toBe(true);
    expect(bowed).toBeLessThan(0.6);
    expect(body.log).toEqual([]);
  });

  it('misses a target out of reach at the speed asked, after throwing as far as it goes', () => {
    const body = person({ dev: true }), room = roomOf(body);
    const ball = box(room, new Vector3(-0.25, 1.1, 0.35), { size: new Vector3(0.06, 0.1, 0.06), mass: 0.4, solid: false });
    Object.assign(empty(ball, 'body', new Vector3()).userData, { handle: [0, 1, 0], radius: 0.03 });
    const thrown: Vector3[] = [];
    let miss: Missed | null | undefined;
    play(function* () {
      yield* grab(body, ball, { right: 'body' });
      miss = yield* attempt(throwAt(body, ball, new Vector3(0, 0, 40), { speed: 5, released: ({ velocity }) => void thrown.push(velocity.clone()) }));
    }, [body], 8, () => miss !== undefined);
    expect(thrown[0].length()).toBeCloseTo(5, 6);
    expect(miss).toMatchObject({ verb: 'throwAt', where: 'box' });
  });
});
