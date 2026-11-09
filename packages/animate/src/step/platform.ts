// A gait on moving platforms: its state carried with the root's, and each foot kept on its own.
import { Matrix3, Matrix4, Quaternion, Vector3, type Object3D } from 'three';
import { yawOf } from '../kernel/math';
import type { Steps } from './state';

/** A supported gait is relative to its platform, including swing paths and the pelvis' history. */
export function transport(steps: Steps, matrix: Matrix4) {
  const rotation = new Quaternion().setFromRotationMatrix(new Matrix4().extractRotation(matrix));
  const direction = new Matrix3().setFromMatrix4(matrix), yaw = yawOf(rotation);
  const height = steps.pelvis.clone().applyMatrix4(matrix).y - steps.pelvis.y;
  steps.pelvis.applyMatrix4(matrix);
  steps.velocity.applyMatrix3(direction);
  steps.hips.applyMatrix3(direction);
  steps.shifted.applyMatrix3(direction);
  steps.yaw += yaw;
  steps.rootYaw += yaw;
  steps.yaws[0] += yaw;
  steps.yaws[1] += yaw;
  steps.heights[0] += height;
  steps.heights[1] += height;
  steps.held += height;
  steps.low += height;
  steps.ground.transport(matrix);
  for (const leg of steps.legs) {
    const swing = leg.swing;
    if (swing) {
      swing.level = new Vector3(swing.x.x, swing.level, swing.x.z).applyMatrix4(matrix).y;
      swing.x.applyMatrix4(matrix);
      swing.v.applyMatrix3(direction);
      swing.a.applyMatrix3(direction);
      swing.turn.x += yaw;
    }
  }
}

/** Feet follow their own platforms even before the capsule joins one, or after it leaves. */
export function followFeet(steps: Steps) {
  for (const leg of steps.legs) {
    const on = leg.on;
    if (!on) continue;
    const height = leg.anchor.y;
    const platform = on.platform;
    platform?.updateWorldMatrix(true, false);
    leg.anchor.copy(on.anchor);
    if (platform) leg.anchor.applyMatrix4(platform.matrixWorld);
    leg.yaw = on.yaw + (platform ? yawOf(platform.getWorldQuaternion(_rotation)) : 0);
    if (leg.swing) leg.swing.onto += leg.anchor.y - height;
  }
}

/** Remember finalized landings after retargeting and settling. A planted foot keeps the surface it landed on. `platform`: the root's,
 * while physics has it stand on it — each foot's own where the floor tells (`Floor.platform`). */
export function bindFeet(steps: Steps, platform: Object3D | undefined) {
  for (const leg of steps.legs) {
    let on = leg.on;
    if (!on || leg.swing || leg.landed) {
      let x = leg.anchor.x, z = leg.anchor.z, height = steps.floor(x, z);
      for (const [atX, atZ] of steps.feet.print(leg.i, leg.anchor, leg.yaw)) {
        const level = steps.floor(atX, atZ);
        if (level > height) [x, z, height] = [atX, atZ, level];
      }
      const found = steps.floor.platform ? steps.floor.platform(x, z) : platform;
      if (!on || on.platform !== found) {
        if (leg.swing) leg.swing.onto += height + steps.feet.ankleHeight - leg.anchor.y;
        leg.anchor.y = height + steps.feet.ankleHeight;
        on = leg.on = { platform: found, anchor: new Vector3(), yaw: 0 };
      }
    }
    const under = on.platform;
    under?.updateWorldMatrix(true, false);
    on.anchor.copy(leg.anchor);
    if (under) on.anchor.applyMatrix4(_inverse.copy(under.matrixWorld).invert());
    on.yaw = leg.yaw - (under ? yawOf(under.getWorldQuaternion(_rotation)) : 0);
  }
}

const _inverse = new Matrix4(), _rotation = new Quaternion();
