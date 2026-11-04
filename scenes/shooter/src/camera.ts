import { PerspectiveCamera, Vector3 } from 'three';
import { lookDirection } from './angles';
import type { Look } from './playback';

/** Vertical fields of view, in degrees, from the hip and down the sights. */
export const HIP_FOV = 70;
export const ADS_FOV = 0.8 * HIP_FOV;

/** The player sees from the solved head or rifle sights at the same instant as the body. */
export class CameraRig {
  readonly camera = new PerspectiveCamera(HIP_FOV, 1, 0.02, 180);
  readonly direction = new Vector3(0, 0, 1);

  /** `aim` is how far the rifle has come up to the eye, from 0 to 1, and zooms the view from the hip's to the sights'. */
  update({ eye, yaw, pitch }: Omit<Look, 'intent'>, aim = 0) {
    lookDirection(yaw, pitch, this.direction);
    this.camera.position.copy(eye);
    this.camera.lookAt(eye.clone().add(this.direction));
    const fov = HIP_FOV + (ADS_FOV - HIP_FOV) * aim;
    if (fov === this.camera.fov) return;
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }

  resize(width: number, height: number) {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }
}
