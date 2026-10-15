import { Quaternion, Vector3 } from 'three';
import { action } from '@pmndrs/timeline';
import { Body, HORSE_SKELETON, HORSE_TROT, HORSE_WALK, Legs, Pose, createWorld, horseLegs, humanGait, humanLegs, yawOf, type Frame, type LegGait, type ReadonlyPose, type World } from '@drawcall/animate';
import type { Prop, Scenario } from '../scenario';
import { Report } from '../report';

/** Script only: integrate a smooth speed ramp, then a broad bend and a smooth stop. No balance or body planner. */
export function scriptedRoot(height: number, pace: number, origin = new Vector3(), yaw = 0, start = 0, brake = 2) {
  const ease = (x: number) => { const t = Math.min(1, Math.max(0, x)); return t * t * t * (10 - 15 * t + 6 * t * t); };
  const speed = (t: number) => pace * ease((t - start) / 2) * (1 - ease((t - start - 10) / brake));
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
      // Recalled: 15 m radius is the spike's gentle horse bend; shared here for isolation.
      const a = Math.max(0, s - pace * 4) / 15;
      const position = new Vector3(15 * (1 - Math.cos(a)), height, Math.min(s, pace * 4) + 15 * Math.sin(a));
      position.applyAxisAngle(UP, yaw).add(origin);
      return { position, quaternion: new Quaternion().setFromAxisAngle(UP, yaw + a) };
    },
  };
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
          // Tuned: leave reach reserve under the fixed root; the engine never lowers it.
          const height = h.proportions.hipHeight - 0.11 * h.proportions.scale;
          const origin = h.pose.position(0).clone().setY(0);
          const route = scriptedRoot(height, 1.3, origin, h.yaw, 1, 3);
          // Start with the existing reachable stance, then ease down before stepping.
          const initial = h.pose.position(0).y;
          const root = (t: number) => {
            const at = route.at(t);
            const u = Math.min(1, t);
            at.position.y += (initial - height) * (1 - u * u * (3 - 2 * u));
            return at;
          };
          engine = new Legs(h.pose, humanLegs(h.proportions), gait);
          yield* action<Frame<World>>({ update: (f) => {
            const at = root(f.time);
            f.current.setRoot(at.position);
            f.current.setLocal(0, at.quaternion);
            engine?.update(f, { root, speed: route.speed });
            h.gait.facing = yawOf(at.quaternion);
            h.gait.velocity.subVectors(at.position, f.prev.position(0)).divideScalar(f.dt).setY(0);
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

function skeletonProps(pose: ReadonlyPose): Prop[] {
  return pose.skeleton.bones.flatMap((b, i): Prop[] => {
    if (b.parent < 0) return [];
    const a = pose.position(b.parent);
    const end = pose.position(i);
    const delta = new Vector3().subVectors(end, a);
    return [{ kind: 'cylinder', position: end.clone().add(a).multiplyScalar(0.5), radius: 0.035, length: delta.length(), quaternion: new Quaternion().setFromUnitVectors(UP, delta.normalize()) }];
  });
}
const UP = new Vector3(0, 1, 0);
