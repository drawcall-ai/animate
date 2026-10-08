import { MathUtils, Quaternion, Vector3 } from 'three';
import type { Prop, Scenario } from '../scenario';
import { jointOf } from '../joints';
import { quatYXZ, vec } from '../math';
import { footRotation, GRAVITY, Travel } from './ride';

const { smoothstep, degToRad } = MathUtils;

/** the slope: its fall line along +z, its pitch (rad) */
const SLOPE = degToRad(15);
/**
 * A snowboard (m): its length and width, its deck over the snow; the bindings along it and
 * their angles from square to it (rad, + = toward the nose: a duck stance, +15°/−6°), riding
 * regular (left foot forward), the body facing the board's right (toe side) like a skater.
 */
const BOARD = { length: 1.55, width: 0.25, deck: 0.03, front: { at: 0.26, angle: degToRad(15) }, back: { at: -0.26, angle: degToRad(-6) } };
/**
 * The run: carving across the fall line and back, the heading swinging this far either way
 * (rad) over this much of the way (m: one heel-side and one toe-side turn), at a steady speed
 * (m/s) once under way.
 */
const CARVE = { swing: 0.45, length: 26, speed: 7 };

/** the slope's height at `z` (m, falling downhill) */
const snow = (z: number) => -Math.tan(SLOPE) * z;

export const snowboard: Scenario = {
  id: 'snowboard',
  title: 'Snowboarding downhill',
  drives: 'the board (a mount) + both feet in their bindings',
  description:
    'The board carves down a 15° slope, across the fall line and back, heel-side and toe-side turns, on edge as the turns ask; the script moves the board and keeps the feet in their bindings (a regular duck stance). Inferred: the body sideways over the board, knees bent, hinged forward over them, leaning into each turn against the snow — up the slope on the heel-side turns, down it toe-side — standing upright to gravity rather than to the slope in between, the arms out, the head looking down the slope along the way it goes.',
  duration: 14,
  actors: [{ position: { x: 0, y: 0, z: 0 }, yaw: -Math.PI / 2 }],
  cameraDistance: 4.5,
  grid: false,
  // (the camera goes down the slope with the body)
  focus: (a) => jointOf(a[0], 'hips'),
  create() {
    const travel = new Travel();
    const frame = new Quaternion();
    const position = new Vector3();
    const at = (x: number, y: number, z: number) => vec(x, y, z).applyQuaternion(frame).add(position);
    return {
      inputs(t, dt, [{ proportions: p }]) {
        // carving: the heading swings across the fall line and back, the speed held steady once under way
        const speed = CARVE.speed * smoothstep(t, 0, 1.5) + 2 * (1 - smoothstep(t, 0, 1.5));
        const k = (2 * Math.PI) / CARVE.length;
        travel.step(speed, CARVE.swing * k * Math.cos(k * travel.s), dt);
        position.copy(travel.position).setY(snow(travel.position.z));
        // the board on the slope, on its edge into the turn: tilted with the slope where it points, rolled as far as it leans
        const along = SLOPE * Math.cos(travel.yaw);
        const across = SLOPE * Math.sin(travel.yaw);
        const edge = Math.atan((speed * speed * travel.curvature) / GRAVITY);
        quatYXZ(travel.yaw, along, -across - edge, frame);
        const feet = [BOARD.front, BOARD.back].map((b) => {
          // (across the board, facing its right; the binding's middle on the deck, the ankle over it)
          const rot = footRotation(frame, -Math.PI / 2 + b.angle, 0);
          const ankle = at(0, BOARD.deck, b.at).add(vec(0, p.ankleHeight, -0.06 * p.scale).applyQuaternion(rot));
          return { position: ankle, quaternion: rot, weight: smoothstep(t, 0, 0.5) };
        });
        return [{ mount: { position: position.clone(), quaternion: frame.clone() }, leftFoot: feet[0], rightFoot: feet[1] }];
      },
      props: () => {
        const props: Prop[] = [{ kind: 'vehicle', position: position.clone(), quaternion: frame.clone(), parts: [{ kind: 'box', center: vec(0, BOARD.deck / 2, 0), size: vec(BOARD.width, BOARD.deck, BOARD.length) }] }];
        // the slope: stripes across it every 3 m around the rider
        const tilt = quatYXZ(0, SLOPE, 0);
        const z0 = Math.round(position.z / 3) * 3;
        for (let z = z0 - 30; z <= z0 + 30; z += 3) props.push({ kind: 'box', position: vec(position.x, snow(z) - 0.01, z), size: vec(40, 0.005, 0.08), quaternion: tilt });
        for (let x = Math.round(position.x / 3) * 3 - 15; x <= position.x + 15; x += 3) props.push({ kind: 'box', position: vec(x, snow(z0) - 0.01, z0), size: vec(0.05, 0.005, 62), quaternion: tilt });
        return props;
      },
    };
  },
};
