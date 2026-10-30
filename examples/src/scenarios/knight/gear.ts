// The knight's gear: each piece a group of meshes with its mass (userData.mass, kg) and its grips (named empties), and the segments
// of it that must keep out of the body (for the metrics' clearance). Each piece's frame is described on it.
import { BufferGeometry, Group, Line, LineBasicMaterial, Object3D, Vector3, type Mesh } from 'three';
import type { Solid } from '../../scenario';
import { box, cylinder, empty } from '../../things';

/** a segment of a piece, in its frame, that keeps out of the body but its parts `touches` (and the hands holding the piece) */
interface Segment {
  name: string;
  a: Vector3;
  b: Vector3;
  radius: number;
  touches: readonly string[];
}

const SEGMENTS = new WeakMap<Object3D, readonly Segment[]>();

/** a piece of gear named `name` of `mass` (kg; its centre of mass at `centre`, its frame), keeping `segments` out of the body */
function piece(name: string, mass: number, segments: Segment[] = [], centre?: Vector3): Group {
  const group = new Group();
  group.name = name;
  group.userData.mass = mass;
  if (centre) group.userData.centre = centre.toArray();
  SEGMENTS.set(group, segments);
  return group;
}

/** `mesh` turned by Euler angles (rad) */
const turned = (mesh: Mesh, x: number, y: number, z: number) => (mesh.rotation.set(x, y, z), mesh);

/** the bascinet's radius and height (m) */
const HELM = { radius: 0.12, height: 0.22 };

/**
 * A bascinet (2.5 kg): a round-topped cap over the skull down below the ears, open at the face, a nasal before the nose; its frame the
 * head's when worn (origin at its middle, +Z where the face is). Held low on its sides, toward the front (`left`, `right`: worn, the palms by the jaw); its chin
 * strap's ends hang by the jaw (`strapLeft`, `strapRight`) and are buckled under the chin (`chinLeft`, `chinRight`). Its crown and rim
 * keep off the head (the rim may rest on the shoulders and upper arms).
 */
export function helm(): Group {
  const rim = -HELM.height / 2;
  const helm = piece('helm', 2.5, [
    { name: 'helm crown', a: new Vector3(-0.08, HELM.height / 2, 0), b: new Vector3(0.08, HELM.height / 2, 0), radius: 0.01, touches: [] },
    ...[1, -1].map((z) => ({ name: 'helm rim', a: new Vector3(-0.08, rim, z * HELM.radius), b: new Vector3(0.08, rim, z * HELM.radius), radius: 0.01, touches: ['shoulders', 'leftUpperArm', 'rightUpperArm'] })),
  ]);
  cylinder(helm, 'helm top', 0.08, 0.04, new Vector3(0, HELM.height / 2 + 0.02, -0.01));
  cylinder(helm, 'helm cap', HELM.radius, HELM.height, new Vector3());
  box(helm, 'helm nasal', new Vector3(0.02, 0.08, 0.01), new Vector3(0, rim - 0.03, HELM.radius + 0.005));
  for (const [side, x] of [['left', 1], ['right', -1]] as const) {
    empty(helm, side, new Vector3(0.13 * x, -0.15, 0.16));
    empty(helm, `strap${side === 'left' ? 'Left' : 'Right'}`, new Vector3(0.09 * x, rim - 0.2, 0.2));
    empty(helm, `chin${side === 'left' ? 'Left' : 'Right'}`, new Vector3(0.03 * x, rim - 0.22, 0.22));
  }
  return helm;
}

/** where a hand's palm is, past its wrist along the hand (m, the default body's: 0.043 of its height) */
const PALM = 0.075;

/**
 * A gauntlet (0.6 kg) for hand `side`, for a wearer `scale` times the default body's height: its frame the hand's when worn (origin at the
 * wrist). Grips: `inside`, where the palm goes in it (the hand turned as the arm brings it); `cuff`, the top of the cuff, where the other
 * hand holds it open.
 */
export function gauntlet(side: 'left' | 'right', scale: number): Group {
  const out = side === 'left' ? 1 : -1;
  const gauntlet = piece(`${side} gauntlet`, 0.6);
  box(gauntlet, 'gauntlet fingers', new Vector3(0.17, 0.045, 0.1), new Vector3(0.085 * out, -0.005, 0.005));
  turned(cylinder(gauntlet, 'gauntlet cuff', 0.055, 0.12, new Vector3(-0.05 * out, 0, 0)), 0, 0, Math.PI / 2);
  empty(gauntlet, 'inside', new Vector3(PALM * scale * out, 0, 0));
  empty(gauntlet, 'cuff', new Vector3(-0.08 * out, 0.065, 0));
  return gauntlet;
}

/** an end of the sword belt (0.2 kg): the buckle (the left hand's) or the tongue (the right's), held by `end` at its origin */
export function beltEnd(which: 'buckle' | 'tongue'): Group {
  const end = piece(which, 0.2);
  box(end, `${which} plate`, which === 'buckle' ? new Vector3(0.05, 0.055, 0.012) : new Vector3(0.06, 0.04, 0.008), new Vector3());
  empty(end, 'end', new Vector3());
  return end;
}

const SCABBARD = 0.85;
/** how far down from its throat the hands and forearms hold a scabbard (steadying it, drawing): its segments start below */
const HAND_ZONE = 0.25;

/**
 * A scabbard (0.5 kg): origin at its throat, +Y out of it, 0.85 m long down −Y, +X its outer side worn. Held by its throat (`throat`);
 * its `mouth`, where the sword's cross-guard sits sheathed, comes in from `drawn`, the sword drawn 30 cm.
 */
export function scabbard(): Group {
  const scabbard = piece('scabbard', 0.5, [{ name: 'scabbard', a: new Vector3(0, -HAND_ZONE, 0), b: new Vector3(0, -SCABBARD, 0), radius: 0.022, touches: [] }], new Vector3(0, -SCABBARD / 2, 0));
  cylinder(scabbard, 'scabbard sheath', 0.022, SCABBARD, new Vector3(0, -SCABBARD / 2, 0));
  empty(scabbard, 'throat', new Vector3(0, -0.06, 0.03));
  empty(scabbard, 'mouth', new Vector3()).userData.approach = ['drawn'];
  empty(scabbard, 'drawn', new Vector3(0, 0.3, 0));
  return scabbard;
}

/** An arming sword (1.2 kg): origin at its cross-guard, the hilt up +Y (held at `hilt`), the 0.78 m blade down −Y. */
export function sword(): Group {
  const sword = piece('sword', 1.2, [{ name: 'blade', a: new Vector3(0, -HAND_ZONE, 0), b: new Vector3(0, -0.78, 0), radius: 0.02, touches: ['leftHand', 'leftLowerArm'] }], new Vector3(0, -0.12, 0));
  box(sword, 'sword guard', new Vector3(0.2, 0.02, 0.025), new Vector3());
  cylinder(sword, 'sword grip', 0.014, 0.16, new Vector3(0, 0.1, 0));
  cylinder(sword, 'sword pommel', 0.022, 0.03, new Vector3(0, 0.19, 0));
  box(sword, 'sword blade', new Vector3(0.045, 0.78, 0.006), new Vector3(0, -0.4, 0));
  empty(sword, 'hilt', new Vector3(0, 0.09, 0));
  return sword;
}

/**
 * A heater shield (3.5 kg, 0.5 × 0.7 m): origin at the handle on its back, +X along the forearm, +Y its top, +Z out of its back (toward
 * the arm), its face 5 cm the other way. Grips: `edge` (its forward edge, from behind), `enter` (the fist before the arm strap) and
 * `handle`, the fist turned as the arm brings it. Its face keeps out of the body but the arm it is on.
 */
export function shield(): Group {
  const face = -0.05;
  const shield = piece('shield', 3.5, [-0.12, 0.03, 0.18].map((y) => ({ name: 'shield', a: new Vector3(-0.28, y, face), b: new Vector3(0.16, y, face), radius: 0.01, touches: ['leftLowerArm', 'leftHand'] })), new Vector3(-0.06, 0.04, face));
  box(shield, 'shield top', new Vector3(0.5, 0.42, 0.015), new Vector3(-0.06, 0.08, face));
  turned(box(shield, 'shield point', new Vector3(0.3, 0.26, 0.015), new Vector3(-0.15, -0.23, face)), 0, 0, 0.55);
  turned(box(shield, 'shield point', new Vector3(0.3, 0.26, 0.015), new Vector3(0.03, -0.23, face)), 0, 0, -0.55);
  box(shield, 'shield arm strap', new Vector3(0.03, 0.07, 0.012), new Vector3(-0.17, 0, 0.005));
  empty(shield, 'edge', new Vector3(0.26, 0.04, face + 0.03));
  empty(shield, 'enter', new Vector3(-0.3, 0, 0.02));
  empty(shield, 'handle', new Vector3());
  return shield;
}

/** the lance's length and its tip above its grip (m) */
const LANCE = { length: 3.6, tip: 2.45 };

/** A lance (5 kg, 3.6 m): origin at its grip (1.15 m up from its butt), +Y up the shaft. Its shaft keeps out of the body but the hand round it. */
export function lance(): Group {
  const middle = new Vector3(0, LANCE.tip - LANCE.length / 2, 0);
  const lance = piece('lance', 5, [{ name: 'lance', a: new Vector3(0, LANCE.tip - LANCE.length, 0), b: new Vector3(0, LANCE.tip, 0), radius: 0.025, touches: ['rightHand', 'rightLowerArm'] }], middle);
  cylinder(lance, 'lance shaft', 0.025, LANCE.length, middle);
  cylinder(lance, 'lance vamplate', 0.05, 0.14, new Vector3(0, 0.12, 0));
  empty(lance, 'grip', new Vector3());
  return lance;
}

/** the segments of `pieces` that keep out of the body, where they are now (world) */
export function solidsOf(pieces: readonly Object3D[]): Solid[] {
  return pieces.flatMap((thing) => (SEGMENTS.get(thing) ?? []).map((segment) => ({ ...segment, thing, a: thing.localToWorld(segment.a.clone()), b: thing.localToWorld(segment.b.clone()) })));
}

/**
 * The harness he stands in before he arms (a squire's work), ~23 kg: a cuirass and its fauld, arm and leg harness, sabatons — a
 * complete 15th-century field harness weighs 25–30 kg with its helm and gauntlets (Williams, The Knight and the Blast Furnace, 2003).
 * Each plate under its bone (the bones' frames at rest those of a T-pose, scaled by `scale`): worn, so borne.
 */
export function harness(bones: Readonly<Record<string, Object3D>>, scale: number): void {
  const plate = (bone: string, size: Vector3, at: Vector3, mass: number) => {
    box(bones[bone], `${bone} plate`, size.multiplyScalar(scale), at.multiplyScalar(scale)).userData.mass = mass;
  };
  plate('chest', new Vector3(0.35, 0.3, 0.25), new Vector3(0, 0.09, 0.01), 8);
  plate('hips', new Vector3(0.37, 0.1, 0.26), new Vector3(0, 0.035, 0.01), 3);
  for (const [side, out] of [['left', 1], ['right', -1]] as const) {
    plate(`${side}UpperArm`, new Vector3(0.26, 0.06, 0.06), new Vector3(0.16 * out, 0, 0), 1.2);
    plate(`${side}LowerArm`, new Vector3(0.2, 0.05, 0.05), new Vector3(0.13 * out, 0, 0), 0.8);
    plate(`${side}UpperLeg`, new Vector3(0.08, 0.34, 0.08), new Vector3(0, -0.21, 0), 2);
    plate(`${side}LowerLeg`, new Vector3(0.06, 0.34, 0.06), new Vector3(0, -0.21, 0), 1.5);
    plate(`${side}Foot`, new Vector3(0.1, 0.07, 0.24), new Vector3(0, -0.02, 0.07), 0.5);
  }
}

/** the belt strap's length between its ends (m): round the hips, and the overlap */
const STRAP = 1.1;
/** the half-width and half-depth of the hips where the belt goes round them (m, the default body) */
const WAIST = { width: 0.19, depth: 0.14 };

/**
 * The belt's strap drawn between its ends (a line redrawn before each render): sagging between them, or, as they come round the
 * hips (`hips`, a bone; `facing`, the way the body faces), round the back of them.
 */
export function strap(buckle: Object3D, tongue: Object3D, hips: Object3D, facing: () => number): Line {
  const points = Array.from({ length: 17 }, () => new Vector3());
  const line = new Line(new BufferGeometry().setFromPoints(points), new LineBasicMaterial({ color: 0x5a3a22 }));
  line.name = 'belt strap';
  line.frustumCulled = false;
  const from = new Vector3(), to = new Vector3(), middle = new Vector3();
  line.onBeforeRender = () => {
    buckle.getWorldPosition(from);
    tongue.getWorldPosition(to);
    hips.getWorldPosition(middle);
    const yaw = facing(), left = new Vector3(Math.cos(yaw), 0, -Math.sin(yaw)), ahead = new Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const angle = (end: Vector3) => Math.atan2(end.clone().sub(middle).dot(ahead) / WAIST.depth, end.clone().sub(middle).dot(left) / WAIST.width);
    const start = angle(from);
    let end = angle(to);
    while (end > start - 0.2) end -= 2 * Math.PI;
    // (round the hips once both ends are by them, else hanging between them)
    const off = (end: Vector3) => Math.max(Math.hypot(end.x - middle.x, end.z - middle.z) - WAIST.width, Math.abs(end.y - middle.y) - 0.1);
    const round = Math.max(off(from), off(to)) < 0.08;
    const chord = from.distanceTo(to), sag = Math.sqrt((3 * chord * Math.max(0, STRAP - chord)) / 8);
    points.forEach((point, i) => {
      const k = i / (points.length - 1);
      if (round) {
        const a = start + (end - start) * k;
        point.copy(middle).addScaledVector(left, WAIST.width * Math.cos(a)).addScaledVector(ahead, WAIST.depth * Math.sin(a)).setY(from.y + (to.y - from.y) * k);
      } else point.copy(from).lerp(to, k).y -= 4 * sag * k * (1 - k);
    });
    if (round) {
      points[0].copy(from);
      points[points.length - 1].copy(to);
    }
    line.geometry.setFromPoints(points);
  };
  return line;
}
