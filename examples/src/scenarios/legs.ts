import { HORSE_TROT } from '../../../packages/animate/src/horse/legs';
import { skeletonProps } from '../stage/props';
import { Quaternion, Vector3 } from 'three';
import { action } from '@pmndrs/timeline';
import { Body, HORSE_SKELETON, HORSE_WALK, Legs, Pose, createWorld, horseLegs, humanGait, humanLegs, minimumJerk, yawOf, type Frame, type LegGait, type ReadonlyPose, type World } from '@drawcall/animate';
import type { Scenario } from '../scenario';
import { Report } from '../report';

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

/** Scene proxy: 3 cm below standing, on the scale of walking COM excursions (2.74–4.83 cm).
 * Orendurff et al. (2004), doi:10.1682/JRRD.2003.10.0150; this fixed root is not a COM trajectory. */
export function bipedRoot(pose: ReadonlyPose, scale: number, brake = 3, pace = 1.3) {
  const initial = pose.position(0).y;
  const height = initial - 0.03 * scale;
  const route = scriptedRoot(height, pace, pose.position(0).clone().setY(0), yawOf(pose.rotation(0)), 1, brake);
  return { speed: route.speed, at(t: number) {
    const at = route.at(t);
    const u = Math.min(1, t);
    at.position.y += (initial - height) * (1 - u * u * (3 - 2 * u));
    return at;
  } };
}

export function legsBiped(): Scenario {
  return {
    id: 'legs-biped', title: 'Leg engine: biped', duration: 16, actors: [{}],
    description: 'Perry/Winter leg cycles under a scripted root: straight, curve, stop. No balance.',
    stage: () => {
      let engine: Legs | null = null;
      return {
        world: createWorld(), report: new Report(), props: () => [],
        done: () => !!engine && engine.legs.every((l) => l.planted),
        script: (h) => function* () {
          const gait = humanGait(h.proportions);
          const route = bipedRoot(h.pose, h.proportions.scale);
          engine = new Legs(h.pose, humanLegs(h.proportions), gait);
          yield* action<Frame<World>>({ update: (f) => {
            const at = route.at(f.time);
            f.current.setRoot(at.position);
            f.current.setLocal(0, at.quaternion);
            engine?.update(f, { root: route.at, speed: route.speed });
          } });
        },
      };
    },
  };
}

export function legsHorse(): Scenario {
  return {
    id: 'legs-horse', title: 'Leg engine: horse walk and trot', duration: 16, actors: [], cameraDistance: 9,
    description: 'Two horses: walk and trot along scripted roots. No balance.',
    stage: (dev = false) => {
      const engines: Legs[] = [];
      const make = (gait: LegGait, pace: number, x: number) => {
        const pose = new Pose(HORSE_SKELETON);
        // Tuned: 8 cm reach reserve for the fixed root through stance and breakover.
        const route = scriptedRoot(1.32, pace, new Vector3(x, 0, 0));
        pose.setRoot(route.at(0).position);
        const engine = new Legs(pose, horseLegs(), gait);
        engines.push(engine);
        return new Body(HORSE_SKELETON, () => action<Frame>({ update: (f) => {
          const at = route.at(f.time);
          f.current.setRoot(at.position);
          f.current.setLocal(0, at.quaternion);
          engine.update(f, { root: route.at, speed: route.speed });
        } }), { pose, dev });
      };
      const bodies = [make(HORSE_WALK, 1.6, -2), make(HORSE_TROT, 3.7, 2)];
      return {
        world: createWorld(), report: new Report(), bodies,
        props: () => bodies.flatMap((body) => skeletonProps(body.pose)),
        done: () => engines.every((e) => e.legs.every((l) => l.planted)),
        script: () => { throw new Error('horse scenario has no humanoids'); },
      };
    },
  };
}

const UP = new Vector3(0, 1, 0);
