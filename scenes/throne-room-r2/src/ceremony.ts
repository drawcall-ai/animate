import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial, Object3D, Vector3 } from 'three';
import { parallel } from '@pmndrs/timeline';
import { arriving, type Body, carry, grab, lookAt, release, type Until, type Verb, wait, walkTo } from '@drawcall/animate';
import { HALL } from './hall';
import { overHeadPlace, wornPlace } from './medal';

// The medal presentation (A New Hope's final scene): an officer beside Leia holds the medals; she takes each from him, steps up to the
// dais's edge before a hero standing on the step below, raises it over his head, lowers it round his neck so it rests on his chest, and
// steps back. A medal only ever moves in the hands that hold it: picked up by the bearer, handed to Leia (she takes hold before he lets
// go), carried by her, and let go onto the wearer's chest, where it stays.

/** the front edge of the dais's flat top (z): the last riser, where the step below it ends */
const DAIS_EDGE = HALL.steps.start + (HALL.steps.count - 1) * HALL.steps.tread;

/** a story a hero plays as a medal is hung on him: given whether it has been hung yet (his bow, his wink) */
export type Receiving = (hung: () => boolean) => Verb;

/**
 * A slim pedestal with a cushion, standing at `at` (on the floor there) beside the medal bearer, its front turned `face`, the medals lying on it until he takes
 * them up: the pedestal's top and an empty for each medal to rest on (`rests`), side by side across its cushion.
 */
export function createMedalStand(at: Vector3, face: number, height = 1.05): { stand: Group; rests: [Object3D, Object3D] } {
  const stand = new Group();
  stand.name = 'medal stand';
  stand.position.copy(at);
  stand.rotation.y = face;
  const stone = new MeshStandardMaterial({ color: 0xcfc2ae, roughness: 0.8 });
  const velvet = new MeshStandardMaterial({ color: 0x2a2f6e, roughness: 0.95 });
  const column = new Mesh(new CylinderGeometry(0.1, 0.14, height - 0.04, 24), stone);
  column.position.y = (height - 0.04) / 2;
  const cushion = new Mesh(new BoxGeometry(0.62, 0.04, 0.4), velvet);
  cushion.position.y = height - 0.02;
  for (const mesh of [column, cushion]) {
    mesh.castShadow = mesh.receiveShadow = true;
    stand.add(mesh);
  }
  // each medal lies on the cushion side by side, its medallion leaning back at the front (+Z) and its loop lying flat behind it (tipped
  // back until the loop's back, 0.18 m above and 0.29 m behind the medallion, is level with it)
  const rests = ([0.14, -0.14] as const).map((x, index) => {
    const rest = new Object3D();
    rest.name = `medal rest ${index + 1}`;
    rest.position.set(x, height + 0.034, 0.14);
    rest.rotation.x = -Math.atan2(0.18, 0.29);
    stand.add(rest);
    return rest;
  }) as [Object3D, Object3D];
  return { stand, rests };
}

/**
 * The bearer's hold on a medal hanging from his hand by the back of its loop, the medallion below: the turn about the medal's own +X that
 * puts its loop's back straight above its medallion (rad).
 */
const HANGING = Math.atan2(0.29, 0.17);
/** how far below the bearer's hand the medallion hangs so (m) */
const HANGING_DROP = Math.hypot(0.29, 0.17);

/**
 * A target that rides on `place` (an empty under a body's `object`): an unparented empty set to the place's world transform each time a
 * verb reads it. (Workaround: a carry to an empty parented straight to `body.object` on a raised floor lands a floor's height low; the
 * same place given as a world empty lands right.)
 */
export function riding(place: Object3D): () => Object3D {
  const world = new Object3D();
  world.name = `${place.name} (world)`;
  return () => {
    place.updateWorldMatrix(true, false);
    place.matrixWorld.decompose(world.position, world.quaternion, world.scale);
    world.updateMatrixWorld();
    return world;
  };
}

/**
 * A target in `body`'s own frame (+Z ahead, +X its left) at `[x, y, z]`, turned `yaw` about +Y and then `tilt` about its own +X: moving
 * and turning with the body. `remove` takes its empty off the body once it is done with.
 */
function placeOn(body: Body, name: string, [x, y, z]: readonly [number, number, number], yaw = 0, tilt = 0) {
  const place = new Object3D();
  place.name = name;
  place.position.set(x, y, z);
  place.rotation.set(tilt, yaw, 0, 'YXZ');
  body.object.add(place);
  return { target: riding(place), remove: () => place.removeFromParent() };
}

/**
 * The bearer takes up both medals from their stand, the first in his right hand, then the second in his left, and holds them before him, hanging from his hands by their ribbons: ready. (A composed scene can run this while the
 * heroes come up the aisle.)
 */
export function* readyMedals(bearer: Body, medals: readonly [Object3D, Object3D]): Verb {
  const [first, second] = medals;
  // each hand a forearm's length below the shoulder and ahead of the body, elbows bent; the medallion hangs below it (HANGING_DROP)
  const height = bearer.species.person!.shoulderHeight - 0.2 - HANGING_DROP;
  const right = placeOn(bearer, 'medal held right', [-0.15, height, 0.36], 0, HANGING);
  const left = placeOn(bearer, 'medal held left', [0.15, height, 0.36], 0, HANGING);
  const held = [false, false];
  // one after the other: carrying the first up while bowing to the stand for the second would hold it against his own chest
  if (!(yield* grab(bearer, first, { right: 'bearer' }))) return false;
  if (!(yield* grab(bearer, second, { left: 'bearer' }, { step: false }))) return false;
  yield* parallel(
    'all',
    function* () {
      held[0] = yield* carry(bearer, first, right.target, { step: false });
    },
    function* () {
      held[1] = yield* carry(bearer, second, left.target, { step: false });
    },
  );
  return held[0] && held[1];
}

/**
 * Leia takes `medal` from the bearer: he steps up and holds it out at her right, its face toward her; she turns to it and takes its ribbon
 * in both hands; only once she holds it does he let go. It ends with the medal in her hands alone.
 */
export function* takeMedal(leia: Body, bearer: Body, medal: Object3D): Verb {
  const person = leia.species.person!;
  // the offer, at Leia's right front in her own frame, at her waist: the medallion hanging, its face turned toward her
  const offer = placeOn(leia, 'medal offered', [-0.18, person.hipHeight - 0.05, 0.36], Math.PI, HANGING);
  let taken = false;
  yield* parallel(
    'race',
    carry(bearer, medal, offer.target, { until: Infinity }),
    lookAt(bearer, medal, { until: Infinity }),
    function* () {
      // she reaches for it as it comes, once it is nearly there (the bearer's `arriving` holds already while his carry plans its walk)
      const offered = new Vector3();
      yield* wait(() => medal.getWorldPosition(new Vector3()).distanceTo(offer.target().getWorldPosition(offered)) < 0.15);
      yield* parallel('race', lookAt(leia, medal, { until: Infinity }), function* () {
        taken = yield* grab(leia, medal, { left: 'left', right: 'right' }, { step: false });
      });
    },
  );
  offer.remove();
  if (!taken || !leia.holds(medal)) return false;
  release(bearer, medal);
  return true;
}

/** How Leia hangs a medal. */
export interface Hanging {
  /** his part as she hangs it (his eyes on her, a bow), started as she comes up to him */
  receive: Receiving;
  /** her step back once it is on, to `back` (default: a slow walk there, her eyes on him) */
  stepBack?: (leia: Body, back: Object3D, hero: Body) => Verb;
  /** runs as she lets go of it, hung */
  onHung?: () => void;
}

/**
 * Leia, holding `medal`, brings it up before her as she steps up to the dais's edge straight before `hero` (on the step below, facing her),
 * raises it over his head and lowers it round his neck, lets go once it rests on his chest, and steps back to `back`. Her eyes are on him
 * as she comes and on the medal as it goes over his head.
 */
export function* hangMedal(leia: Body, hero: Body, medal: Object3D, back: Object3D, { receive, stepBack = walkBack, onHung }: Hanging): Verb {
  const person = leia.species.person!;
  // where she stands: her toes at the dais's edge, square before him
  const spot = new Object3D();
  spot.name = 'before the hero';
  spot.position.set(hero.position.x, leia.position.y, DAIS_EDGE + person.toeFront + 0.015);
  spot.rotation.y = hero.facing + Math.PI;
  leia.object.parent!.add(spot);
  spot.updateMatrixWorld();
  // the medal held before her as she goes, its face toward her
  const before = placeOn(leia, 'medal before her', [0, person.hipHeight + 0.05, 0.25], Math.PI);
  // where it goes: made now, while he stands upright, before he bows
  const worn = wornPlace(hero);
  const over = overHeadPlace(hero, worn);
  let hung = false;
  let placed = false;
  let back_ = false;
  yield* parallel(
    'all',
    function* () {
      yield* parallel('race', lookAt(leia, hero, { until: Infinity }), function* () {
        yield* parallel('all', carry(leia, medal, before.target, { step: false }), walkTo(leia, spot, { speed: 0.6, until: arriving(leia, 0.4) }));
      });
      yield* parallel('race', lookAt(leia, medal, { until: Infinity }), function* () {
        placed = yield* carry(leia, medal, [riding(over), worn], { step: false, speed: 0.35 });
      });
      if (placed) release(leia, medal, worn);
      hung = placed && medal.parent === worn;
      if (hung) onHung?.();
      back_ = yield* stepBack(leia, back, hero);
    },
    function* () {
      yield* wait(0.2);
      yield* wait(arriving(leia, 0.8));
      yield* receive(() => hung);
    },
  );
  spot.removeFromParent();
  over.removeFromParent();
  before.remove();
  return hung && back_;
}

/** Leia's plain step back after hanging a medal: a slow walk to `back`, her eyes staying on him */
function* walkBack(leia: Body, back: Object3D, hero: Body): Verb {
  let arrived = false;
  yield* parallel('race', lookAt(leia, hero, { until: Infinity }), function* () {
    arrived = yield* walkTo(leia, back, { speed: 0.5 });
  });
  return arrived;
}

/** a hero's plain part as his medal is hung: his eyes on Leia and his head inclined a little toward her until it is on */
export function lookingAtGiver(hero: Body, giver: Body): Receiving {
  return (hung) => lookAt(hero, giver, { pitch: 0.25, until: hung });
}

/**
 * The onlookers' eyes until `until`: each looks at what `focus` names for it (a medal as it moves, a body's eyes), turning when that
 * changes; where it names nothing the onlooker's eyes are left to another story (a hero's own part as his medal is hung).
 */
export function* follow(onlookers: readonly Body[], focus: (onlooker: Body) => Object3D | Body | undefined, until: Until): Verb {
  yield* parallel('race', wait(until), ...onlookers.map((onlooker, index) =>
    (function* () {
      yield* wait(0.2 * index); // they do not all turn on the same frame
      while (true) {
        const target = focus(onlooker);
        if (target === undefined) yield* wait(() => focus(onlooker) !== undefined);
        else yield* lookAt(onlooker, target, { until: () => focus(onlooker) !== target });
      }
    })(),
  ));
  return true;
}
