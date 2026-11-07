import { BoxGeometry, CylinderGeometry, Line3, Mesh, Quaternion, SphereGeometry, TorusGeometry, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { SkeletonBone } from '@drawcall/rig';
import { Body, carry, FIST, grab, humanoid, pose, release, wait } from '../../src/index';
import { selfOf } from '../../src/body/body';
import { PERSON } from '../../skills/animate/references/person';
import { LIFTED } from '../../src/fingers/shape';
import { Thing } from '../../src/things/thing';
import { person, play } from '../bodies';
import { empty, roomOf } from '../things';

/** the reference person with VRM finger bones, laid out in its T-pose: palms down, thumbs forward, each finger straight out */
const FINGERED: SkeletonBone[] = [...PERSON, ...(['left', 'right'] as const).flatMap((side) => {
  const hand = PERSON.find((bone) => bone.name === `${side}Hand`);
  if (!hand) throw new Error('no hand');
  const out = side === 'left' ? 1 : -1, [x, y, z] = hand.position;
  const digit = (name: string, joints: readonly string[], across: number, step: Vector3, from: Vector3) => joints.map((joint, k) => ({
    name: `${side}${name}${joint}`, parent: k === 0 ? `${side}Hand` : `${side}${name}${joints[k - 1]}`,
    position: from.clone().addScaledVector(step, k).add(new Vector3(x, y, z + across)).toArray(),
  }));
  const finger = ['Proximal', 'Intermediate', 'Distal'];
  return [
    ...digit('Thumb', ['Metacarpal', 'Proximal', 'Distal'], 0.02, new Vector3(out * 0.025, -0.01, 0.025), new Vector3(out * 0.025, -0.01, 0)),
    ...digit('Index', finger, 0.025, new Vector3(out * 0.028, 0, 0), new Vector3(out * 0.09, 0, 0)),
    ...digit('Middle', finger, 0.005, new Vector3(out * 0.03, 0, 0), new Vector3(out * 0.093, 0, 0)),
    ...digit('Ring', finger, -0.015, new Vector3(out * 0.028, 0, 0), new Vector3(out * 0.088, 0, 0)),
    ...digit('Little', finger, -0.033, new Vector3(out * 0.022, 0, 0), new Vector3(out * 0.08, 0, 0)),
  ];
})];

/** how far bone `name` of `body` is bent off its rest (rad) */
const bent = (body: Body, name: string) => 2 * Math.acos(Math.min(1, Math.abs(body.bones[name].quaternion.w)));

describe('fingers', () => {
  it('close round a handle a hand grabs, none through it, the thumb round its far side, and open as the hand lets go', () => {
    const body = new Body(humanoid(FINGERED)), room = roomOf(body);
    // (a 3 cm rod held across the palm, in front of the right hip)
    const rod = new Mesh(new CylinderGeometry(0.015, 0.015, 0.3, 16));
    rod.name = 'rod';
    rod.userData.mass = 0.5;
    rod.position.set(-0.25, 0.95, 0.35);
    rod.rotation.x = Math.PI / 2;
    // (a handle along its length, its radius measured: the thumb forward, the palm facing in toward the body's middle)
    Object.assign(empty(rod, 'grip', new Vector3()).userData, { handle: [0, 1, 0], facing: [1, 0, 0] });
    room.add(rod);
    let closed = 0, gaps: number[] = [], round = 0;
    play(function* () {
      if (!(yield* grab(body, rod, { right: 'grip' }))) throw new Error('the hand did not take the rod');
      yield* wait(1);
      // (each finger's end joint against the rod, outside it: its pad a finger's half thickness further in)
      const axis = new Line3(rod.localToWorld(new Vector3(0, -0.15, 0)), rod.localToWorld(new Vector3(0, 0.15, 0)));
      gaps = ['Index', 'Middle', 'Ring', 'Little'].map((finger) => {
        const joint = body.bones[`right${finger}Distal`].getWorldPosition(new Vector3());
        return axis.closestPointToPoint(joint, true, new Vector3()).distanceTo(joint);
      });
      closed = bent(body, 'rightMiddleIntermediate');
      // (the thumb round onto the rod's far side from the palm: the way out to it from the axis against the way out to the knuckles)
      const at = (bone: string) => { const point = body.bones[bone].getWorldPosition(new Vector3()); return point.sub(axis.closestPointToPoint(point, false, new Vector3())).normalize(); };
      round = at('rightThumbDistal').dot(at('rightMiddleProximal'));
      release(body, rod);
      yield* wait(1);
    }, [body], 6);
    expect(closed).toBeGreaterThan(0.8);
    for (const gap of gaps) {
      expect(gap).toBeGreaterThan(0.015);
      expect(gap).toBeLessThan(0.035);
    }
    expect(round).toBeLessThan(0);
    expect(bent(body, 'rightMiddleIntermediate')).toBeLessThan(closed - 0.1);
  });

  it('take a handle with its palm turned as far as the wrist turns it so, where it cannot be turned all the way', () => {
    const body = new Body(humanoid(FINGERED)), room = roomOf(body);
    // (the rod in front of the right hip, its palm asked out away from the body's middle, the thumb forward: past the forearm's turn)
    const rod = new Mesh(new CylinderGeometry(0.015, 0.015, 0.3, 16));
    rod.name = 'rod';
    rod.position.set(-0.25, 0.95, 0.35);
    rod.rotation.x = Math.PI / 2;
    Object.assign(empty(rod, 'grip', new Vector3()).userData, { handle: [0, 1, 0], facing: [-1, 0, 0] });
    room.add(rod);
    let held = false, off = Infinity;
    play(function* () {
      held = yield* grab(body, rod, { right: 'grip' });
      yield* wait(0.5);
      off = rod.getWorldPosition(new Vector3()).distanceTo(body.bones.rightHand.getWorldPosition(new Vector3()));
    }, [body], 4);
    expect(held).toBe(true);
    expect(off).toBeLessThan(0.13);
  });

  it('press a button with one grab, the pad on its face, and draw back off it on release', () => {
    const body = new Body(humanoid(FINGERED)), room = roomOf(body);
    const hand = body.bones.rightHand;
    // (a button on a panel's face ahead of the right shoulder, pushed straight in)
    const panel = new Mesh(new BoxGeometry(0.2, 0.2, 0.02));
    panel.name = 'panel';
    panel.position.set(-0.2, 1.2, 0.5);
    const button = empty(panel, 'button', new Vector3(0, 0, -0.012));
    Object.assign(button.userData, { pad: 'index', facing: [0, 0, 1] });
    room.add(panel);
    let held = false, off = Infinity, back = 0;
    play(function* () {
      held = yield* grab(body, panel, { right: 'button' });
      yield* wait(0.5);
      const at = button.getWorldPosition(new Vector3());
      // (the index's tip: its last segment carried on as long again as four fifths of it)
      const distal = body.bones.rightIndexDistal.getWorldPosition(new Vector3()), middle = body.bones.rightIndexIntermediate.getWorldPosition(new Vector3());
      off = distal.clone().lerp(middle, -0.8).distanceTo(at);
      const pressing = hand.getWorldPosition(new Vector3());
      release(body, panel);
      yield* wait(0.3);
      back = pressing.z - hand.getWorldPosition(new Vector3()).z;
    }, [body], 4);
    expect(held).toBe(true);
    expect(off).toBeLessThan(0.01);
    expect(back).toBeGreaterThan(0.03);
  });

  it('lay what a grip asks over a hand its app poses, closed on the grip', () => {
    const body = new Body(humanoid(FINGERED)), room = roomOf(body);
    const rod = new Mesh(new CylinderGeometry(0.015, 0.015, 0.3, 16));
    rod.position.set(-0.25, 0.95, 0.35);
    rod.rotation.x = Math.PI / 2;
    // (the index asked straight, off the rod the others close on)
    const grip = empty(rod, 'grip', new Vector3());
    Object.assign(grip.userData, { handle: [0, 1, 0], facing: [1, 0, 0], fingers: { index: { curl: 0, hook: 0 } } });
    room.add(rod);
    // (the hand bone put where its placement holds the rod, as a puppet would)
    const placement = body.placement('right', grip), hand = body.bones.rightHand, arm = hand.parent, { wrist, rotation } = body.gripOn('right', placement);
    if (!arm) throw new Error('no forearm');
    arm.updateWorldMatrix(true, false);
    hand.position.copy(arm.worldToLocal(wrist));
    hand.quaternion.copy(arm.getWorldQuaternion(new Quaternion()).invert().multiply(rotation));
    hand.updateMatrixWorld(true);
    for (let k = 0; k < 20; k++) body.shapeHand('right', placement, 0.05);
    expect(bent(body, 'rightIndexIntermediate')).toBeLessThan(0.05);
    expect(bent(body, 'rightMiddleIntermediate')).toBeGreaterThan(0.8);
  });

  it('take a grip the same however the hand comes to it, the fingers never moving the hand', () => {
    /** where the right hand ends on a rod that leaves its roll free, and how far its middle finger closes, the arm first raised `raised` */
    const taken = (raised: number) => {
      const body = new Body(humanoid(FINGERED), { dev: true }), room = roomOf(body);
      const rod = new Mesh(new CylinderGeometry(0.015, 0.015, 0.3, 16));
      rod.name = 'rod';
      rod.userData.mass = 0.5;
      rod.position.set(-0.25, 0.95, 0.35);
      rod.rotation.x = Math.PI / 2;
      Object.assign(empty(rod, 'grip', new Vector3()).userData, { handle: [0, 1, 0] });
      room.add(rod);
      let held = false;
      play(function* () {
        yield* pose(body, { arms: { right: { forward: raised, out: raised / 2 } } }, { until: 0.6 });
        held = yield* grab(body, rod, { right: 'grip' });
        yield* wait(0.5);
      }, [body], 4, () => false);
      expect(held, JSON.stringify(body.log)).toBe(true);
      rod.updateWorldMatrix(true, false);
      const back = rod.matrixWorld.clone().invert(), hand = body.bones.rightHand;
      return { at: hand.getWorldPosition(new Vector3()).applyMatrix4(back), turn: rod.getWorldQuaternion(new Quaternion()).invert().multiply(hand.getWorldQuaternion(new Quaternion())), closed: bent(body, 'rightMiddleIntermediate') };
    };
    const low = taken(0), high = taken(1);
    expect(low.at.distanceTo(high.at)).toBeLessThan(0.002);
    expect(low.turn.angleTo(high.turn)).toBeLessThan(0.02);
    expect(Math.abs(low.closed - high.closed)).toBeLessThan(0.02);
  });

  it('take the shape a pose asks of a free hand, then ease back to relaxed', () => {
    const body = new Body(humanoid(FINGERED));
    roomOf(body);
    let fisted = 0;
    play(function* () {
      yield* pose(body, { fingers: { right: FIST } }, { until: 0.5 });
      fisted = bent(body, 'rightIndexIntermediate');
      yield* wait(1);
    }, [body], 2);
    expect(fisted).toBeGreaterThan(1.4);
    expect(bent(body, 'rightIndexIntermediate')).toBeLessThan(0.8);
    expect(bent(body, 'leftIndexIntermediate')).toBeLessThan(0.8);
  });

  it('lie along the palm with no curl where the skin rests them curled in at the knuckles, and lift a little past it below 0', () => {
    // (the right middle finger rigged bent 30° down toward the palm at its knuckle, its outer joints straight on from there)
    const knuckle = FINGERED.find((bone) => bone.name === 'rightMiddleProximal');
    if (!knuckle) throw new Error('no knuckle');
    const step = new Vector3(-0.03 * Math.cos(Math.PI / 6), -0.03 * Math.sin(Math.PI / 6), 0), from = new Vector3(...knuckle.position);
    const body = new Body(humanoid(FINGERED.map((bone) => {
      const k = ['rightMiddleIntermediate', 'rightMiddleDistal'].indexOf(bone.name);
      return k < 0 ? bone : { ...bone, position: from.clone().addScaledVector(step, k + 1).toArray() };
    })));
    roomOf(body);
    const at = (name: string) => body.bones[name].getWorldPosition(new Vector3());
    // (the first segment's way, and its turn off the hand's line)
    const segment = () => at('rightMiddleIntermediate').sub(at('rightMiddleProximal'));
    const off = () => segment().angleTo(at('rightMiddleProximal').sub(at('rightHand')));
    let straight = Infinity, lifted = 0, apart = 0;
    play(function* () {
      yield* pose(body, { fingers: { right: { middle: { curl: 0, hook: 0 } } } }, { until: 0.5 });
      straight = off();
      // (lifted, then curled as far toward the palm: twice as far apart as either is off the line, not one on the other)
      yield* pose(body, { fingers: { right: { middle: { curl: LIFTED, hook: 0 } } } }, { until: 0.5 });
      const up = segment();
      lifted = off();
      yield* pose(body, { fingers: { right: { middle: { curl: -LIFTED, hook: 0 } } } }, { until: 0.5 });
      apart = up.angleTo(segment());
    }, [body], 2);
    expect(straight).toBeLessThan(0.1);
    expect(lifted).toBeCloseTo(-LIFTED * (Math.PI / 2), 1);
    expect(apart).toBeCloseTo(-2 * LIFTED * (Math.PI / 2), 1);
  });

  it('end a grab that stops short of its grip false, soon after its plan, saying so: a ring held on the grenade\'s far side', () => {
    const body = new Body(humanoid(FINGERED), { dev: true }), room = roomOf(body);
    const grenade = new Mesh(new SphereGeometry(0.032, 16, 12));
    grenade.name = 'grenade';
    grenade.userData.mass = 0.4;
    grenade.position.set(-0.2, 1.0, 0.35);
    Object.assign(empty(grenade, 'body', new Vector3()).userData, { handle: [0, 1, 0], facing: [0, 0, -1], radius: 0.032 });
    const pin = empty(grenade, 'pin', new Vector3());
    pin.userData.mass = 0.01;
    const ring = new Mesh(new TorusGeometry(0.011, 0.0016, 6, 20).rotateY(Math.PI / 2));
    ring.position.set(0, 0.045, -0.027);
    pin.add(ring);
    Object.assign(empty(pin, 'ring', new Vector3(0, 0.045, -0.038)).userData, { handle: [0, 1, 0], facing: [0, 0, 1], radius: 0.0016 });
    room.add(grenade);
    let hooked: boolean | undefined, began = 0, ended = 0;
    play(function* () {
      yield* grab(body, grenade, { right: 'body' });
      yield* carry(body, grenade, new Vector3(-0.08, 1.12, 0.32), { step: false });
      began = selfOf(body).time;
      hooked = yield* grab(body, pin, { left: 'ring' });
      ended = selfOf(body).time;
    }, [body], 10, () => hooked !== undefined);
    expect(hooked).toBe(false);
    expect(ended - began).toBeLessThan(3);
    expect(body.log.map(({ check }) => check)).toContain('late reach: distance (m)');
  });

  it('are refused where a skeleton has some finger bones but not all, or none to pose', () => {
    expect(() => humanoid([...PERSON, { name: 'leftIndexProximal', parent: 'leftHand', position: [0.85, 1.41, 0] }])).toThrow(/finger bones but not/);
    expect(() => pose(person(), { fingers: { right: FIST } })).toThrow(/no finger bones/);
    expect(() => pose(new Body(humanoid(FINGERED)), { fingers: { right: { index: { curl: 2 } } } })).toThrow(/-0.15 … 1/);
    expect(() => pose(new Body(humanoid(FINGERED)), { fingers: { right: { thumb: { curl: -0.1 } } } })).toThrow(/0 … 1/);
    const both = empty(new Mesh(new CylinderGeometry(0.015, 0.015, 0.3)), 'grip', new Vector3());
    Object.assign(both.userData, { handle: [0, 1, 0], pad: 'index' });
    expect(() => Thing.of(both.parent ?? both).grip('grip')).toThrow(/both userData.pad and userData.handle/);
    Object.assign(both.userData, { handle: undefined, pad: 'pinky' });
    expect(() => Thing.of(both.parent ?? both).grip('grip')).toThrow(/a hand has a thumb/);
  });
});
