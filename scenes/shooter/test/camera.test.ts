import { expect, it } from 'vitest';
import { Vector3 } from 'three';
import { lookDirection } from '../src/angles';
import { ADS_FOV, CameraRig, HIP_FOV } from '../src/camera';

it('starts at the solved eye and follows its current pose immediately after a respawn', () => {
  const rig = new CameraRig(), state = { eye: new Vector3(0, 1.6, 0), yaw: 0, pitch: 0 };
  rig.update(state);
  expect(rig.camera.position.distanceTo(state.eye)).toBeLessThan(1e-6);
  state.eye.set(8, 3, -12);
  state.yaw = 7.5;
  state.pitch = -0.6;
  rig.update(state);
  expect(rig.camera.position.distanceTo(state.eye)).toBeLessThan(1e-6);
  expect(rig.camera.getWorldDirection(new Vector3()).distanceTo(lookDirection(state.yaw, state.pitch))).toBeLessThan(1e-6);
  expect(rig.camera.fov).toBe(HIP_FOV);
});

it('zooms by how far the rifle has come up to the eye', () => {
  const rig = new CameraRig(), state = { eye: new Vector3(0, 1.6, 0), yaw: 0, pitch: 0 };
  const hip = rig.camera.projectionMatrix.elements[5];
  rig.update(state, 0.5);
  expect(rig.camera.fov).toBeCloseTo((HIP_FOV + ADS_FOV) / 2, 9);
  rig.update(state, 1);
  expect(rig.camera.fov).toBe(ADS_FOV);
  expect(rig.camera.projectionMatrix.elements[5]).toBeGreaterThan(hip);
});
