import { Group, Vector3 } from 'three';
import { carry, grab, reach, wait, walkTo } from '@drawcall/animate';
import type { Scenario } from '../scenario';
import { ball, box, empty } from '../things';

export const idleLife: Scenario = {
  id: 'idle-life',
  title: 'Quiet standing',
  description: 'Breathing, quiet sway and an occasional shift of weight, without a task.',
  duration: 25,
  stage: (cast) => {
    const person = cast.person();
    return { scene: new Group(), bodies: [person], story: () => wait(Infinity), done: () => true };
  },
};

export const reachAround: Scenario = {
  id: 'reach-around',
  title: 'The trunk joins the reach',
  description: 'The right hand goes to three points in turn, the last behind on the left: the trunk turns with it, the hand comes round its front.',
  duration: 12,
  stage: (cast) => {
    const person = cast.person();
    const scene = new Group();
    const points = [new Vector3(-0.15, 1.15, 0.5), new Vector3(0.4, 1.15, 0.3), new Vector3(-0.45, 1.15, -0.15)];
    for (const point of points) ball(scene, 'point', 0.025, point);
    let reached = 0;
    return {
      scene,
      bodies: [person],
      story: function* () {
        for (const point of points) if (yield* reach(person, { right: point })) reached++;
      },
      done: () => reached === points.length,
    };
  },
};

export const liftHeavy: Scenario = {
  id: 'lift-heavy',
  title: 'Lift and carry five kilograms',
  description: 'A 5 kg box off the floor in both hands, up to the chest and carried 3 m ahead.',
  duration: 20,
  stage: (cast) => {
    const person = cast.person();
    const scene = new Group();
    const size = new Vector3(0.34, 0.26, 0.26);
    const load = box(scene, 'box', size, new Vector3(0, size.y / 2, 0.5));
    load.userData.mass = 5;
    empty(load, 'left', new Vector3(0.18, 0, 0));
    empty(load, 'right', new Vector3(-0.18, 0, 0));
    // (before its chest, wherever it goes)
    const chest = empty(person.object, 'before the chest', new Vector3(0, 1.1, 0.35));
    let carried = false;
    return {
      scene,
      bodies: [person],
      story: function* () {
        yield* grab(person, load, { left: 'left', right: 'right' });
        yield* carry(person, load, chest);
        carried = yield* walkTo(person, new Vector3(0, 0, 3.5));
      },
      done: () => carried && person.holds(load),
    };
  },
};
