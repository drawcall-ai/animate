import { Matrix4, Quaternion, Vector3, Object3D } from 'three';
import { BonePose } from '../kernel/bone-pose';
import { Skeleton, type SkinVolume } from '../kernel/skeleton';
import type { AnySpecies, Temperament } from '../species/define';
import type { Floor } from '../step/floor';
import type { Binding } from './binding';
import type { Root } from '../step/root';

// What a body is made from: its skeleton massed as asked, the pose it starts in, and the check of the model it poses.

/** says a fallback taken, once (`Self.warn`) */
type Warn = (check: string, message: string) => void;

/** the species' skeleton, its masses for a body of `mass` kg (a skin report's closed volume at 1000 kg/m³, kept within a sane range) */
export function massed(species: AnySpecies, mass: number | SkinVolume | undefined, warn: Warn): Skeleton {
  if (mass === undefined) return species.skeleton;
  const total = typeof mass === 'number' ? mass : volumeMass(species, mass, warn);
  if (!(total > 0 && Number.isFinite(total))) throw new Error(`a body of ${total} kg`);
  if (total === species.mass) return species.skeleton;
  const { skeleton } = species, share = total / species.mass;
  const chains = Object.fromEntries(skeleton.chainNames().map((name) => [name, skeleton.chain(name).map((bone) => skeleton.bones[bone].name)]));
  return new Skeleton(skeleton.bones.map((bone) => ({ ...bone, mass: bone.mass * share })), { limits: skeleton.limits.filter((limit) => limit !== undefined), chains });
}

/** a body's mass from a mesh's volume as `SelfOptions.mass` takes it */
function volumeMass(species: AnySpecies, report: SkinVolume, warn: Warn): number {
  if (!report.closed || report.volume === null) {
    warn('mass', `the mesh is open, so it has no volume: its species' ${species.mass} kg taken`);
    return species.mass;
  }
  const mass = report.volume * 1000, held = Math.min(2 * species.mass, Math.max(species.mass / 2, mass));
  if (held !== mass) warn('mass', `its mesh's ${mass.toFixed(1)} kg is past half or twice its species' ${species.mass} kg: ${held.toFixed(1)} kg taken`);
  return held;
}

/** the skeleton's rest pose standing on `floor` at `at` (its x and z) facing `face` */
export function restPose(skeleton: Skeleton, floor: Floor, at?: Vector3, face = 0): BonePose {
  const pose = new BonePose(skeleton), root = pose.position(0), x = at?.x ?? root.x, z = at?.z ?? root.z;
  pose.setRoot(new Vector3(x, root.y + floor(x, z), z));
  pose.setLocal(0, new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), face).multiply(pose.local(0)));
  pose.facing = face;
  pose.forward();
  return pose;
}

/** a model's bones neither sheared nor scaled unevenly at rest, relative to the body (rig's own contract) */
export function checkShear(binding: Binding): void {
  binding.object.updateMatrixWorld(true);
  const inverse = new Matrix4().copy(binding.object.matrixWorld).invert();
  // (a pose turns and moves bones, so each must rest as a turn, a move and one scale: its matrix what those recompose to, as rig checks it)
  const close = (a: number, b: number) => Math.abs(a - b) <= 1e-8 * Math.max(1, Math.abs(a), Math.abs(b));
  for (const [name, node] of Object.entries(binding.bones)) {
    const rest = new Matrix4().multiplyMatrices(inverse, node.matrixWorld), position = new Vector3(), turn = new Quaternion(), scale = new Vector3();
    rest.decompose(position, turn, scale);
    const recomposed = new Matrix4().compose(position, turn, scale).elements;
    const even = close(Math.abs(scale.x), Math.abs(scale.y)) && close(Math.abs(scale.y), Math.abs(scale.z));
    if (!even || !rest.elements.every((x, k) => close(x, recomposed[k]))) throw new Error(`bone "${name}" is sheared or scaled unevenly at rest: rig the model so each bone rests as a turn, a move and one scale`);
  }
}

/** How a body is made. */
export interface SelfOptions {
  /** where it stands (default the origin): x and z — it stands on its floor there; a y off that floor is ignored, with a warning */
  at?: Vector3;
  /**
   * the floor's height under a world point (x, z) (m; default 0 everywhere): what it stands and steps on — a raised stage, a dais, a
   * step, a flight of stairs — its feet each landing whole on one level, the body rising and falling over its legs as it goes. Level
   * areas with edges between them: a person climbs treads deeper than about 1.3 of its foot (`species.person.heelBack + toeFront`; 0.35 m
   * of tread for the default body) and steps
   * up a curb; a creature stands on raised floors and steps up single steps. Slopes, and stairs with shallower treads, are not handled for
   * walks; with physics support the controller carries the root over them, given matching world-space heights. A height-only floor does
   * not supply surface normals.
   * A person's step length against a tread decides whether it puts one foot or both on each; between the two it mixes them from tread to
   * tread, which reads as hesitation. Give every body on a set the same function, or they disagree on where its floor is.
   */
  floor?: Floor;
  /** the way it faces (rad about +Y; 0 faces +Z) */
  face?: number;
  /** its root driven by the app (a player's, or a scripted path a walk cannot take), read every sub-step with the body's time (s): its legs
   * keep up, and nothing borrows them; give `at` and `face` as the drive starts, or the first sub-step jumps there */
  drive?: (time: number) => Root;
  /** its quiet life: a seed that fixes its variation (unseeded, it varies with where the body is made), what tethers it and what startles it */
  life?: Temperament;
  /** how quick it is, all told (1: as tuned; 1.2: a fifth quicker): its walks', reaches' and carries' paces — a walk given a `speed` keeps
   * that speed, tempo or not; how it steps at a pace is its species' (a person's `stride`) */
  tempo?: number;
  /**
   * what it weighs (kg), or a closed mesh's volume as @drawcall/rig's skin report gives it (at 1000 kg/m³, within half and twice its
   * species' mass: it warns when it is held so, or the mesh is open and the species' mass is taken); default its species'
   */
  mass?: number | SkinVolume;
  /** the container its mesh was rigged in with @drawcall/rig (`skin(model, skeleton)`): the body poses its bones; without it, the body is bare */
  model?: Object3D;
  /** checks its motion each sub-step and records what went wrong in `Body.log`; off in a build, it costs nothing */
  dev?: boolean;
}
