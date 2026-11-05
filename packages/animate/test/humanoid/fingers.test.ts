import { Box3, BoxGeometry, CylinderGeometry, Line3, Mesh, Quaternion, Ray, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { SkeletonBone } from '@drawcall/rig';
import { Body, FIST, grab, humanoid, pose, release, wait } from '../../src/index';
import { PERSON } from '../../skills/animate/references/person';
import { reaching } from '../../src/fingers/closing';
import { Joints } from '../../src/fingers/joints';
import { LIFTED, shapeOf } from '../../src/fingers/shape';
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
  it('close round a handle a hand grabs, none through it, and open as the hand lets go', () => {
    const body = new Body(humanoid(FINGERED)), room = roomOf(body);
    // (a 3 cm rod held across the palm, in front of the right hip)
    const rod = new Mesh(new CylinderGeometry(0.015, 0.015, 0.3, 16));
    rod.name = 'rod';
    rod.userData.mass = 0.5;
    rod.position.set(-0.25, 0.95, 0.35);
    rod.rotation.x = Math.PI / 2;
    // (a handle along its length, its radius measured: the thumb forward, the palm facing in toward the body's middle)
    Object.assign(empty(rod, 'grip', new Vector3()).userData, { handle: [0, 1, 0], palm: [1, 0, 0] });
    room.add(rod);
    let closed = 0, gaps: number[] = [];
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
      release(body, rod);
      yield* wait(1);
    }, [body], 6);
    expect(closed).toBeGreaterThan(0.8);
    for (const gap of gaps) {
      expect(gap).toBeGreaterThan(0.015);
      expect(gap).toBeLessThan(0.035);
    }
    expect(bent(body, 'rightMiddleIntermediate')).toBeLessThan(0.5);
  });

  it('reach a pad toward an empty no nearer than keeps it out of the thing', () => {
    const species = humanoid(FINGERED), body = new Body(species), fingers = species.fingers;
    if (!fingers) throw new Error('no finger bones');
    const hand = body.bones.rightHand, joints = new Joints(hand, fingers.right, body.bones, 'right', []);
    hand.updateWorldMatrix(true, true);
    // (a plate just under the straight index — the palm faces down — and an empty under the plate, below the finger's middle)
    const knuckle = body.bones.rightIndexProximal.getWorldPosition(new Vector3()), tip = body.bones.rightIndexDistal.getWorldPosition(new Vector3());
    const middle = knuckle.clone().lerp(tip, 0.5), plate = new Mesh(new BoxGeometry(0.2, 0.004, 0.06));
    plate.position.copy(middle).add(new Vector3(0, -0.02, 0));
    roomOf(body).add(plate);
    plate.updateMatrixWorld(true);
    const target = hand.worldToLocal(middle.clone().add(new Vector3(0, -0.05, 0)));
    const shape = shapeOf({});
    reaching(joints, plate, shape, 'index', target, true);
    const box = new Box3().setFromObject(plate), through = joints.segments('index', shape).filter(([start, end]) => {
      const hit = new Ray(start, end.clone().sub(start).normalize()).intersectBox(box, new Vector3());
      return hit !== null && hit.distanceTo(start) <= end.distanceTo(start);
    });
    expect(through).toEqual([]);
    expect(joints.pad('index', shape, new Vector3()).applyMatrix4(hand.matrixWorld).y).toBeGreaterThan(plate.position.y);
  });

  it('take a handle with its palm turned as far as the wrist turns it so, where it cannot be turned all the way', () => {
    const body = new Body(humanoid(FINGERED)), room = roomOf(body);
    // (the rod in front of the right hip, its palm asked out away from the body's middle, the thumb forward: past the forearm's turn)
    const rod = new Mesh(new CylinderGeometry(0.015, 0.015, 0.3, 16));
    rod.name = 'rod';
    rod.position.set(-0.25, 0.95, 0.35);
    rod.rotation.x = Math.PI / 2;
    Object.assign(empty(rod, 'grip', new Vector3()).userData, { handle: [0, 1, 0], palm: [-1, 0, 0] });
    room.add(rod);
    let held = false, off = Infinity;
    play(function* () {
      held = yield* grab(body, rod, { right: 'grip' });
      yield* wait(0.5);
      off = rod.getWorldPosition(new Vector3()).distanceTo(body.bones.rightHand.getWorldPosition(new Vector3()));
    }, [body], 4);
    expect(held).toBe(true);
    expect(off).toBeLessThan(0.12);
  });

  it('lay what a grip asks over a hand its app poses, closed on the grip', () => {
    const body = new Body(humanoid(FINGERED)), room = roomOf(body);
    const rod = new Mesh(new CylinderGeometry(0.015, 0.015, 0.3, 16));
    rod.position.set(-0.25, 0.95, 0.35);
    rod.rotation.x = Math.PI / 2;
    // (the index asked straight, off the rod the others close on)
    const grip = empty(rod, 'grip', new Vector3());
    Object.assign(grip.userData, { handle: [0, 1, 0], palm: [1, 0, 0], fingers: { index: { curl: 0, hook: 0 } } });
    room.add(rod);
    // (the hand bone put where it holds the rod, as a puppet would)
    const hand = body.bones.rightHand, arm = hand.parent, { wrist, rotation } = body.gripOn('right', grip);
    if (!arm) throw new Error('no forearm');
    arm.updateWorldMatrix(true, false);
    hand.position.copy(arm.worldToLocal(wrist));
    hand.quaternion.copy(arm.getWorldQuaternion(new Quaternion()).invert().multiply(rotation));
    hand.updateMatrixWorld(true);
    for (let k = 0; k < 20; k++) body.fingers('right', grip, 0.05);
    expect(bent(body, 'rightIndexIntermediate')).toBeLessThan(0.05);
    expect(bent(body, 'rightMiddleIntermediate')).toBeGreaterThan(0.8);
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
    expect(bent(body, 'rightIndexIntermediate')).toBeLessThan(0.6);
    expect(bent(body, 'leftIndexIntermediate')).toBeLessThan(0.6);
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

  it('are refused where a skeleton has some finger bones but not all, or none to pose', () => {
    expect(() => humanoid([...PERSON, { name: 'leftIndexProximal', parent: 'leftHand', position: [0.85, 1.41, 0] }])).toThrow(/finger bones but not/);
    expect(() => pose(person(), { fingers: { right: FIST } })).toThrow(/no finger bones/);
    expect(() => pose(new Body(humanoid(FINGERED)), { fingers: { right: { index: { curl: 2 } } } })).toThrow(/-0.15 … 1/);
    expect(() => pose(new Body(humanoid(FINGERED)), { fingers: { right: { thumb: { curl: -0.1 } } } })).toThrow(/0 … 1/);
    const both = empty(new Mesh(new CylinderGeometry(0.015, 0.015, 0.3)), 'grip', new Vector3());
    Object.assign(both.userData, { handle: [0, 1, 0], handTurn: true });
    expect(() => Thing.of(both.parent ?? both).grip('grip')).toThrow(/both userData.handle and userData.handTurn/);
  });
});
