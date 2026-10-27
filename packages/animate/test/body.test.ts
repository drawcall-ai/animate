import { Bone, Group, Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { bone, type SkeletonBone } from '@drawcall/rig';
import { Body, dog, horse, humanoid } from '../src/index';
import { BONES, INDEX } from '../src/species/humanoid/bones';
import { claim, dt, insides, person, run } from './bodies';
import { rng } from './random';
import { resolve } from '../src/things/resolve';
import { PERSON } from './skeletons/person';
import { HORSE } from './skeletons/horse';
import { DOG } from './skeletons/dog';

describe('a body', () => {
  it('steps in fixed sub-steps whatever its frames: jittered frames give what fixed ones do', () => {
    const fixed = person({ life: { seed: 2 } }), jittered = person({ life: { seed: 2 } }), rand = rng(5);
    const spin = (body: Body) => claim(body, 'hand.left', (f) => f.current.setLocal(INDEX.leftLowerArm, new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.sin(3 * f.time))));
    spin(fixed);
    spin(jittered);
    let time = 0;
    while (time < 2 - 1e-9) {
      const frame = Math.min(2 - time, (0.2 + 1.6 * rand()) * dt);
      jittered.update(frame);
      time += frame;
    }
    run(fixed, 2);
    for (let bone = 0; bone < fixed.pose.skeleton.bones.length; bone++) expect(jittered.pose.local(bone).angleTo(fixed.pose.local(bone))).toBeLessThan(1e-6);
  });

  it('reads an app-owned world matrix under a moving bone, interpolating it across sub-steps', () => {
    const body = person(), mount = new Group(), target = new Group(), samples: number[][] = [];
    body.bones.chest.add(mount);
    mount.add(target);
    mount.matrixWorldAutoUpdate = target.matrixAutoUpdate = false;
    target.matrix.makeTranslation(0.1, 0, 0);
    claim(body, 'trunk', (f) => f.current.setLocal(INDEX.chest, new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), f.time)));
    claim(body, 'hand.right', () => { samples.push(resolve(insides(body), target, { position: new Vector3(), quaternion: new Quaternion() }).position.toArray()); });
    body.update(dt);
    mount.matrixWorld.makeTranslation(2, 1, 3);
    body.update(2 * dt);
    expect(samples).toEqual([[0.1, 0, 0], [1.1, 0.5, 1.5], [2.1, 1, 3]]);
  });

  it('takes at most 0.1 s of a frame: a stall is not run through', () => {
    const body = person(), walked = person();
    body.update(5);
    run(walked, 0.1);
    expect(body.pose.position(0).distanceTo(walked.pose.position(0))).toBeLessThan(1e-9);
  });

  it('places its object on the floor under its root, turned by its facing alone, and writes its bones from its pose', () => {
    const body = person({ at: new Vector3(2, 0, -1), face: 1 });
    run(body, 0.5);
    const root = body.pose.position(0);
    expect(body.object.position.toArray()).toEqual([root.x, 0, root.z]);
    expect(body.object.quaternion.angleTo(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), body.facing))).toBeLessThan(1e-9);
    body.object.updateMatrixWorld(true);
    for (const name of BONES) {
      const node = body.bones[name], index = INDEX[name];
      expect(node.getWorldPosition(new Vector3()).distanceTo(body.pose.position(index)), name).toBeLessThan(1e-6);
      // (a bare body's bones stand at rest as rig builds them: unturned, its T-pose's limbs straight)
      expect(node.getWorldQuaternion(new Quaternion()).angleTo(body.pose.rotation(index)), name).toBeLessThan(1e-6);
    }
  });

  it("poses a rigged model's own bones through their rest turns: an A-pose's arms, an extra bone, a container turned and scaled", () => {
    // (the skeleton in an A-pose: each arm turned 45° down about its shoulder joint, as most character meshes are rigged)
    const down = (side: 'left' | 'right') => new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), side === 'left' ? -Math.PI / 4 : Math.PI / 4);
    const posed = PERSON.map((entry): SkeletonBone<(typeof PERSON)[number]['name']> => {
      const side = /^(left|right)(LowerArm|Hand|Hand_end)$/.exec(entry.name)?.[1];
      if (side !== 'left' && side !== 'right') return entry;
      const shoulder = new Vector3(...(PERSON.find((b) => b.name === `${side}UpperArm`)?.position ?? [0, 0, 0]));
      const at = new Vector3(...entry.position).sub(shoulder).applyQuaternion(down(side)).add(shoulder);
      return { ...entry, position: [at.x, at.y, at.z] as const };
    });
    const container = new Group();
    const nodes = new Map<string, Bone>();
    for (const entry of posed) nodes.set(entry.name, bone(entry.name, [...entry.position], entry.parent ? nodes.get(entry.parent) : undefined));
    const hips = nodes.get('hips');
    if (!hips) throw new Error('no hips');
    container.add(hips);
    const body = new Body(humanoid(posed), { model: container, face: 0.3 });
    const bare = person({ face: 0.3 });
    expect(body.bones.leftHand).toBe(nodes.get('leftHand'));
    run(body, 1);
    run(bare, 1);
    body.object.updateMatrixWorld(true);
    for (const [name, index] of Object.entries(INDEX)) {
      const node = nodes.get(name);
      if (!node) continue;
      expect(node.getWorldPosition(new Vector3()).distanceTo(body.pose.position(index)), name).toBeLessThan(1e-6);
    }
    // (an A-pose measures as the T-pose it is: the same person, moving the same way)
    expect(body.pose.position(INDEX.leftHand).distanceTo(bare.pose.position(INDEX.leftHand))).toBeLessThan(1e-6);
    // (an end bone follows its parent at rest)
    const tip = nodes.get('leftHand_end')?.getWorldPosition(new Vector3()), hand = nodes.get('leftHand');
    if (!tip || !hand) throw new Error('no hand');
    expect(tip.distanceTo(new Vector3(0.108 * 1.75 * Math.SQRT1_2, -0.108 * 1.75 * Math.SQRT1_2, 0).applyMatrix4(hand.matrixWorld))).toBeLessThan(1e-6);
  });

  it('throws on a model without a bone its species moves', () => {
    const container = new Group();
    container.add(bone('hips', [0, 0.9, 0]));
    expect(() => new Body(humanoid(PERSON), { model: container })).toThrow(/no bone named spine/);
  });

  it('is a horse or a dog of its skeleton, weighing what its species does, standing still', () => {
    const mare = new Body(horse(HORSE), { dev: true }), labrador = new Body(dog(DOG), { dev: true });
    run(mare, 2);
    run(labrador, 2);
    // (a 16 hh warmblood's segments, Buchner's shares of ~500 kg; a Labrador's)
    expect(mare.species.mass).toBeCloseTo(498, 6);
    expect(labrador.species.mass).toBeCloseTo(36.6, 6);
    for (const body of [mare, labrador]) {
      expect(body.log).toEqual([]);
      expect(body.settled).toBe(true);
      expect(body.velocity.length()).toBeLessThan(0.05);
    }
  });

  it('weighs what it is told, or a closed mesh at 1000 kg/m³, kept within half and twice its species', () => {
    const told = person({ mass: 90 }), meshed = person({ mass: { closed: true, volume: 0.07 } }), open = person({ mass: { closed: false, volume: null } });
    const total = (body: Body) => body.pose.skeleton.bones.reduce((sum, b) => sum + b.mass, 0);
    expect(total(told)).toBeCloseTo(90, 6);
    expect(total(meshed)).toBeCloseTo(70, 6);
    expect(total(open)).toBeCloseTo(humanoid(PERSON).mass, 6);
  });

  it('reads another body as it was before its update this frame, whichever updates first', () => {
    const first = person({ drive: (time) => ({ position: new Vector3(0.5 * time, 0, 0), velocity: new Vector3(0.5, 0, 0), yaw: 0 }) });
    const seen: number[] = [];
    const watcher = person({ at: new Vector3(0, 0, 2) });
    claim(watcher, 'look', () => { seen.push(first.position.x); });
    for (let k = 0; k < 30; k++) {
      first.update(dt);
      watcher.update(dt);
    }
    const reversed: number[] = [];
    const other = person({ drive: (time) => ({ position: new Vector3(0.5 * time, 0, 0), velocity: new Vector3(0.5, 0, 0), yaw: 0 }) });
    const second = person({ at: new Vector3(0, 0, 2) });
    claim(second, 'look', () => { reversed.push(other.position.x); });
    for (let k = 0; k < 30; k++) {
      second.update(dt);
      other.update(dt);
    }
    expect(reversed).toEqual(seen);
  });
});
