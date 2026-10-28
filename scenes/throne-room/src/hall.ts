import { AdditiveBlending, BoxGeometry, DoubleSide, Group, type Material, Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D, PlaneGeometry, RepeatWrapping, SRGBColorSpace, type Texture, TextureLoader, Vector3 } from 'three';

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

/** the walls and pillars that stand around the floor, the high windows along the side walls and the doors (m) */
const WALLS = {
  height: 30,
  thickness: 1,
  /** the open band in each side wall, between the pillars, that daylight comes in through */
  windows: { bottom: 22, top: 27 },
  /** the doorway at z = 0; its two leaves stand open into the hall, clear of the aisle and in front of the troop blocks */
  door: { width: 8, height: 14 },
  pillar: { size: 1.4, spacing: 6 },
};
/** the width of the steps and the dais (m); the troop blocks stand on the floor either side of them */
const DAIS_WIDTH = 16;
/** the world size (m) one copy of a stone texture covers */
const TILE = 4;

/** the direction toward the sun: daylight comes in through the high windows on the +x wall, slightly from the doors' end */
export const SUN = new Vector3(0.35, 1, -0.25).normalize();

/**
 * The chamber: a sandstone floor, steps up to the dais (their tops match `floorAt`), 30 m stone walls with a doorway at z = 0
 * and its doors standing open, pillars along the side walls with banners between them, high windows under a beamed ceiling,
 * and faint shafts of daylight from the windows. Only the floor, steps, pillars and doors cast shadows: the walls and the ceiling
 * would put the whole floor in shade, where the real hall is lit by its many openings.
 * Textures load in the background; the hall is usable at once.
 */
export function createHall(): Group {
  const hall = new Group();
  hall.name = 'hall';
  const floor = stoneMaterial('/models/hall-floor');
  floor.color.set(0xd6cdbf); // a little darker than the texture, which washes out under the sun
  const stone = stoneMaterial('/models/hall-stone');
  const add = (material: Material, size: Vector3, centre: Vector3, castShadow = true) => {
    const block = new Mesh(boxWithTiledUvs(size), material);
    block.position.copy(centre);
    block.receiveShadow = true;
    block.castShadow = castShadow;
    hall.add(block);
    return block;
  };
  const { width, length } = HALL;
  const { height, thickness, windows, door, pillar } = WALLS;
  add(floor, new Vector3(width, 0.1, length), new Vector3(0, -0.05, length / 2));
  // each step is a slab from its riser to the back wall, so the top one is the dais
  const { start, count, rise, tread } = HALL.steps;
  for (let step = 1; step <= count; step++) {
    const front = start + (step - 1) * tread;
    add(floor, new Vector3(DAIS_WIDTH, rise, length - front), new Vector3(0, (step - 0.5) * rise, (front + length) / 2));
  }
  // the side walls below and above their window band, the back wall, and the front wall beside and above the doorway
  for (const side of [-1, 1]) {
    const x = side * (width + thickness) / 2;
    add(stone, new Vector3(thickness, windows.bottom, length), new Vector3(x, windows.bottom / 2, length / 2), false);
    add(stone, new Vector3(thickness, height - windows.top, length), new Vector3(x, (height + windows.top) / 2, length / 2), false);
  }
  add(stone, new Vector3(width, height, thickness), new Vector3(0, height / 2, length + thickness / 2), false);
  const beside = (width - door.width) / 2;
  for (const side of [-1, 1]) add(stone, new Vector3(beside, height, thickness), new Vector3(side * (door.width + beside) / 2, height / 2, -thickness / 2), false);
  add(stone, new Vector3(door.width, height - door.height, thickness), new Vector3(0, (height + door.height) / 2, -thickness / 2), false);
  // the ceiling, with a beam across the hall at each pair of pillars
  add(stone, new Vector3(width + 2 * thickness, thickness, length + 2 * thickness), new Vector3(0, height + thickness / 2, length / 2), false);
  for (let z = pillar.spacing / 2; z < length; z += pillar.spacing) add(stone, new Vector3(width, 1.2, 1), new Vector3(0, height - 0.6, z), false);
  // the two door leaves, hinged at the doorway's edges and swung 95 degrees into the hall (their free edges lean away from the aisle)
  const doorStone = stone.clone();
  doorStone.color.set(0x9a8a74);
  for (const side of [-1, 1]) {
    const leaf = add(doorStone, new Vector3(door.width / 2, door.height, 0.3), new Vector3(side * door.width / 4, door.height / 2, 0.15));
    const hinge = new Group();
    hinge.position.set(side * door.width / 2, 0, 0);
    hinge.rotation.y = side * (95 * Math.PI) / 180;
    leaf.position.x -= hinge.position.x;
    hinge.add(leaf);
    hall.add(hinge);
  }
  // daylight beyond the doorway and the windows: unlit, unfogged bright planes
  const daylight = new MeshBasicMaterial({ color: 0xfff1d8, fog: false });
  const outside = new Mesh(new PlaneGeometry(door.width * 3, door.height * 2), daylight);
  outside.position.set(0, door.height / 2, -12);
  hall.add(outside);
  for (const side of [-1, 1]) {
    const sky = new Mesh(new PlaneGeometry(length, windows.top - windows.bottom + 2), daylight);
    sky.position.set(side * (width / 2 + thickness + 1), (windows.bottom + windows.top) / 2, length / 2);
    sky.rotation.y = -side * Math.PI / 2;
    hall.add(sky);
  }
  // pillars against the side walls, with a banner on the wall between each pair
  const banner = new MeshStandardMaterial({ map: colorTexture('/models/hall-banner.jpg'), roughness: 0.95, side: DoubleSide });
  const bannerSize = { width: 3, height: 9 }; // the banner image is 1:3
  const shaft = new MeshBasicMaterial({ color: 0xffdca8, transparent: true, opacity: 0.045, blending: AdditiveBlending, depthWrite: false, side: DoubleSide });
  const shaftLength = (windows.bottom + windows.top) / 2 / SUN.y;
  for (const side of [-1, 1]) {
    const wallX = side * (width / 2 - pillar.size / 2);
    for (let z = pillar.spacing / 2; z < length; z += pillar.spacing) {
      add(stone, new Vector3(pillar.size, height, pillar.size), new Vector3(wallX, height / 2, z));
      if (z + pillar.spacing >= length) continue;
      const between = z + pillar.spacing / 2;
      const cloth = new Mesh(new PlaneGeometry(bannerSize.width, bannerSize.height), banner);
      cloth.position.set(side * (width / 2 - 0.05), 13, between);
      cloth.rotation.y = -side * Math.PI / 2; // facing into the hall
      hall.add(cloth);
      if (side < 0) continue;
      // a shaft of hazy light from this window to the floor, along the sunlight
      const beam = new Mesh(new BoxGeometry(2, shaftLength, pillar.spacing - pillar.size), shaft);
      const opening = new Vector3(width / 2, (windows.bottom + windows.top) / 2, between);
      beam.position.copy(opening).addScaledVector(SUN, -shaftLength / 2);
      beam.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), SUN);
      hall.add(beam);
    }
  }
  // three larger banners on the back wall above the dais
  for (const x of [-6, 0, 6]) {
    const cloth = new Mesh(new PlaneGeometry(bannerSize.width * 1.3, bannerSize.height * 1.3), banner);
    cloth.position.set(x, DAIS.height + 9, length - 0.05);
    cloth.rotation.y = Math.PI; // facing the doors
    hall.add(cloth);
  }
  return hall;
}

/** a rough, non-metallic PBR stone from a folder holding basecolor.jpg, normal.jpg and roughness.jpg, tiling every TILE metres */
function stoneMaterial(folder: string): MeshStandardMaterial {
  const tiled = (texture: Texture) => {
    texture.wrapS = texture.wrapT = RepeatWrapping;
    texture.anisotropy = 8;
    return texture;
  };
  return new MeshStandardMaterial({
    map: tiled(colorTexture(`${folder}/basecolor.jpg`)),
    normalMap: tiled(loader.load(`${folder}/normal.jpg`)),
    roughnessMap: tiled(loader.load(`${folder}/roughness.jpg`)),
    metalness: 0,
  });
}

const loader = new TextureLoader();
function colorTexture(url: string): Texture {
  const texture = loader.load(url);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/**
 * A box whose texture coordinates are in TILE-metre units on every face, so the texture keeps one scale on blocks of any size
 * (a plain BoxGeometry stretches one copy of the texture over each face).
 */
function boxWithTiledUvs(size: Vector3): BoxGeometry {
  const box = new BoxGeometry(size.x, size.y, size.z);
  const uv = box.getAttribute('uv');
  // BoxGeometry's faces, 4 vertices each, in order +x, -x, +y, -y, +z, -z, and the extents their u and v run across
  const faceExtents = [[size.z, size.y], [size.z, size.y], [size.x, size.z], [size.x, size.z], [size.x, size.y], [size.x, size.y]];
  for (let vertex = 0; vertex < uv.count; vertex++) {
    const [across, up] = faceExtents[Math.floor(vertex / 4)];
    uv.setXY(vertex, (uv.getX(vertex) * across) / TILE, (uv.getY(vertex) * up) / TILE);
  }
  return box;
}

/** the hall's placement empties, by name */
export type Marks = ReturnType<typeof createMarks>;
