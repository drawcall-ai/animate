import { Object3D, Quaternion, Vector3 } from 'three';
import type { AnySpecies, Vec3 } from '../species/define';
import type { Binding } from '../body/model';

/** Spring motion for the bone hierarchy below one root. Lengths and rest directions come from the rig. */
export interface Spring {
  /** Restoring strength per unit mass (s⁻²; default 40). Higher values hold the input pose more firmly. */
  readonly stiffness?: number;
  /** Damping ratio (default 0.7): 0 oscillates, 1 is critically damped, above 1 settles more slowly. */
  readonly damping?: number;
  /** World acceleration (m/s²; default [0, -9.81, 0]). [0, 0, 0] disables gravity. */
  readonly gravity?: Vec3;
}

/** Body-owned spring state. Only rotations are written; the rig keeps every joint and segment length. */
export class Springs {
  private readonly links: Link[] = [];

  constructor(species: AnySpecies, binding: Binding) {
    const children = new Map<string, string[]>();
    for (const bone of species.bones) {
      if (bone.parent === undefined) continue;
      const names = children.get(bone.parent) ?? [];
      names.push(bone.name);
      children.set(bone.parent, names);
    }
    const owned = new Set<string>();
    binding.object.updateWorldMatrix(true, true);
    for (const [root, settings] of Object.entries(species.springs ?? {})) {
      if (!settings) continue;
      if (!binding.bones[root]) throw new Error(`springs: no bone "${root}"`);
      const stiffness = settings.stiffness ?? 40, damping = settings.damping ?? 0.7;
      for (const [name, value] of Object.entries({ stiffness, damping })) {
        if (!(value >= 0 && Number.isFinite(value))) throw new Error(`springs.${root}.${name}: give a finite nonnegative number`);
      }
      const gravity = new Vector3(...settings.gravity ?? [0, -9.81, 0]);
      if (!gravity.toArray().every(Number.isFinite)) throw new Error(`springs.${root}.gravity: give a finite acceleration`);
      const before = this.links.length, names = [root];
      for (let i = 0; i < names.length; i++) {
        const name = names[i];
        if (owned.has(name)) throw new Error(`springs: "${name}" belongs to overlapping spring roots or a cyclic hierarchy`);
        owned.add(name);
        const below = children.get(name) ?? [];
        names.push(...below);
        // A branch keeps its input pose; each child chain swings independently. Leaves are the endpoints.
        if (below.length !== 1) continue;
        this.links.push(new Link(binding.bones[name], binding.bones[below[0]], stiffness, damping, gravity));
      }
      if (this.links.length === before) throw new Error(`springs.${root}: the hierarchy has no bone with one child to swing toward`);
    }
  }

  /** Remove the preceding output before the animation writes the next input pose. */
  restore(): void { for (const link of this.links) link.node.quaternion.copy(link.rest); }

  /** Advance once, after the body's pose and world-oriented bones have been written. */
  step(dt: number): void { for (const link of this.links) link.step(dt); }

  /** Keep the last simulated pose, including render frames that contain no whole simulation step. */
  write(): void { for (const link of this.links) link.node.quaternion.copy(link.rotation); }
}

class Link {
  readonly rest: Quaternion;
  readonly rotation: Quaternion;
  private readonly offset: Vector3;
  private readonly tip: Vector3;
  private readonly anchor: Vector3;
  private readonly velocity = new Vector3();
  private readonly drag: number;

  constructor(readonly node: Object3D, child: Object3D, private readonly stiffness: number, damping: number, private readonly gravity: Vector3) {
    this.rest = node.quaternion.clone();
    this.rotation = node.quaternion.clone();
    this.tip = child.getWorldPosition(new Vector3());
    this.anchor = node.getWorldPosition(new Vector3());
    this.offset = node.worldToLocal(this.tip.clone());
    if (this.offset.lengthSq() < 1e-12) throw new Error(`springs: "${node.name}" and "${child.name}" have no length between them`);
    this.drag = 2 * damping * Math.sqrt(stiffness);
  }

  step(dt: number): void {
    const node = this.node;
    node.updateWorldMatrix(true, false);
    const origin = _origin.setFromMatrixPosition(node.matrixWorld);
    const target = _target.copy(this.offset).applyMatrix4(node.matrixWorld);
    const axis = _axis.subVectors(target, origin), length = axis.length();
    if (!(length > 0)) throw new Error(`springs: "${node.name}" has zero world length`);
    axis.divideScalar(length);
    // Implicit spring integration stays bounded even for a very stiff spring. The length constraint then removes stretch.
    // Damping is relative to the moving joint: a steady walk does not create artificial wind drag.
    this.velocity.addScaledVector(_force.subVectors(origin, this.anchor), this.drag)
      .addScaledVector(_force.subVectors(target, this.tip), this.stiffness * dt).addScaledVector(this.gravity, dt)
      .divideScalar(1 + this.drag * dt + this.stiffness * dt * dt);
    this.anchor.copy(origin);
    const next = _next.copy(this.tip).addScaledVector(this.velocity, dt);
    const direction = _direction.subVectors(next, origin);
    if (direction.lengthSq() < 1e-12) direction.copy(axis);
    direction.normalize();
    next.copy(origin).addScaledVector(direction, length);
    this.velocity.subVectors(next, this.tip).divideScalar(dt);
    this.tip.copy(next);
    const world = node.getWorldQuaternion(_world);
    const turn = _turn.setFromUnitVectors(axis, direction).multiply(world);
    if (node.parent) turn.premultiply(node.parent.getWorldQuaternion(_parent).invert());
    node.quaternion.copy(turn);
    this.rotation.copy(turn);
  }
}

const _origin = new Vector3(), _target = new Vector3(), _axis = new Vector3(), _force = new Vector3(), _next = new Vector3(), _direction = new Vector3();
const _world = new Quaternion(), _turn = new Quaternion(), _parent = new Quaternion();
