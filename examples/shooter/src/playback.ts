import { Quaternion, Vector3, type Object3D } from 'three';

export interface Look {
  eye: Vector3;
  /** The view shown, including recoil and the rifle's sights. */
  yaw: number;
  pitch: number;
  /** The view the player asked for. */
  intent: { yaw: number; pitch: number };
}

class Pose {
  parent: Object3D | null = null;
  readonly position = new Vector3();
  readonly rotation = new Quaternion();

  constructor(public node: Object3D) {}

  take(node: Object3D) {
    this.node = node;
    this.parent = node.parent;
    this.position.copy(node.position);
    this.rotation.copy(node.quaternion);
  }

  /** Puts the node back as taken; false, leaving it be, once it has moved to another parent (a rifle a ragdoll dropped), which this pose no longer describes. */
  show(): boolean {
    if (this.node.parent !== this.parent) return false;
    this.node.position.copy(this.position);
    this.node.quaternion.copy(this.rotation);
    return true;
  }
}

class Snapshot {
  readonly poses: Pose[] = [];
  readonly index = new Map<Object3D, Pose>();

  take(groups: readonly Object3D[]) {
    this.index.clear();
    let count = 0;
    for (const group of groups) group.traverse((node) => {
      const pose = this.poses[count] ?? new Pose(node);
      pose.take(node);
      this.poses[count++] = pose;
      this.index.set(node, pose);
    });
    this.poses.length = count;
  }

  show() { for (const pose of this.poses) pose.show(); }
}

/** Display the avatar, moving scenery and camera eye at the same instant between simulation steps. */
export class Playback {
  private previous = new Snapshot();
  private current = new Snapshot();
  private readonly previousLook: Look = { eye: new Vector3(), yaw: 0, pitch: 0, intent: { yaw: 0, pitch: 0 } };
  private readonly currentLook: Look = { eye: new Vector3(), yaw: 0, pitch: 0, intent: { yaw: 0, pitch: 0 } };

  /** Rendered time the simulation has not stepped yet. */
  private remainder = 0;

  constructor(private readonly groups: readonly Object3D[], private readonly look: () => Look, private readonly fixedDelta: number) { this.reset(); }

  /** How far to blend from the previous step's poses to the current: the unstepped time as a share of a step. */
  get alpha() { return this.remainder / this.fixedDelta; }

  /** Counts a rendered frame of `dt` seconds in which the simulation stepped `stepped` seconds. */
  advance(dt: number, stepped: number) {
    this.remainder = Math.max(0, Math.min(this.fixedDelta, this.remainder + dt - stepped));
  }

  reset() {
    this.remainder = 0;
    this.record();
    this.previous.take(this.groups);
    copyLook(this.previousLook, this.currentLook);
  }

  step(update: () => void) {
    // Physics has already written the new body poses. Restoring here would erase that completed step.
    [this.previous, this.current] = [this.current, this.previous];
    copyLook(this.previousLook, this.currentLook);
    update();
    this.record();
  }

  blend(alpha: number): Look {
    for (const current of this.current.poses) {
      if (!current.show()) continue;
      const previous = this.previous.index.get(current.node);
      // A magazine transferred between hand and pouch has a new local frame; use its current pose.
      if (!previous || previous.parent !== current.parent) continue;
      const node = current.node;
      node.position.lerpVectors(previous.position, current.position, alpha);
      node.quaternion.slerpQuaternions(previous.rotation, current.rotation, alpha);
    }
    for (const group of this.groups) group.updateWorldMatrix(true, true);
    const from = this.previousLook, to = this.currentLook;
    const mix = (a: number, b: number) => a + (b - a) * alpha;
    return {
      eye: from.eye.clone().lerp(to.eye, alpha), yaw: mix(from.yaw, to.yaw), pitch: mix(from.pitch, to.pitch),
      intent: { yaw: mix(from.intent.yaw, to.intent.yaw), pitch: mix(from.intent.pitch, to.intent.pitch) },
    };
  }

  restore() {
    this.current.show();
    for (const group of this.groups) group.updateWorldMatrix(true, true);
  }

  private record() {
    for (const group of this.groups) group.updateWorldMatrix(true, true);
    this.current.take(this.groups);
    copyLook(this.currentLook, this.look());
  }
}

function copyLook(target: Look, source: Look) {
  target.eye.copy(source.eye);
  target.yaw = source.yaw;
  target.pitch = source.pitch;
  target.intent.yaw = source.intent.yaw;
  target.intent.pitch = source.intent.pitch;
}
