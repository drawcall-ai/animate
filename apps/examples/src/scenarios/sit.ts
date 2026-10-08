import type { Prop, Scenario } from '../scenario';
import { quatYXZ, vec } from '../math';

/** a chair at the origin, seated facing +Z */
const CHAIR = { x: 0, z: 0, seat: 0.46, width: 0.46, depth: 0.44 };

const legs: Prop[] = [-1, 1].flatMap((sx) =>
  [-1, 1].map((sz) => ({
    kind: 'box',
    position: vec(CHAIR.x + sx * (CHAIR.width / 2 - 0.03), (CHAIR.seat - 0.04) / 2, CHAIR.z + sz * (CHAIR.depth / 2 - 0.03)),
    size: vec(0.03, CHAIR.seat - 0.04, 0.03),
  })),
);
const chair: Prop[] = [
  { kind: 'box', position: vec(CHAIR.x, CHAIR.seat - 0.02, CHAIR.z), size: vec(CHAIR.width, 0.04, CHAIR.depth) },
  { kind: 'box', position: vec(CHAIR.x, CHAIR.seat + 0.24, CHAIR.z - CHAIR.depth / 2 + 0.02), size: vec(CHAIR.width, 0.44, 0.03) },
  ...legs,
];

export const sit: Scenario = {
  id: 'sit',
  title: 'Sit down, stand up',
  drives: 'a seat point (+ a walk-to spot afterwards)',
  description:
    'Only a seat is given. The body walks up to the chair, turns its back to it and sits: hips back and down, trunk leaning over the feet until the chair takes the weight, then settling upright with the hands on the thighs. When the seat is taken away it leans forward and pushes up before walking off.',
  duration: 16,
  actors: [{ position: { x: 0.5, y: 0, z: 3.2 }, yaw: Math.PI }],
  create() {
    const seat = vec(CHAIR.x, CHAIR.seat, CHAIR.z + 0.03);
    const facing = quatYXZ(0);
    const away = vec(-1.6, 0, 2.6);
    return {
      inputs(t) {
        if (t < 0.6) return [{}];
        if (t < 10) {
          // seated: glance at something to the left for a while
          const lookAt = t > 6.5 && t < 8.5 ? vec(-2, 1.0, 1.5) : undefined;
          return [{ seat: { position: seat, quaternion: facing }, lookAt }];
        }
        return [{ goal: t > 11.4 ? { position: away } : undefined }];
      },
      props: () => chair,
    };
  },
};
