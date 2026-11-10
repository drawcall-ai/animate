import { BoxGeometry, Matrix4, Ray, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { Triangles } from '../../src/kernel/triangles';

describe('Triangles', () => {
  // a flat bar 12 mm thick, as a ladder's stile
  const bar = new Triangles([{ geometry: new BoxGeometry(0.012, 1, 0.065), matrix: new Matrix4() }], new Vector3(), 0.3);

  it('takes a ray starting in a closed mesh as inside, whichever way it points, and one starting outside as outside', () => {
    for (const direction of [new Vector3(1, 0, 0), new Vector3(0, 0.3, -1).normalize()]) {
      expect(bar.inside(new Ray(new Vector3(0.002, 0, 0.01), direction))).toBe(true);
      expect(bar.inside(new Ray(new Vector3(0.02, 0, 0.01), direction.clone().negate()))).toBe(false);
    }
    // (a segment sunk whole in it meets none of its faces along its length)
    expect(bar.first(new Ray(new Vector3(0, 0, -0.02), new Vector3(0, 0, 1)), 0.03)).toBeNull();
  });
});
