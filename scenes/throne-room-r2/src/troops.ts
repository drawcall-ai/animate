import { Bone, Group, MathUtils, Matrix4, Object3D, Quaternion, Skeleton, SkinnedMesh, Uint16BufferAttribute, Vector3 } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { parallel } from '@pmndrs/timeline';
import { arriving, Body, humanoid, lookAt, pose, track, wait, walkTo, type Verb } from '@drawcall/animate';
import type { Dress } from './cast';
import { HALL } from './hall';
import { TROOPER } from './skeletons/trooper';

// The Rebel troops of the throne room: blocks of soldiers either side of the aisle, facing it, an officer in front of each block.
//
// Scale. The film's hall holds several hundred troops: here 654 (2 sides × 3 blocks × 9 files × 12 ranks, and an officer per block).
// Simulating them all is out of reach: in the viewer (Chromium, Apple M2 Pro, 2026-10-29) a step costs about 0.08 ms per body —
// 60 troop bodies and the cast 5.6–6.5 ms, 114 bodies ~10.5 ms (still 60 fps), 168 ~15 ms (17–24 fps), 222 ~19 ms (8 fps) — so about
// 120 bodies is the ceiling at 60 fps beside rendering. As the library's skill advises for hundreds, only the soldiers whose eyes must
// meet the heroes are bodies: the officers and the front rank along the aisle (60). Every other soldier is a copy that replays a
// front-rank body's pose from a moment ago: the body of its block one or two files nearer the doors, delayed by about the time the
// heroes take to walk that far (so its gaze turns about when its own would) and a random quarter second more (so no two neighbours
// move in step).
//
// Drawing them. Six hundred cloned skinned models cost the browser more than a frame has even hidden: three.js updates every bone of
// every model each frame (~13 ms with 594 hidden copies, ~22 ms drawn, against ~2.5 ms for the 60 bodies alone; 20–30 fps playing).
// So a copy has no model of its own: each front-rank body's pose is kept as its skinning matrices relative to the body, and a block's
// copies are one skinned mesh whose bone matrices are those, moved to each copy's place — 12 draws for 594 copies, the crowd batching
// games do, in plain three.js. With it the full hall plays at 60 fps (walk and applause alike; shadows from every rank too). Copies only
// exist in the viewer: headless, nothing is drawn. (Measured with the scratch scripts of the crowd trial; the machine was shared, so
// single runs varied — the figures are of quiet runs.)

/** how the troops stand: the blocks along each side of the aisle (between HALL.troops' edges), their files and ranks */
export const RANKS = {
  /** blocks along each side, front to back with a gap between each */
  blocks: 3,
  gap: 1.2,
  /** soldiers along a rank (parallel to the aisle) in each block, and the spacing between their centres (m): shoulder to shoulder */
  files: 9,
  fileSpacing: 0.8,
  /** ranks one behind the other, away from the aisle (the first the front rank), and the spacing between them (m) */
  ranks: 12,
  rankSpacing: 1.0,
  /** how far in front of its block's front rank its officer stands (m), toward the aisle */
  officerAhead: 0.75,
} as const;

/** the walk pace (m/s) the copies' delays assume the heroes keep: a slow ceremonial walk */
const HERO_PACE = 0.9;
/** how many ranks from the aisle cast shadows: the shadows that read, on the open aisle floor; further back each rank's falls on the
 * next (all ranks casting also held 60 fps; this keeps the headroom) */
const SHADOW_RANKS = 3;
/** how many frames (at 60 Hz) of each body's pose are kept for its copies: the longest delay a copy follows at */
const HISTORY = 90;

/** One soldier of the troops: where it stands and faces, and either the body it is or the body it copies. */
export interface Soldier {
  /** its place on the floor, and the way it faces there (rad about +Y): the aisle */
  home: Vector3;
  face: number;
  /** +1 on the +x side of the aisle, −1 on the −x side */
  side: 1 | -1;
  block: number;
  /** its rank (0 the front rank, nearest the aisle; −1 the officer) and its file along the rank (0 the nearest the doors) */
  rank: number;
  file: number;
  officer: boolean;
  /** its seed: the variation of its quiet life and of its reactions */
  seed: number;
  /** the body it is, if it is simulated */
  body?: Body;
  /** the soldier whose body it copies and how many frames behind, if it is a copy */
  source?: Soldier;
  delay?: number;
}

/** The troops: every soldier, the simulated ones' bodies (step them with the cast), and the copies' meshes, posed by `afterStep`. */
export interface Troops {
  soldiers: Soldier[];
  /** the soldiers that are bodies (the officers and the front rank): give them to the beat as extras so they are stepped and drawn */
  bodies: Body[];
  /** the copies' meshes (empty headless): add it to the scene */
  object: Group;
  /** poses every copy from its source's recent poses; call it after the bodies have updated, every step */
  afterStep(): void;
}

/**
 * The troops standing at their places (see RANKS), the simulated soldiers dev-checked bodies when `dev`; copies are drawn only when
 * `dress` gives a model. `ranks` and `bodyEvery` (only every n-th file of the front rank a body, the rest copies) are for measuring.
 */
export function createTroops(
  dress: Dress,
  { dev = true, ranks = RANKS.ranks, bodyRanks = 1, bodyEvery = 1, shadowRanks = SHADOW_RANKS }: { dev?: boolean; ranks?: number; bodyRanks?: number; bodyEvery?: number; shadowRanks?: number } = {},
): Troops {
  const soldiers = layOut(ranks);
  const species = humanoid(TROOPER);
  for (const soldier of soldiers) {
    if (!soldier.officer && (soldier.rank >= bodyRanks || soldier.file % bodyEvery !== 0)) continue;
    soldier.body = new Body(species, { at: soldier.home.clone(), face: soldier.face, model: dress(TROOPER), dev, life: { seed: soldier.seed } });
    soldier.body.object.name = `trooper ${soldier.side > 0 ? '+x' : '-x'} block ${soldier.block} rank ${soldier.rank} file ${soldier.file}`;
  }
  for (const soldier of soldiers) {
    if (soldier.body) continue;
    // its source: one of the two front-rank bodies of its block nearest it on the doors' side (or the first)
    const random = seeded(soldier.seed);
    const fronts = soldiers.filter((each) => each.body && each.rank === 0 && each.side === soldier.side && each.block === soldier.block);
    const nearer = fronts.filter((front) => front.file <= soldier.file);
    const source = nearer.length ? nearer[nearer.length - 1 - Math.floor(random() * Math.min(2, nearer.length))] : fronts[0];
    soldier.source = source;
    soldier.delay = Math.min(HISTORY - 1, Math.round(((soldier.home.z - source.home.z) / HERO_PACE) * 60 + 3 + random() * 15));
  }
  const object = new Group();
  object.name = 'troop copies';
  const model = dress(TROOPER);
  const histories = new Map<Soldier, History>();
  const blocks: Copies[] = [];
  if (model) {
    for (const soldier of soldiers) if (soldier.body && soldier.rank === 0) histories.set(soldier, new History(soldier.body));
    for (const side of [1, -1]) {
      for (let block = 0; block < RANKS.blocks; block++) {
        const copies = soldiers.filter((soldier) => soldier.source && soldier.side === side && soldier.block === block);
        for (const shadows of [true, false]) {
          const these = copies.filter((copy) => copy.rank < shadowRanks === shadows);
          if (these.length) blocks.push(new Copies(these, model, histories, shadows));
        }
      }
    }
    object.add(...blocks.map((each) => each.mesh));
  }
  return {
    soldiers,
    bodies: soldiers.flatMap((soldier) => (soldier.body ? [soldier.body] : [])),
    object,
    afterStep() {
      for (const history of histories.values()) history.record();
      for (const each of blocks) each.pose();
    },
  };
}

/** every soldier's place: per side, per block, the officer in front and the ranks behind, files from the doors toward the dais */
function layOut(ranks: number): Soldier[] {
  const { inner, outer, front, back } = HALL.troops;
  const blockLength = (front - back - (RANKS.blocks - 1) * RANKS.gap) / RANKS.blocks;
  const soldiers: Soldier[] = [];
  const firstRank = inner + 0.4;
  if (firstRank + (ranks - 1) * RANKS.rankSpacing > outer) throw new Error(`${ranks} ranks do not fit between x = ${inner} and ${outer}`);
  for (const side of [1, -1] as const) {
    const face = side > 0 ? -Math.PI / 2 : Math.PI / 2; // facing the aisle
    for (let block = 0; block < RANKS.blocks; block++) {
      const start = back + block * (blockLength + RANKS.gap);
      const firstFile = start + (blockLength - (RANKS.files - 1) * RANKS.fileSpacing) / 2;
      const add = (rank: number, file: number, x: number, z: number) =>
        soldiers.push({ home: new Vector3(side * x, 0, z), face, side, block, rank, file, officer: rank < 0, seed: soldiers.length * 7919 + 13 });
      add(-1, (RANKS.files - 1) / 2, firstRank - RANKS.officerAhead, start + blockLength / 2);
      for (let rank = 0; rank < ranks; rank++) {
        for (let file = 0; file < RANKS.files; file++) add(rank, file, firstRank + rank * RANKS.rankSpacing, firstFile + file * RANKS.fileSpacing);
      }
    }
  }
  return soldiers;
}

/** the skinned mesh of a dressed model (the rigged trooper has one, at its root) */
function skinnedMesh(model: Object3D): SkinnedMesh {
  let found: SkinnedMesh | undefined;
  model.traverse((node) => {
    if ((node as SkinnedMesh).isSkinnedMesh) found = node as SkinnedMesh;
  });
  if (!found) throw new Error('the trooper model has no skinned mesh');
  return found;
}

/**
 * A body's recent poses, as its model's skinning matrices (each bone's world matrix times its inverse bind matrix) relative to the body's
 * `object`, and where that object stood and faced: what a copy elsewhere needs to draw the same pose.
 */
class History {
  private readonly mesh: SkinnedMesh;
  /** per frame: each bone's matrix (16 numbers), then the object's x, y, z and yaw */
  private readonly frames: Float32Array[];
  private newest = -1;
  private count = 0;
  private readonly inverse = new Matrix4();
  private readonly matrix = new Matrix4();
  constructor(private readonly body: Body) {
    this.mesh = skinnedMesh(body.object);
    this.frames = Array.from({ length: HISTORY }, () => new Float32Array(this.bones * 16 + 4));
  }
  get bones() {
    return this.mesh.skeleton.bones.length;
  }
  record() {
    this.newest = (this.newest + 1) % HISTORY;
    this.count = Math.min(HISTORY, this.count + 1);
    const frame = this.frames[this.newest];
    const { object } = this.body;
    object.updateMatrixWorld(true);
    this.inverse.copy(object.matrixWorld).invert();
    const { bones, boneInverses } = this.mesh.skeleton;
    for (let bone = 0; bone < bones.length; bone++) {
      this.matrix.multiplyMatrices(this.inverse, bones[bone].matrixWorld).multiply(boneInverses[bone]).toArray(frame, bone * 16);
    }
    frame.set([object.position.x, object.position.y, object.position.z, object.rotation.y], bones.length * 16);
  }
  /** the pose `delay` frames ago (or the oldest kept) */
  at(delay: number): Float32Array {
    return this.frames[(this.newest - Math.min(delay, this.count - 1) + HISTORY) % HISTORY];
  }
}

/**
 * A block's copies, drawn as one skinned mesh: the trooper's geometry once per copy, each copy's skin indices moved on to its own bones
 * in one skeleton of them all, whose bone matrices `pose` writes straight from the sources' histories (so the skeleton has no bones of
 * its own to update).
 */
class Copies {
  readonly mesh: SkinnedMesh;
  private readonly skeleton: Skeleton;
  private readonly bones: number;
  private readonly root = new Matrix4();
  private readonly at = new Vector3();
  private readonly turn = new Quaternion();
  private readonly one = new Vector3(1, 1, 1);
  private readonly up = new Vector3(0, 1, 0);
  constructor(private readonly copies: Soldier[], model: Object3D, private readonly histories: Map<Soldier, History>, shadows: boolean) {
    const source = skinnedMesh(model);
    this.bones = source.skeleton.bones.length;
    const geometries = copies.map((_, index) => {
      const geometry = source.geometry.clone();
      // (16-bit indices: a block's bones outnumber what the model's 8-bit ones hold)
      const skinIndex = geometry.getAttribute('skinIndex');
      geometry.setAttribute('skinIndex', new Uint16BufferAttribute(Array.from(skinIndex.array, (bone) => bone + index * this.bones), 4));
      return geometry;
    });
    const merged = mergeGeometries(geometries);
    if (!merged) throw new Error("the copies' geometries do not merge");
    for (const geometry of geometries) geometry.dispose();
    // one placeholder bone stands for them all: only the count matters, as the matrices are written directly
    const placeholder = new Bone();
    this.skeleton = new Skeleton(Array.from({ length: copies.length * this.bones }, () => placeholder), Array.from({ length: copies.length * this.bones }, () => new Matrix4()));
    this.skeleton.update = () => {
      if (this.skeleton.boneTexture) this.skeleton.boneTexture.needsUpdate = true;
    };
    this.mesh = new SkinnedMesh(merged, source.material);
    this.mesh.name = 'troop copies';
    this.mesh.bind(this.skeleton, source.bindMatrix);
    this.mesh.frustumCulled = false; // (its bounds are its rest pose's)
    this.mesh.castShadow = shadows;
  }
  /** each copy as its source was `delay` frames ago, moved from where the source stands to its own place, turned as it is turned */
  pose() {
    const matrices = this.skeleton.boneMatrices;
    this.copies.forEach((copy, index) => {
      const source = copy.source!;
      const frame = this.histories.get(source)!.at(copy.delay!);
      const base = this.bones * 16;
      this.at.set(frame[base] - source.home.x + copy.home.x, frame[base + 1], frame[base + 2] - source.home.z + copy.home.z);
      this.turn.setFromAxisAngle(this.up, frame[base + 3] + copy.face - source.face);
      this.root.compose(this.at, this.turn, this.one);
      for (let bone = 0; bone < this.bones; bone++) multiply(this.root.elements, frame, bone * 16, matrices, (index * this.bones + bone) * 16);
    });
  }
}

/** out[o…] = a · b[bo…], 4×4 column-major matrices */
function multiply(a: readonly number[], b: Float32Array, bo: number, out: Float32Array, o: number) {
  for (let column = 0; column < 4; column++) {
    const x = b[bo + column * 4], y = b[bo + column * 4 + 1], z = b[bo + column * 4 + 2], w = b[bo + column * 4 + 3];
    out[o + column * 4] = a[0] * x + a[4] * y + a[8] * z + a[12] * w;
    out[o + column * 4 + 1] = a[1] * x + a[5] * y + a[9] * z + a[13] * w;
    out[o + column * 4 + 2] = a[2] * x + a[6] * y + a[10] * z + a[14] * w;
    out[o + column * 4 + 3] = a[3] * x + a[7] * y + a[11] * z + a[15] * w;
  }
}

/** a small seeded random number generator (mulberry32): 0 ≤ value < 1 */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ——— the troops' story ———

/** how a soldier at attention notices a hero: within this distance (m), and this far round from straight ahead (rad), give or take */
const NOTICE = { distance: 11, angle: MathUtils.degToRad(55), spread: MathUtils.degToRad(10) };
/** how far round it keeps following one it has noticed (rad) before its eyes go back to the front */
const FOLLOW = MathUtils.degToRad(72);
/** how much of the way to the hero the head turns: at attention the eyes do most of the following (see `glance`) */
const HEAD_SHARE = 0.4;

/**
 * The simulated soldiers stand at attention, eyes front, until `until`; a soldier whose hero (the nearest of `heroes` that it can see
 * without turning its head far) comes near follows it with its eyes and a little with its head, and looks front again once it has passed.
 * As the heroes walk up the aisle the looks travel along the ranks with them. Their copies follow along. Returns true.
 */
export function* attend(troops: Troops, heroes: readonly Body[], { until = () => false }: { until?: () => boolean } = {}): Verb {
  yield* parallel('all', ...simulated(troops).map((soldier) => standAtAttention(soldier, heroes, until)));
  return true;
}

const simulated = (troops: Troops) => troops.soldiers.filter((soldier) => soldier.body);

function* standAtAttention(soldier: Soldier, heroes: readonly Body[], until: () => boolean): Verb {
  const body = soldier.body!;
  const random = seeded(soldier.seed + 1);
  const eyeHeight = body.species.person!.eyeHeight;
  // eyes front: on a point across the aisle at eye height, shifted a little now and then (a soldier at attention is not a statue)
  const front = new Object3D();
  front.position.set(0, eyeHeight, 12);
  body.object.add(front);
  const notice = NOTICE.angle + (random() - 0.5) * 2 * NOTICE.spread;
  const seen = () => sight(soldier, heroes, notice);
  // the hands at the trouser seams (a person's own hang a little forward and out): the wrists beside the thighs, the arms all but straight
  const person = body.species.person!;
  const out = person.hipHalfWidth + 0.085;
  const below = Math.sqrt((0.97 * person.armLength) ** 2 - (person.shoulderHalfWidth - out) ** 2);
  const seam = (side: 1 | -1) => () => body.object.localToWorld(new Vector3(side * out, person.shoulderHeight - below, 0.01));
  yield* parallel('race', track(body, { left: seam(1), right: seam(-1) }), function* () {
    while (!until()) {
      front.position.x = (random() - 0.5) * 0.8;
      front.position.y = eyeHeight + (random() - 0.5) * 0.3;
      // (a while, or until a hero comes into sight)
      yield* parallel('race', lookAt(body, front), wait(3 + random() * 5), wait(() => until() || seen() !== undefined));
      const hero = seen();
      if (!hero || until()) continue;
      // a beat before the eyes go (not all on the same frame), then the eyes on the hero until it is too far round
      yield* lookAt(body, front, { until: 0.1 + random() * 0.35 });
      yield* lookAt(body, glance(body, hero), { until: () => until() || sight(soldier, heroes, FOLLOW) !== hero });
    }
  });
  front.removeFromParent();
  return true;
}

/** the nearest of `heroes` within NOTICE.distance and `angle` of where `soldier` faces at home, if any */
function sight(soldier: Soldier, heroes: readonly Body[], angle: number): Body | undefined {
  let nearest: Body | undefined;
  let nearestDistance = NOTICE.distance;
  for (const hero of heroes) {
    const distance = hero.position.distanceTo(soldier.home);
    if (distance < nearestDistance && angleTo(soldier, hero) < angle) {
      nearest = hero;
      nearestDistance = distance;
    }
  }
  return nearest;
}

/** how far round from where `soldier` faces at home `hero` is (rad, 0 … π) */
function angleTo(soldier: Soldier, hero: Body): number {
  const toward = Math.atan2(hero.position.x - soldier.home.x, hero.position.z - soldier.home.z);
  return Math.abs(MathUtils.euclideanModulo(toward - soldier.face + Math.PI, 2 * Math.PI) - Math.PI);
}

/** where a soldier at attention looks to follow `hero`: HEAD_SHARE of the way from straight ahead round to the hero's head */
function glance(body: Body, hero: Body): () => Vector3 {
  const point = new Vector3(), eyes = new Vector3(), toward = new Vector3();
  const head = (hero.bones as Record<string, Object3D>).head;
  const ownHead = (body.bones as Record<string, Object3D>).head;
  return () => {
    ownHead.getWorldPosition(eyes);
    head.getWorldPosition(toward).sub(eyes);
    const distance = Math.hypot(toward.x, toward.z);
    const ahead = new Vector3(Math.sin(body.facing) * distance, toward.y, Math.cos(body.facing) * distance);
    return point.copy(eyes).add(ahead.lerp(toward, HEAD_SHARE));
  };
}

/** how the troops applaud: how long the clapping goes on (s, give or take), how quickly they clap (claps a second), who raises a fist */
const APPLAUSE = { seconds: 6, spread: 2, rate: [2.2, 3.2] as const, raise: 0.25 };

/**
 * The finale: the troops turn toward `heroes` (where they stand together), break into applause — clapping, some pumping a raised fist —
 * and settle again, at attention facing the heroes. Start it when the heroes have turned to face the hall. Returns true once every
 * soldier has settled; they keep their eyes on the heroes until `until` after that.
 */
export function* applaud(troops: Troops, heroes: readonly Body[], { until = () => true }: { until?: () => boolean } = {}): Verb {
  let settled = 0;
  const soldiers = simulated(troops);
  yield* parallel('race', ...soldiers.map((soldier) => cheer(soldier, heroes, () => settled++)), function* () {
    yield* wait(() => settled === soldiers.length);
    yield* wait(until);
  });
  return true;
}

function* cheer(soldier: Soldier, heroes: readonly Body[], onSettled: () => void): Verb {
  const body = soldier.body!;
  const random = seeded(soldier.seed + 2);
  const toward = new Vector3();
  for (const hero of heroes) toward.add((hero.bones as Record<string, Object3D>).head.getWorldPosition(new Vector3()));
  toward.divideScalar(heroes.length);
  const face = Math.atan2(toward.x - soldier.home.x, toward.z - soldier.home.z);
  const clapping = APPLAUSE.seconds + (random() - 0.5) * 2 * APPLAUSE.spread;
  const hands = applause(body, clapping, random);
  yield* lookAt(body, toward, { until: 0.1 + random() * 0.5 });
  yield* parallel('race', lookAt(body, toward), function* () {
    // the turn toward the heroes on the spot, the hands coming up as it ends
    yield* walkTo(body, soldier.home, { face, until: arriving(body, 0.4) });
    // cheering: the chin up a little as it claps
    yield* parallel('race', track(body, hands, { until: clapping }), pose(body, { head: { pitch: -0.08 - 0.1 * random() } }));
    yield* wait(1.5);
    onSettled();
    yield* wait(Infinity);
  });
  return true;
}

/**
 * The hands' targets through `seconds` of applause, in the body's frame as it turns: raised from hanging beside the thighs, clapping in
 * front of the chest (a quick close, a slower opening, `rate` claps a second) or, for some, the right fist raised and pumped overhead,
 * and lowered back beside the thighs as the time runs out — out to the side first, so the forearms clear the hips on the way down.
 */
function applause(body: Body, seconds: number, random: () => number): Partial<Record<'left' | 'right', (time: number) => Vector3>> {
  const person = body.species.person!;
  const raise = 0.6; // s to bring the hands up, and down again
  const pumps = random() < APPLAUSE.raise;
  const rate = pumps ? 1.6 + random() * 0.8 : MathUtils.lerp(APPLAUSE.rate[0], APPLAUSE.rate[1], random());
  const chest = person.shoulderHeight - 0.15 + random() * 0.1;
  const forward = 0.5 * person.armLength;
  let start: number | undefined;
  const hand = (sign: 1 | -1) => {
    const hanging = new Vector3(sign * (person.hipHalfWidth + 0.12), person.hipHeight - 0.12, 0.03);
    const gesture = new Vector3();
    const local = new Vector3();
    return (time: number) => {
      start ??= time;
      const t = time - start;
      const up = MathUtils.smoothstep(Math.min(t, seconds - t), 0, raise);
      if (pumps && sign < 0) {
        gesture.set(-0.2, person.shoulderHeight + 0.3 + 0.3 * (0.5 + 0.5 * Math.sin(t * rate * 2 * Math.PI)), 0.15);
      } else {
        const phase = (t * rate) % 1;
        gesture.set(sign * (0.02 + 0.16 * (phase < 0.3 ? 1 - phase / 0.3 : (phase - 0.3) / 0.7) ** 2), chest, forward);
      }
      local.set(
        MathUtils.lerp(hanging.x, gesture.x, up ** 3),
        MathUtils.lerp(hanging.y, gesture.y, up),
        MathUtils.lerp(hanging.z, gesture.z, Math.sqrt(up)),
      );
      return body.object.localToWorld(local.clone());
    };
  };
  return pumps ? { right: hand(-1) } : { left: hand(1), right: hand(-1) };
}
