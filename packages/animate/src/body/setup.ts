import { Matrix4, Quaternion, Vector3 } from 'three';
import type { SkinReport } from '@drawcall/rig';
import { Pose } from '../kernel/pose';
import type { Dev } from '../kernel/dev';
import { Skeleton } from '../kernel/skeleton';
import type { AnySpecies } from '../species/define';
import type { Floor } from '../legs/floor';
import type { Binding } from './model';

// What a body is made from: its skeleton massed as asked, the pose it starts in, and development's check of the model it poses.

/** the species' skeleton, its masses for a body of `mass` kg (a skin report's closed volume at 1000 kg/m³, kept within a sane range) */
export function massed(species: AnySpecies, mass: number | Pick<SkinReport, 'closed' | 'volume'> | undefined, dev?: Dev): Skeleton {
  if (mass === undefined) return species.skeleton;
  const total = typeof mass === 'number' ? mass : volumeMass(species, mass, dev);
  if (!(total > 0 && Number.isFinite(total))) throw new Error(`a body of ${total} kg`);
  if (total === species.mass) return species.skeleton;
  const { skeleton } = species, share = total / species.mass;
  const chains = Object.fromEntries(skeleton.chainNames().map((name) => [name, skeleton.chain(name).map((bone) => skeleton.bones[bone].name)]));
  return new Skeleton(skeleton.bones.map((bone) => ({ ...bone, mass: bone.mass * share })), { limits: skeleton.limits.filter((limit) => limit !== undefined), chains });
}

/** a body's mass from a mesh's volume as `SelfOptions.mass` takes it */
function volumeMass(species: AnySpecies, report: Pick<SkinReport, 'closed' | 'volume'>, dev?: Dev): number {
  if (!report.closed || report.volume === null) {
    dev?.append(0, { check: "an open mesh's volume (its species' mass taken, kg)", value: species.mass, limit: 0, where: 'mass' });
    return species.mass;
  }
  const mass = report.volume * 1000, held = Math.min(2 * species.mass, Math.max(species.mass / 2, mass));
  if (held !== mass) dev?.append(0, { check: "a mesh's mass past half or twice its species' (kg)", value: mass, limit: held, where: 'mass' });
  return held;
}

/** the skeleton's rest pose standing on `floor` at `at` (its x and z) facing `face` */
export function restPose(skeleton: Skeleton, floor: Floor, at?: Vector3, face = 0): Pose {
  const pose = new Pose(skeleton), root = pose.position(0), x = at?.x ?? root.x, z = at?.z ?? root.z;
  pose.setRoot(new Vector3(x, root.y + floor(x, z), z));
  pose.setLocal(0, new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), face).multiply(pose.local(0)));
  pose.facing = face;
  pose.forward();
  return pose;
}

/** development: a model's bones neither sheared nor scaled unevenly at rest, relative to the body (rig's own contract) */
export function checkShear(binding: Binding, dev: Dev): void {
  binding.object.updateMatrixWorld(true);
  const inverse = new Matrix4().copy(binding.object.matrixWorld).invert();
  // (a pose turns and moves bones, so each must rest as a turn, a move and one scale: its matrix what those recompose to, as rig checks it)
  const close = (a: number, b: number) => Math.abs(a - b) <= 1e-8 * Math.max(1, Math.abs(a), Math.abs(b));
  for (const [name, node] of Object.entries(binding.bones)) {
    const rest = new Matrix4().multiplyMatrices(inverse, node.matrixWorld), position = new Vector3(), turn = new Quaternion(), scale = new Vector3();
    rest.decompose(position, turn, scale);
    const recomposed = new Matrix4().compose(position, turn, scale).elements;
    const even = close(Math.abs(scale.x), Math.abs(scale.y)) && close(Math.abs(scale.y), Math.abs(scale.z));
    if (!even || !rest.elements.every((x, k) => close(x, recomposed[k]))) dev.append(0, { check: 'a bone sheared or scaled unevenly at rest', value: 1, limit: 0, where: name });
  }
}
