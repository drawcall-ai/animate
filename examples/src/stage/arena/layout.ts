import { Vector3 } from 'three';

/** the arena floor, below the ring canvas (y = 0, where the fighters stand) */
export const FLOOR = -1.1;
/** half the space inside the ropes: 6.1 m (20 ft) */
export const HALF = 3.05;
export const APRON = 0.6;
/** the posts' offset from the centre along x and z */
export const POST = HALF + 0.14;
/** red corner, neutral, blue corner, neutral; consecutive corners span one side */
export const CORNERS: [number, number][] = [
  [-POST, -POST],
  [POST, -POST],
  [POST, POST],
  [-POST, POST],
];

/** The ring's four sides as their outward normal (x, z), and the yaw that lays a box's length along the side. */
export const SIDES = [
  { x: 0, z: -1, yaw: 0 },
  { x: 0, z: 1, yaw: 0 },
  { x: -1, z: 0, yaw: Math.PI / 2 },
  { x: 1, z: 0, yaw: Math.PI / 2 },
];
export type RingSide = (typeof SIDES)[number];

/** the point `out` from the centre on `side`'s normal, moved `along` the side */
export function onSide(side: RingSide, out: number, along: number, y: number): Vector3 {
  return side.x === 0 ? new Vector3(along, y, side.z * out) : new Vector3(side.x * out, y, along);
}

/** The yaws of spectators facing the ring from the four stands; each stand lies along −forwardOf(yaw). */
export const FACINGS = [0, 1, 2, 3].map((k) => (k * Math.PI) / 2);
