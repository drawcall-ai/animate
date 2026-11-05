import { CylinderGeometry, Line3, Mesh, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { SkeletonBone } from '@drawcall/rig';
import { Body, FIST, grab, humanoid, pose, release, wait } from '../../src/index';
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

  it('lift a finger back at its knuckle alone for a curl below 0', () => {
    const body = new Body(humanoid(FINGERED));
    roomOf(body);
    let knuckle = 0, middle = 0;
    play(function* () {
      yield* pose(body, { fingers: { right: { index: { curl: LIFTED, hook: 0 } } } }, { until: 0.5 });
      [knuckle, middle] = [bent(body, 'rightIndexProximal'), bent(body, 'rightIndexIntermediate')];
    }, [body], 1);
    expect(knuckle).toBeCloseTo(-LIFTED * (Math.PI / 2), 1);
    expect(middle).toBeLessThan(0.01);
  });

  it('are refused where a skeleton has some finger bones but not all, or none to pose', () => {
    expect(() => humanoid([...PERSON, { name: 'leftIndexProximal', parent: 'leftHand', position: [0.85, 1.41, 0] }])).toThrow(/finger bones but not/);
    expect(() => pose(person(), { fingers: { right: FIST } })).toThrow(/no finger bones/);
    expect(() => pose(new Body(humanoid(FINGERED)), { fingers: { right: { index: { curl: 2 } } } })).toThrow(/-0.35 … 1/);
    expect(() => pose(new Body(humanoid(FINGERED)), { fingers: { right: { thumb: { curl: -0.1 } } } })).toThrow(/0 … 1/);
    const both = empty(new Mesh(new CylinderGeometry(0.015, 0.015, 0.3)), 'grip', new Vector3());
    Object.assign(both.userData, { handle: [0, 1, 0], handTurn: true });
    expect(() => Thing.of(both.parent ?? both).grip('grip')).toThrow(/both userData.handle and userData.handTurn/);
  });
});
