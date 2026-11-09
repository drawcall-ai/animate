import { Matrix4, type Object3D } from 'three';
import type { Frame } from '../kernel/frame';
import { BonePose } from '../kernel/bone-pose';
import type { Skeleton } from '../kernel/skeleton';

/** Read locomotion history in the support's current frame. World histories stay intact for gaze, hand targets and other bodies. */
export class PlatformFrame {
  private object: Object3D | undefined;
  private readonly last = new Matrix4();
  private readonly before = new Matrix4();
  private readonly prev: BonePose;
  private readonly prev2: BonePose;
  readonly delta = new Matrix4();

  constructor(skeleton: Skeleton) {
    this.prev = new BonePose(skeleton);
    this.prev2 = new BonePose(skeleton);
  }

  read(frame: Frame, object: Object3D | undefined): Frame {
    object?.updateWorldMatrix(true, false);
    if (!object || object !== this.object) {
      this.object = object;
      if (object) {
        this.last.copy(object.matrixWorld);
        this.before.copy(object.matrixWorld);
      }
      this.delta.identity();
      return frame;
    }
    if (this.last.equals(object.matrixWorld) && this.before.equals(this.last)) return frame;
    this.delta.copy(this.last).invert().premultiply(object.matrixWorld);
    const earlier = this.before.clone().invert().premultiply(object.matrixWorld);
    this.prev.copy(frame.prev).transform(this.delta);
    this.prev2.copy(frame.prev2).transform(earlier);
    this.before.copy(this.last);
    this.last.copy(object.matrixWorld);
    return { ...frame, prev: this.prev, prev2: this.prev2 };
  }
}
