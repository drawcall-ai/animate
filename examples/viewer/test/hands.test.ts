import { Group, Vector3, type Object3D } from 'three';
import { expect, test } from 'vitest';
import { carry, grab, release, wait, type Body, type Root, grip } from '@drawcall/animate';
import { Simulation } from '../src/simulation';
import type { Person, Scenario, Stage } from '../src/scenario';
import { box } from '../src/things';
import { Actor } from './actor';

// What hands do with small things on and about the body: put one down and take another, carry one into a pouch on the walk.

const logged = (log: Body['log']) => log.slice(0, 4).map((entry) => `${entry.check} ${entry.where} ${entry.worst.toFixed(3)} (limit ${entry.limit}) @${entry.time.toFixed(2)}`);

/** one person playing `story` (made once it stands) for `duration` s, development checks on; `each` reads it after every frame */
function play(duration: number, story: (person: Person) => Stage['story'], drive?: (time: number) => Root, each?: (time: number, actor: Actor) => void) {
  const scenario: Scenario = {
    id: 'small', title: 'small', duration,
    stage: (cast) => {
      const person = cast.person({ drive });
      return { scene: new Group(), bodies: [person], story: story(person), done: () => true };
    },
  };
  const sim = new Simulation(scenario, { dev: true });
  const actor = new Actor(sim.people[0]);
  while (sim.t < duration) {
    sim.step();
    each?.(sim.t, actor);
  }
  return sim.people[0];
}

/** a 0.5 kg bar named `name` under `parent` at `at`, taken by its middle as the hand comes */
function bar(parent: Object3D, name: string, at: Vector3): Object3D {
  const thing = box(parent, name, new Vector3(0.03, 0.12, 0.03), at);
  thing.userData.mass = 0.5;
  grip(thing, 'grip', new Vector3());
  return thing;
}

/** an empty named `name` on `person`'s chest, `offset` from the chest bone as the body stands (+X left, +Z ahead) */
function onChest(person: Person, name: string, offset: Vector3): Object3D {
  const chest = person.bones.chest, place = new Group();
  place.name = name;
  place.position.copy(chest.getWorldPosition(new Vector3())).add(offset);
  chest.attach(place);
  return place;
}

test('a hand that puts one thing down and takes another keeps to the grip it takes', () => {
  let worst = 0;
  const person = play(3, (person) => {
    const tray = grip(person.object, 'tray', new Vector3(0.25, 1.0, 0.35));
    const cup = bar(tray, 'cup', new Vector3()), rod = bar(person.object, 'rod', new Vector3(0.2, 1.05, 0.45));
    return function* () {
      yield* grab(person, cup, { left: 'grip' });
      release(person, cup, tray);
      yield* grab(person, rod, { left: 'grip' });
      yield* wait(Infinity);
    };
  }, undefined, (_, actor) => {
    const hold = actor.holding.left;
    if (hold?.thing.name === 'rod') worst = Math.max(worst, actor.joint('leftPalm').distanceTo(hold.grip));
  });
  expect(worst).toBeLessThanOrEqual(0.01);
  expect(logged(person.log)).toEqual([]);
});

test('a carry into a pouch on the chest comes to rest there while the body walks', () => {
  // (a player's walk: 1.4 m/s, eased in over a second)
  const root: Root = { position: new Vector3(), velocity: new Vector3(), yaw: 0 };
  const drive = (time: number) => {
    root.velocity?.set(0, 0, 1.4 * Math.min(1, time));
    root.position.set(0, 0, time < 1 ? 0.7 * time * time : 0.7 + 1.4 * (time - 1));
    return root;
  };
  let clock = 0, carried = NaN;
  const person = play(5, (person) => {
    const pouch = (name: string, aside: number) => {
      const place = onChest(person, name, new Vector3(aside, -0.17, 0.2));
      grip(place, `over ${name}`, new Vector3(0, 0.1, 0));
      place.userData.approach = [`over ${name}`];
      return place;
    };
    const from = pouch('pouch 1', 0.06), to = pouch('pouch 2', 0.13), magazine = bar(from, 'magazine', new Vector3());
    return function* () {
      yield* wait(1);
      yield* grab(person, magazine, { left: 'grip' });
      const began = clock;
      yield* carry(person, magazine, to);
      carried = clock - began;
      release(person, magazine, to);
      yield* wait(Infinity);
    };
  }, drive, (time) => { clock = time; });
  expect(carried).toBeLessThan(1.5);
  expect(logged(person.log)).toEqual([]);
});
