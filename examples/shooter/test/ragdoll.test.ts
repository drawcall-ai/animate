import { expect, it } from 'vitest';
import { RigidBody } from '@drawcall/physics';
import { Vector3, type Object3D } from 'three';
import { box, DT, soldiers } from './course';

const dynamic = (root: Object3D) => {
  const bodies: RigidBody[] = [];
  root.traverse((node) => { if (node instanceof RigidBody && node.bodyType === 'dynamic') bodies.push(node); });
  return bodies;
};

it('a soldier shot dead falls limp along the shot, stays in one piece, sleeps within 6 s, sees from its head, and is cleared on respawn', async () => {
  const { scene, world, soldiers: [soldier] } = await soldiers((scene) => box(scene, [20, 1, 20], [0, -0.5, 0], 'static', 'Ground'),
    ['Opponent', new Vector3(0, 0.04, 0), false]);
  for (let frame = 0; frame < 4; frame++) world.update(DT);
  for (let frame = 0; frame < 180; frame++) soldier.update(DT);
  world.onAfterStep((dt) => soldier.update(dt));
  const { bones } = soldier.avatar.body;
  // Every bone but the root, by its distance from its parent.
  const offsets = Object.values(bones).filter((bone) => bone !== bones.hips).map((bone) => [bone, bone.position.length()] as const);
  const chest = bones.chest.getWorldPosition(new Vector3());

  soldier.hurt(100, chest, new Vector3(0, 0, 1));
  expect(soldier.alive).toBe(false);
  const remains = dynamic(soldier.remains);
  expect(remains).toHaveLength(12);
  for (let frame = 0; frame < 360; frame++) world.update(DT);
  const hips = bones.hips.getWorldPosition(new Vector3());

  // Down on the ground, knocked along the shot, and asleep: nothing trembles on its joint limits.
  expect(hips.y).toBeLessThan(0.35);
  expect(hips.z).toBeGreaterThan(chest.z);
  for (const body of remains) {
    const { linear, angular } = body.getVelocity();
    expect(linear.length() + angular.length()).toBeLessThan(1e-3);
  }
  // The dead see from the head, the view still while the head is.
  const view = soldier.look();
  expect(view.eye.distanceTo(bones.head.getWorldPosition(new Vector3()))).toBeLessThan(0.2);
  for (let frame = 0; frame < 30; frame++) world.update(DT);
  const later = soldier.look();
  expect(later.yaw).toBeCloseTo(view.yaw, 6);
  expect(later.pitch).toBeCloseTo(view.pitch, 6);
  // Every bone hangs from its parent as it did standing: the joints held.
  for (const [bone, length] of offsets) {
    expect(Number.isFinite(bone.position.length())).toBe(true);
    expect(Math.abs(bone.position.length() - length)).toBeLessThan(0.03);
  }
  for (const bone of [bones.head, bones.leftFoot, bones.rightHand]) expect(bone.getWorldPosition(new Vector3()).y).toBeGreaterThan(-0.05);

  soldier.reset();
  expect(dynamic(scene)).toHaveLength(0);
  for (let frame = 0; frame < 60; frame++) world.update(DT);
  expect(soldier.avatar.body.bones.head.getWorldPosition(new Vector3()).y).toBeGreaterThan(1.5);
}, 30_000);
