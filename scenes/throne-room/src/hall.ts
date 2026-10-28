import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Object3D, Vector3 } from 'three';

// The Grand Audience Chamber of the Massassi temple on Yavin 4 (A New Hope, final scene), laid out in metres.
// The doors are at the origin and the hall runs along +Z to the dais; +Y is up and +X is the left of someone walking in.

export const HALL = {
  /** the floor's extent: x from -width/2 to width/2, z from 0 (the doors) to length */
  width: 34,
  length: 46,
  /** the central aisle the heroes walk up, x from -aisle/2 to aisle/2 */
  aisle: 4.4,
  /** the steps up to the dais: the first riser at z = start, each `rise` high and `tread` deep; the dais top is flat beyond them */
  steps: { start: 33, count: 5, rise: 0.2, tread: 0.45 },
  /** the troop blocks either side of the aisle: their inner edge, outer edge and front-to-back extent (z) */
  troops: { inner: 3.2, outer: 15, front: 30, back: 5 },
} as const;

/** the height of the dais top (m) and where its flat top begins (z) */
export const DAIS = {
  height: HALL.steps.count * HALL.steps.rise,
  top: HALL.steps.start + HALL.steps.count * HALL.steps.tread,
};

/** the floor height at `z` along the aisle (the steps' tops; 0 on the hall floor) */
export function floorAt(z: number): number {
  const { start, count, rise, tread } = HALL.steps;
  if (z < start) return 0;
  return Math.min(count, Math.floor((z - start) / tread) + 1) * rise;
}

/**
 * Named placement empties in the hall: each at a floor point, its +Z turned the way a body faces there.
 * The heroes enter at the doors and end before Leia; Leia and her party stand on the dais facing the doors.
 */
export function createMarks(): Record<MarkName, Object3D> {
  const marks = {} as Record<MarkName, Object3D>;
  for (const [name, [x, y, z], face] of MARKS) {
    const mark = new Object3D();
    mark.name = name;
    mark.position.set(x, y, z);
    mark.rotation.y = face;
    marks[name] = mark;
  }
  return marks;
}

type MarkName = (typeof MARKS)[number][0];
const TOWARD_DAIS = 0, TOWARD_DOORS = Math.PI;
/** where the heroes stand to be decorated: on the step below the dais top, a tread before Leia's floor */
const DECORATED = DAIS.top - HALL.steps.tread - 0.2;
const MARKS = [
  // the heroes at the doors (Han on Luke's left, Chewbacca on his right), and where they stand to be decorated
  ['lukeEnter', [0, 0, 1.5], TOWARD_DAIS],
  ['hanEnter', [1.1, 0, 1.2], TOWARD_DAIS],
  ['chewbaccaEnter', [-1.2, 0, 1.2], TOWARD_DAIS],
  ['lukeDecorated', [0, floorAt(DECORATED), DECORATED], TOWARD_DAIS],
  ['hanDecorated', [1.1, floorAt(DECORATED), DECORATED], TOWARD_DAIS],
  ['chewbaccaDecorated', [-1.25, floorAt(DECORATED), DECORATED], TOWARD_DAIS],
  // the dais party: Leia at the centre, the officer holding the medals beside her, the droids to her left
  ['leia', [0, DAIS.height, DAIS.top + 1.0], TOWARD_DOORS],
  ['medalBearer', [1.1, DAIS.height, DAIS.top + 1.4], TOWARD_DOORS],
  ['dodonna', [-1.3, DAIS.height, DAIS.top + 1.5], TOWARD_DOORS],
  ['threepio', [-2.6, DAIS.height, DAIS.top + 0.9], TOWARD_DOORS],
  ['artoo', [-3.4, DAIS.height, DAIS.top + 0.7], TOWARD_DOORS],
] as const satisfies readonly (readonly [string, readonly [number, number, number], number])[];

/** A stand-in hall (floor, steps, dais, pillars) until the environment model exists; the floor tops match `floorAt`. */
export function createPlaceholderHall(): Group {
  const hall = new Group();
  hall.name = 'hall';
  const stone = new MeshStandardMaterial({ color: 0x8a7f6f, roughness: 0.9 });
  const add = (size: Vector3, centre: Vector3) => {
    const block = new Mesh(new BoxGeometry(size.x, size.y, size.z), stone);
    block.position.copy(centre);
    block.receiveShadow = block.castShadow = true;
    hall.add(block);
  };
  add(new Vector3(HALL.width, 0.1, HALL.length), new Vector3(0, -0.05, HALL.length / 2));
  const { start, count, rise, tread } = HALL.steps;
  for (let step = 1; step <= count; step++) {
    const front = start + (step - 1) * tread, back = HALL.length;
    add(new Vector3(12, rise, back - front), new Vector3(0, (step - 0.5) * rise, (front + back) / 2));
  }
  for (const side of [-1, 1]) for (let z = 4; z < HALL.length; z += 6) add(new Vector3(1.2, 14, 1.2), new Vector3(side * (HALL.width / 2 - 1), 7, z));
  return hall;
}

/** the hall's placement empties, by name */
export type Marks = ReturnType<typeof createMarks>;
