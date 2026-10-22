import { HORSE_TROT, HORSE_WALK, horseMotion } from '../../../packages/animate/src/horse/legs';
import { skeletonProps } from '../stage/props';
import { Quaternion, Vector3 } from 'three';
import { Body, horse as horseSpecies, type Humanoid, Pose, yawOf, type DrivenRoot, type Frame, type Gait, type Species } from '@drawcall/animate';
import { idle } from '@drawcall/animate/rig';
import type { RootGoal, Stepper } from '../../../packages/animate/src/core/legs/stepper';
import { minimumJerk } from '../../../packages/animate/src/core/math';
import type { Scenario } from '../scenario';
import { Report } from '../report';

const HORSE = horseSpecies().skeleton;

/** Script only: integrate a smooth speed ramp, then a broad bend and a smooth stop. No balance or body planner. */
export function scriptedRoot(height: number, pace: number, origin = new Vector3(), yaw = 0, start = 0, brake = 2, radius = 15) {
  const speed = (t: number) => pace * minimumJerk((t - start) / 2) * (1 - minimumJerk((t - start - 10) / brake));
  // Fixed quadrature table makes prediction independent of the update cadence.
  const dt = 1 / 240;
  const travel = [0];
  for (let i = 1; i <= 16 / dt; i++) travel.push(travel[i - 1] + (speed((i - 1) * dt) + speed(i * dt)) * dt / 2);
  return {
    speed,
    at(t: number) {
      const x = Math.min(travel.length - 1, Math.max(0, t / dt));
      const k = Math.min(travel.length - 2, Math.floor(x));
      const s = travel[k] + (travel[k + 1] - travel[k]) * (x - k);
      // Scene choice: a broad 15 m bend by default; radius is independent of the gait.
      const a = Math.max(0, s - pace * 4) / radius;
      const position = new Vector3(radius * (1 - Math.cos(a)), height, Math.min(s, pace * 4) + radius * Math.sin(a));
      position.applyAxisAngle(UP, yaw).add(origin);
      return { position, quaternion: new Quaternion().setFromAxisAngle(UP, yaw + a) };
    },
  };
}

/** The legs under a route: its point on the floor, velocity and facing each sub-step, and where it will be ahead (as a planner knows it: the stepper's fuller root) */
export function along(route: ReturnType<typeof scriptedRoot>): (f: Frame) => RootGoal {
  return (f) => {
    const at = route.at(f.time), next = route.at(f.time + f.dt), position = at.position.clone().setY(0);
    return { position, velocity: next.position.clone().setY(0).sub(position).divideScalar(f.dt), yaw: yawOf(at.quaternion),
      forecast: (ahead) => { const then = route.at(f.time + ahead); return { position: then.position.clone().setY(0), yaw: yawOf(then.quaternion) }; } };
  };
}

export function legsBiped(): Scenario {
  return {
    id: 'legs-biped', title: 'Legs: a person on a scripted root', duration: 16, actors: [{}],
    description: 'A person\'s stepper under a scripted root: straight, curve, stop. No balance.',
    stage: () => {
      let person: Humanoid | null = null;
      return {
        report: new Report(), props: () => [],
        done: () => !!person?.stepper && (person.stepper as Stepper).legs.every((leg) => !leg.swing) && person.frame.time > 15,
        script: (h) => {
          person = h;
          return idle(h, { root: along(scriptedRoot(0, 1.3, h.pose.position(0).clone().setY(0), yawOf(h.pose.rotation(0)), 1, 3)) });
        },
      };
    },
  };
}

export function legsHorse(): Scenario {
  return {
    id: 'legs-horse', title: 'Legs: horse walk and trot on scripted roots', duration: 16, actors: [], cameraDistance: 9, skins: ['models/horse.glb', 'models/horse.glb'],
    description: 'Two horses on their stepper: walk and trot along scripted roots. No planner.',
    stage: (dev = false) => {
      const make = (gait: Gait, pace: number, x: number) => {
        const base = horseSpecies(), species: Species = { ...base, legs: { ...base.legs!, gait, posture: (start) => horseMotion(start, gait) } };
        const pose = new Pose(HORSE);
        pose.setRoot(new Vector3(x, pose.position(0).y, 0));
        const route = scriptedRoot(0, pace, new Vector3(x, 0, 0));
        return new Body(species, undefined, { pose, dev, idle: { root: along(route) } });
      };
      const bodies = [make(HORSE_WALK, 1.6, -2), make(HORSE_TROT, 3.7, 2)];
      return {
        report: new Report(), bodies,
        props: () => bodies.flatMap((body) => skeletonProps(body.pose)),
        done: () => bodies.every((body) => !!body.stepper && (body.stepper as Stepper).legs.every((leg) => !leg.swing) && body.frame.time > 15),
        script: () => { throw new Error('horse scenario has no humanoids'); },
      };
    },
  };
}

const UP = new Vector3(0, 1, 0);
