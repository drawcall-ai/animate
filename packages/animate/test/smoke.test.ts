import { CapsuleGeometry, Group, Mesh, MeshBasicMaterial, Scene, SkinnedMesh, Vector3 } from 'three';
import { parallel, runTimeline } from '@pmndrs/timeline';
import { skin } from '@drawcall/rig';
import { expect, it } from 'vitest';
import { Body, horse, humanoid, lookAt, walkTo } from '../src/index';
import { dt } from './bodies';
import { named } from './things';
import { HORSE } from './skeletons/horse';
import { PERSON } from './skeletons/person';

/** a capsule from `a` to `b` (model space, m), `radius` thick */
function capsule(a: Vector3, b: Vector3, radius: number): Mesh {
  const length = a.distanceTo(b);
  const mesh = new Mesh(new CapsuleGeometry(radius, Math.max(0.01, length), 4, 8), new MeshBasicMaterial());
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), b.clone().sub(a).normalize());
  return mesh;
}

/** a crude mesh along a skeleton's bones: a capsule from each bone to each child */
function meshOf(skeleton: readonly { name: string; parent?: string; position: readonly number[] }[], radius: number): Group {
  const container = new Group(), at = new Map(skeleton.map((bone) => [bone.name, new Vector3(...bone.position)]));
  for (const bone of skeleton) {
    const parent = bone.parent && at.get(bone.parent), end = at.get(bone.name);
    if (parent && end) container.add(capsule(parent, end, radius));
  }
  return container;
}

it('drives a person rigged with @drawcall/rig and a horse following it, on a timeline as an app runs it', async () => {
  const scene = new Scene();
  const personModel = meshOf(PERSON, 0.05), horseModel = meshOf(HORSE, 0.08);
  const personReport = await skin(personModel, PERSON, 48);
  await skin(horseModel, HORSE, 48);
  const walker = new Body(humanoid(PERSON), { model: personModel, mass: 70, dev: true });
  const mare = new Body(horse(HORSE), { model: horseModel, at: new Vector3(-2, 0, -1), dev: true });
  scene.add(walker.object, mare.object);
  expect(personReport.bones.length).toBeGreaterThan(0);
  expect(personModel.getObjectsByProperty('isSkinnedMesh', true).length).toBeGreaterThan(0);
  const foot = named(personModel, 'leftFoot');
  const before = foot.getWorldPosition(new Vector3());
  let done = false;
  const update = runTimeline(function* () {
    yield* parallel('race', walkTo(walker, new Vector3(0, 0, 4)), walkTo(mare, walker.bones.head, { until: Infinity }), lookAt(mare, walker.bones.head, { until: Infinity }));
    done = true;
  });
  for (let frame = 0; frame < 15 * 60 && !done; frame++) {
    update(undefined, dt);
    walker.update(dt);
    mare.update(dt);
  }
  expect(done).toBe(true);
  // (the rig's own bones moved with the body, the mesh bound to them, the body's object on the floor where it stands)
  scene.updateMatrixWorld(true);
  expect(foot.getWorldPosition(new Vector3()).distanceTo(before)).toBeGreaterThan(3);
  expect(walker.object.position.distanceTo(new Vector3(0, 0, 4))).toBeLessThan(0.3);
  expect(walker.object.position.y).toBe(0);
  expect(walker.bones.leftFoot).toBe(foot);
  expect(mare.position.distanceTo(new Vector3(-2, 0, -1))).toBeGreaterThan(2);
  expect(personModel.children.some((child) => child instanceof SkinnedMesh)).toBe(true);
  expect([...walker.log, ...mare.log]).toEqual([]);
}, 60000);
