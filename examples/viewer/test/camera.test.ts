import { Box3, PerspectiveCamera, Vector3 } from 'three';
import { expect, it } from 'vitest';
import { Framing, placeCamera } from '../src/stage/camera';

it('fits both bodies through the leading lane in both fixed shots', () => {
  const camera = new PerspectiveCamera(45, 16 / 9, 0.01, 100);
  const framing = new Framing();
  for (const z of [0, 5, 20]) {
    const bounds = new Box3(new Vector3(-0.3, 0, z - 3.5), new Vector3(1.6, 2, z + 0.5));
    framing.set(bounds.getCenter(new Vector3()), 0);
    for (const [shot, bearing] of [['front', 0], ['side', -11 * Math.PI / 18]] as const) {
      placeCamera(camera, shot, framing, 4.8, bounds, bearing);
      camera.updateMatrixWorld();
      for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
        const projected = new Vector3(x, y, z).project(camera);
        expect(Math.abs(projected.x)).toBeLessThanOrEqual(1 + 1e-12);
        expect(Math.abs(projected.y)).toBeLessThanOrEqual(1 + 1e-12);
        expect(projected.z).toBeLessThan(1);
      }
    }
  }
});
