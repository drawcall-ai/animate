import { Group, Quaternion, Vector3, type Bone, type Object3D } from 'three';
import { action, parallel, type NonReuseableTimeline } from '@pmndrs/timeline';
import { arriving, Body, humanoid, lookAt, track, wait, walkTo } from '@drawcall/animate';
import type { Dress } from './cast';
import { floorAt, HALL } from './hall';
import { TROOPER } from './skeletons/trooper';
import { MEDAL_BEARER } from './skeletons/bearer';

// The Rebel troops: blocks of soldiers in khaki and helmets (the light trooper model) either side of the aisle, facing it at attention, with an
// officer in his tunic (the medal bearer's model and build) before each block.
//
// A simulated body costs about 0.1 ms a frame standing and 0.3 ms clapping, so hundreds of them would not keep 60 Hz. Only the officers
// and every other soldier of each block's front rank are bodies. Every other soldier is an "echo": a copy of the trooper model that
// replays the pose of a body in its block a little later (each echo with its own delay), so neighbours never move in lockstep and a
// turn ripples back through the ranks. Echoes exist only when the viewer dresses bodies in models; headless runs have the bodies alone.

const SPACING = { file: 0.9, rank: 1.0 };
/** soldiers per rank along the aisle, and ranks from the aisle outward, in each block */
const BLOCK = { files: 8, ranks: 6 };
/** each block's first file along the aisle (z): three blocks a side between the troops' back and front */
const BLOCK_STARTS = [HALL.troops.back + 0.5, HALL.troops.back + 8.5, HALL.troops.back + 16.5];
/** how far behind its leader an echo may replay (s) */
const LONGEST_DELAY = 0.6;
const FRAME = 1 / 60;

/** where the troops look when the trio stands decorated: a person's eyes on the step below the dais (1.6 m up on the 0.8 m step) */
export const HEROES = new Vector3(0, 2.4, 34.2);

/** One simulated member of the troops: an officer or a front-rank soldier. */
export interface Trooper {
  body: Body;
  /** fixes its variation: when it reacts, how it applauds */
  seed: number;
}

export interface Troops {
  troopers: Trooper[];
  /** the echoes, as one group to add to the scene (empty when headless) */
  echoes: Group;
  /** a never-ending story branch that keeps each echo on its leader's delayed pose */
  replay(): NonReuseableTimeline<unknown>;
}

/** Creates each block's officer and simulated front-rank soldiers, and (dressed) the echoes that fill the ranks behind them. */
export function createTroops(dress: Dress, dev = true): Troops {
  const soldier = humanoid(TROOPER), officer = humanoid(MEDAL_BEARER);
  const troopers: Trooper[] = [];
  const echoes = new Group();
  echoes.name = 'troop echoes';
  const leaders: Leader[] = [];
  const followers: (() => void)[] = [];
  let seed = 100;

  const enlist = (at: Vector3, face: number, name: string, rank: 'officer' | 'soldier') => {
    const [species, skeleton] = rank === 'officer' ? [officer, MEDAL_BEARER] : [soldier, TROOPER];
    const trooper = { body: new Body(species, { at, face, floor: floorAt, model: dress(skeleton), life: { seed }, dev }), seed: seed++ };
    trooper.body.object.name = name;
    troopers.push(trooper);
    return trooper;
  };

  for (const side of [1, -1]) {
    // a block on the left (+X) faces the aisle by facing -X (yaw -π/2), one on the right by facing +X
    const face = (-side * Math.PI) / 2;
    const sideName = side > 0 ? 'left' : 'right';
    for (const [block, start] of BLOCK_STARTS.entries()) {
      const middle = start + ((BLOCK.files - 1) * SPACING.file) / 2;
      enlist(new Vector3(side * HALL.troops.inner, 0, middle), face, `officer ${sideName} ${block}`, 'officer');
      const front: Leader[] = [];
      for (let file = 0; file < BLOCK.files; file += 2) {
        const at = new Vector3(side * (HALL.troops.inner + 0.9), 0, start + file * SPACING.file);
        front.push({ body: enlist(at, face, `soldier ${sideName} ${block}.${file}`, 'soldier').body, history: [] });
      }
      leaders.push(...front);
      for (let file = 0; file < BLOCK.files; file++) {
        for (let rank = 0; rank < BLOCK.ranks; rank++) {
          if (rank === 0 && file % 2 === 0) continue; // a simulated soldier stands here
          const model = dress(TROOPER);
          if (!model) continue;
          const at = new Vector3(side * (HALL.troops.inner + 0.9 + rank * SPACING.rank), 0, start + file * SPACING.file);
          const delay = 1 + Math.round((random(seed++) * LONGEST_DELAY) / FRAME);
          const follower = echo(model, at, front[Math.floor(file / 2)], delay);
          echoes.add(follower.root);
          followers.push(follower.replay);
        }
      }
    }
  }

  return {
    troopers,
    echoes,
    replay: () =>
      action({
        update() {
          for (const leader of leaders) record(leader);
          for (const replay of followers) replay();
        },
      }),
  };
}

/**
 * One trooper's part in the scene: at attention, eyes straight across the aisle, until `cue`; then, after its own short reaction, it turns
 * to the heroes (eyes first, the feet stepping round) and applauds them, a few cheering with a raised fist instead. It never ends.
 */
export function* serve(trooper: Trooper, cue: () => boolean): NonReuseableTimeline<unknown> {
  const { body, seed } = trooper;
  const forward = new Vector3(Math.sin(body.facing), 0, Math.cos(body.facing));
  const across = body.position.clone().addScaledVector(forward, 10).setY(1.68);
  yield* lookAt(body, across, { until: cue });
  yield* lookAt(body, across, { until: 0.1 + 0.5 * random(seed + 0.5) });
  const heroesOnTheFloor = HEROES.clone().setY(0);
  yield* parallel(
    'race',
    lookAt(body, HEROES),
    parallel('all', walkTo(body, body.position.clone(), { face: heroesOnTheFloor }), function* () {
      yield* wait(0.3); // lets the turn begin before asking how soon it ends
      yield* wait(arriving(body, 0.4));
      if (random(seed + 0.25) < 0.2) yield* cheer(body, seed);
      else yield* applaud(body, seed);
    }),
  );
}

/** Claps in front of the chest at the trooper's own rate, the hands meeting quickly and parting slowly. Never ends. */
function applaud(body: Body, seed: number) {
  const rate = 2.4 + random(seed + 0.75) * 1.0; // claps a second
  const phase = random(seed + 0.9);
  const hand = (side: 1 | -1) => (time: number) => {
    const opening = 0.5 - 0.5 * Math.cos(2 * Math.PI * (rate * time + phase)); // 0 as the hands meet, 1 fully apart
    const apart = 0.05 + 0.1 * Math.sqrt(opening); // half the wrists' distance: the palms touch with the wrists ~10 cm apart
    return inFrontOf(body, 0.32, 1.2, side * apart);
  };
  return track(body, { left: hand(1), right: hand(-1) });
}

/** Pumps a raised right fist high above the shoulder, the elbow nearly straight at the top. Never ends. */
function cheer(body: Body, seed: number) {
  const rate = 1.2 + random(seed + 0.6) * 0.5; // pumps a second
  const fist = (time: number) => inFrontOf(body, 0.1, 1.76 + 0.07 * Math.sin(2 * Math.PI * rate * time), -0.3);
  return track(body, { right: fist });
}

/** a point `forward` metres before `body`, `up` above the floor and `left` to its left (m) */
function inFrontOf(body: Body, forward: number, up: number, left: number): Vector3 {
  const yaw = body.facing;
  return new Vector3(Math.sin(yaw) * forward + Math.cos(yaw) * left, up, Math.cos(yaw) * forward - Math.sin(yaw) * left).add(body.position).setY(up);
}

/** A simulated soldier the echoes behind it replay, with its last poses newest first. */
interface Leader {
  body: Body;
  history: Pose[];
}
type Placement = { position: Vector3; quaternion: Quaternion };
/** a body's root and each of its bones (in the order of `Object.keys(body.bones)`), each as placed in its parent */
type Pose = { root: Placement; bones: Placement[] };

const placement = (): Placement => ({ position: new Vector3(), quaternion: new Quaternion() });

/** puts the leader's current pose at the front of its history, reusing the oldest once the history covers the longest delay */
function record(leader: Leader) {
  const { body, history } = leader;
  const bones = Object.values<Object3D>(body.bones);
  const full = history.length > LONGEST_DELAY / FRAME + 1;
  const pose = full ? history.pop()! : { root: placement(), bones: bones.map(placement) };
  pose.root.position.copy(body.object.position);
  pose.root.quaternion.copy(body.object.quaternion);
  bones.forEach((bone, index) => {
    pose.bones[index].position.copy(bone.position);
    pose.bones[index].quaternion.copy(bone.quaternion);
  });
  history.unshift(pose);
}

/** An echo of `leader` standing at `at`: each frame it takes the leader's pose of `delay` frames ago, moved over from the leader's place. */
function echo(model: Object3D, at: Vector3, leader: Leader, delay: number) {
  const byName = new Map<string, Bone>();
  model.traverse((node) => {
    if ((node as Bone).isBone) byName.set(node.name, node as Bone);
    node.castShadow = false; // hundreds of extra shadow casters cost more than their shadows add among the ranks
  });
  const bones = Object.keys(leader.body.bones).map((name) => {
    const bone = byName.get(name);
    if (!bone) throw new Error(`the trooper model has no bone "${name}" to echo`);
    return bone;
  });
  const home = leader.body.position.clone();
  const root = new Group();
  root.name = 'troop echo';
  root.add(model);
  root.position.copy(at);
  const replay = () => {
    const pose = leader.history[Math.min(delay, leader.history.length - 1)];
    if (!pose) return;
    // the leader's root moves off its place a little as it steps round: the echo moves off its own as much
    root.position.copy(at).add(pose.root.position).sub(home);
    root.quaternion.copy(pose.root.quaternion);
    pose.bones.forEach((placed, index) => {
      bones[index].position.copy(placed.position);
      bones[index].quaternion.copy(placed.quaternion);
    });
  };
  replay();
  return { root, replay };
}

/** a repeatable number in [0, 1) for `seed` */
function random(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}
