import { Euler, Quaternion, Vector3 } from 'three';
import { Item, type BoneName, type Placement, type Proportions, type Side, type Target } from '@drawcall/animate';
import type { Prop, Solid } from '../../scenario';

// The knight's gear: each piece an item (its frame, its grips, its mass), how it is drawn (boxes
// and cylinders in its frame) and the solids that must keep out of the body.

/** a shape of an item's drawing, in its frame (a cylinder's axis along +Y turned by `turn`) */
type Part = { kind: 'box'; at: Vector3; size: Vector3; turn?: Euler } | { kind: 'cylinder'; at: Vector3; radius: number; length: number; turn?: Euler };

/** A piece of gear: its item, drawing and solids. */
export interface Gear {
  item: Item;
  parts: readonly Part[];
  /** in its frame */
  solids: readonly Solid[];
}

/** a piece of gear at `at`: its grips, mass (kg) and centre of mass (in its frame, default its origin), drawing and solids */
const piece = (at: Placement, grips: Record<string, Target>, mass: number, parts: Part[], solids: Solid[] = [], centre?: Vector3): Gear => ({
  item: new Item(at.position.clone(), at.quaternion?.clone() ?? new Quaternion(), grips, { mass, centre }),
  parts,
  solids,
});

/**
 * A bascinet (~2.5 kg): a round-topped cap over the skull down to below the ears, open at the face
 * (a nasal before the nose), its frame the head's when worn (origin at its middle, +Z where the face
 * is); held low on its sides toward the front (the wrists out before the cheeks: further back, the arms would fold past their range); its chin strap's ends at the
 * cheeks (`strapLeft`, `strapRight`), buckled under the chin (`chinLeft`, `chinRight`). Its crown
 * and rim keep off the head.
 */
export function helmet(at: Placement): Gear {
  const rim = -HELM.height / 2;
  const grips = {
    // (the hands turned as the arms bring them: a palm set flat on it turns the wrist past its range over the head)
    left: { position: new Vector3(0.13, -0.15, 0.16) },
    right: { position: new Vector3(-0.13, -0.15, 0.16) },
    // (the chin strap: its ends hanging by the jaw, buckled under the chin — the wrists below and
    // before them, the fingers up at the strap)
    strapLeft: { position: new Vector3(0.09, rim - 0.2, 0.2) },
    strapRight: { position: new Vector3(-0.09, rim - 0.2, 0.2) },
    chinLeft: { position: new Vector3(0.03, rim - 0.22, 0.22) },
    chinRight: { position: new Vector3(-0.03, rim - 0.22, 0.22) },
  };
  return piece(at, grips, 2.5, [
    { kind: 'cylinder', at: new Vector3(0, 0, 0), radius: HELM.radius, length: HELM.height },
    { kind: 'cylinder', at: new Vector3(0, HELM.height / 2 + 0.02, -0.01), radius: 0.08, length: 0.04 },
    { kind: 'box', at: new Vector3(0, rim - 0.03, HELM.radius + 0.005), size: new Vector3(0.02, 0.08, 0.01) }, // the nasal
  ], [
    { a: new Vector3(-0.08, HELM.height / 2, 0), b: new Vector3(0.08, HELM.height / 2, 0), radius: 0.01, touches: [], name: 'helm crown' },
    // (its rim at the brow and behind the head: over the shoulders, where it and its mail rest on them, it may touch the upper arms)
    ...[1, -1].map((z) => ({ a: new Vector3(-0.08, rim, z * HELM.radius), b: new Vector3(0.08, rim, z * HELM.radius), radius: 0.01, touches: ['shoulders', 'leftUpperArm', 'rightUpperArm'], name: 'helm rim' })),
  ]);
}

/** the bascinet's radius and height (m) */
const HELM = { radius: 0.12, height: 0.22 };

/**
 * A gauntlet (~0.6 kg) for hand `side`: its frame the hand's when worn (origin at the wrist,
 * fingers along +x for the left hand, −x for the right; palm −y). Grips: `inside`, where the wrist
 * ends up in it (turned as the hand is); `mouth`, the wrist before the cuff, hand in line to slide
 * in; `cuff`, the top of the cuff, where the other hand holds it open.
 */
export function gauntlet(side: Side, at: Placement): Gear {
  const s = side === 'left' ? 1 : -1;
  const level = new Quaternion();
  return piece(
    at,
    {
      inside: { position: new Vector3(), quaternion: level },
      mouth: { position: new Vector3(-0.17 * s, 0, 0), quaternion: level },
      cuff: { position: new Vector3(-0.08 * s, 0.065, 0) },
    },
    0.6,
    [
      { kind: 'box', at: new Vector3(0.085 * s, -0.005, 0.005), size: new Vector3(0.17, 0.045, 0.1) },
      { kind: 'cylinder', at: new Vector3(-0.05 * s, 0, 0), radius: 0.055, length: 0.12, turn: new Euler(0, 0, Math.PI / 2) },
    ],
  );
}

/**
 * The sword belt's two ends (~0.4 kg the belt): the buckle end (the left hand's) and the tongue end
 * (the right's), each held at its own origin by grip `end`; the strap between them is drawn
 * (`strap`). Worn, both sit on the hips.
 */
export function beltEnd(which: 'buckle' | 'tongue', at: Placement): Gear {
  const parts: Part[] =
    which === 'buckle'
      ? [{ kind: 'box', at: new Vector3(), size: new Vector3(0.05, 0.055, 0.012) }]
      : [{ kind: 'box', at: new Vector3(), size: new Vector3(0.06, 0.04, 0.008) }];
  return piece(at, { end: { position: new Vector3() } }, 0.2, parts);
}

/** the belt strap's length between its ends (m): round the hips, and the overlap */
export const STRAP = 1.1;

/**
 * A scabbard (~0.5 kg): origin at its throat, +y out of it (where the hilt comes out), 0.85 m long
 * down −y, +x its outer side worn. Held by its throat (`throat`, from outside), or, worn, grasped
 * below its locket (`below`: the left hand's from its outer side, to tilt it and present the hilt).
 * Keeps out of the body below where the hands hold it.
 */
export function scabbard(at: Placement): Gear {
  return piece(
    at,
    { throat: { position: new Vector3(0, -0.06, 0.03) }, below: { position: new Vector3(0.045, -0.05, -0.02) } },
    0.5,
    [{ kind: 'cylinder', at: new Vector3(0, -SCABBARD / 2, 0), radius: 0.022, length: SCABBARD }],
    [{ a: new Vector3(0, -HAND_ZONE, 0), b: new Vector3(0, -SCABBARD, 0), radius: 0.022, touches: [], name: 'scabbard' }],
    new Vector3(0, -SCABBARD / 2, 0),
  );
}

const SCABBARD = 0.85;
/** how far down from its throat a hand and forearm hold the scabbard (steadying it, drawing): its solid starts below */
const HAND_ZONE = 0.25;

/** An arming sword (~1.2 kg): origin at its cross-guard, the hilt up +y (held at `hilt`), the 0.78 m blade down −y. Its blade keeps out of the body below where the hands hold the scabbard, but the left hand and forearm there it is drawn past. */
export function sword(at: Placement): Gear {
  return piece(at, { hilt: { position: new Vector3(0, 0.09, 0) } }, 1.2, [
    { kind: 'box', at: new Vector3(0, 0, 0), size: new Vector3(0.2, 0.02, 0.025) },
    { kind: 'cylinder', at: new Vector3(0, 0.1, 0), radius: 0.014, length: 0.16 },
    { kind: 'cylinder', at: new Vector3(0, 0.19, 0), radius: 0.022, length: 0.03 },
    { kind: 'box', at: new Vector3(0, -0.4, 0), size: new Vector3(0.045, 0.78, 0.006) },
  ], [{ a: new Vector3(0, -HAND_ZONE, 0), b: new Vector3(0, -0.78, 0), radius: 0.02, touches: ['leftHand', 'leftLowerArm'], name: 'blade' }], new Vector3(0, -0.12, 0));
}

/**
 * A heater shield (~3.5 kg, 0.5 × 0.7 m): origin at the hand grip on its back, +x along the forearm
 * through its enarmes (the arm strap 17 cm back toward the elbow), +y its top, +z out of its back
 * (toward the arm), its face 5 cm out the other way. Grips: `edge` (its forward edge, from behind),
 * `enter` (the wrist before the strap, in line) and `grip` (the fist round the handle, thumb up).
 * Its face keeps out of the body but the arm it is on (its top edge, where the other hand holds it, left out).
 */
export function shield(at: Placement): Gear {
  const fist = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2);
  const face = -0.05;
  return piece(
    at,
    {
      edge: { position: new Vector3(0.22, 0.04, face + 0.03) },
      enter: { position: new Vector3(-0.3, 0, 0.02), quaternion: fist },
      grip: { position: new Vector3(), quaternion: fist },
    },
    3.5,
    [
      { kind: 'box', at: new Vector3(-0.06, 0.08, face), size: new Vector3(0.5, 0.42, 0.015) },
      { kind: 'box', at: new Vector3(-0.15, -0.23, face), size: new Vector3(0.3, 0.26, 0.015), turn: new Euler(0, 0, 0.55) },
      { kind: 'box', at: new Vector3(0.03, -0.23, face), size: new Vector3(0.3, 0.26, 0.015), turn: new Euler(0, 0, -0.55) },
      { kind: 'box', at: new Vector3(-0.17, 0, 0.005), size: new Vector3(0.03, 0.07, 0.012) }, // the arm strap
    ],
    [-0.12, 0.03, 0.18].map((y) => ({ a: new Vector3(-0.28, y, face), b: new Vector3(0.16, y, face), radius: 0.01, touches: ['leftLowerArm', 'leftHand'], name: 'shield' })),
    new Vector3(-0.06, 0.04, face),
  );
}

/** A lance (~5 kg, 3.6 m): origin at its grip (1.15 m up from its butt: borne upright, the butt just off the ground), +y up the shaft to its tip. Its shaft keeps out of the body but the hand round it (and the forearm's end at the wrist). */
export function lance(at: Placement): Gear {
  return piece(at, { grip: { position: new Vector3() } }, 5, [
    { kind: 'cylinder', at: new Vector3(0, LANCE.tip - LANCE.length / 2, 0), radius: 0.025, length: LANCE.length },
    { kind: 'cylinder', at: new Vector3(0, 0.12, 0), radius: 0.05, length: 0.14 }, // the vamplate
  ], [{ a: new Vector3(0, LANCE.tip - LANCE.length, 0), b: new Vector3(0, LANCE.tip, 0), radius: 0.025, touches: ['rightHand', 'rightLowerArm'], name: 'lance' }], new Vector3(0, LANCE.tip - LANCE.length / 2, 0));
}

/**
 * The harness he stands in before he arms (a squire's work: its straps are behind him): a cuirass
 * and its fauld, arm and leg harness, sabatons, ~23 kg in all — a complete 15th-century field
 * harness weighs 25–30 kg with its helm and gauntlets (Williams, The Knight and the Blast
 * Furnace, 2003; the Wallace Collection's A21 ~27 kg). Each piece on its bone (in its frame at
 * rest, the body's proportions `p`), drawn as a plate round it; none keeps out of the body (it
 * is on it).
 */
export function harness(p: Proportions): { bone: BoneName; gear: Gear }[] {
  const along = (length: number, radius: number, axis: 'x' | 'y' | '-x' | '-y', mass: number): Gear => {
    const dir = { x: new Vector3(1, 0, 0), y: new Vector3(0, 1, 0), '-x': new Vector3(-1, 0, 0), '-y': new Vector3(0, -1, 0) }[axis];
    const middle = dir.multiplyScalar(length / 2);
    const turn = axis === 'x' || axis === '-x' ? new Euler(0, 0, Math.PI / 2) : undefined;
    return piece({ position: new Vector3() }, {}, mass, [{ kind: 'cylinder', at: middle, radius, length: length * 0.8, turn }], [], middle);
  };
  const plate = (at: Vector3, size: Vector3, mass: number): Gear => piece({ position: new Vector3() }, {}, mass, [{ kind: 'box', at, size }], [], at);
  const H = p.height;
  return [
    { bone: 'chest', gear: plate(new Vector3(0, 0.05 * H, 0.005 * H), new Vector3(0.2 * H, 0.17 * H, 0.14 * H), 8) },
    { bone: 'hips', gear: plate(new Vector3(0, 0.02 * H, 0.005 * H), new Vector3(0.21 * H, 0.06 * H, 0.15 * H), 3) },
    ...(['left', 'right'] as const).flatMap((side) => {
      const out = side === 'left' ? 'x' : '-x';
      return [
        { bone: `${side}UpperArm` as const, gear: along(p.upperArm, 0.034 * H, out, 1.2) },
        { bone: `${side}LowerArm` as const, gear: along(p.forearm, 0.028 * H, out, 0.8) },
        { bone: `${side}UpperLeg` as const, gear: along(p.thigh, 0.045 * H, '-y', 2) },
        { bone: `${side}LowerLeg` as const, gear: along(p.shin, 0.035 * H, '-y', 1.5) },
        { bone: `${side}Foot` as const, gear: plate(new Vector3(0, -0.01 * H, 0.04 * H), new Vector3(0.06 * H, 0.04 * H, 0.14 * H), 0.5) },
      ];
    }),
  ];
}

/** the lance's length and its tip above the grip (m) */
export const LANCE = { length: 3.6, tip: 2.45 };

/**
 * The belt's strap drawn between its ends `buckle` and `tongue` (world): sagging between them
 * (lying out flat on `rest`'s level, `away`, while they lie there), and, as they come round the
 * hips (`hips`: the pelvis' middle at the belt's height, facing `yaw`), round the back of them.
 */
export function strap(buckle: Vector3, tongue: Vector3, hips: Vector3, yaw: number, rest: { height: number; away: Vector3 }): Prop[] {
  const N = 16;
  // (lying or hanging: a parabola as long as the strap, out flat on the table, else down)
  const chord = buckle.distanceTo(tongue);
  const depth = Math.sqrt((3 * chord * Math.max(0, STRAP - chord)) / 8);
  const lifted = smooth(0.02, 0.12, Math.min(buckle.y, tongue.y) - rest.height);
  const down = new Vector3(0, -1, 0).lerp(rest.away, 1 - lifted).normalize();
  const sag = (k: number) => buckle.clone().lerp(tongue, k).addScaledVector(down, 4 * depth * k * (1 - k));
  // (round the hips: from each end onto the ellipse, then round the back between them)
  const left = new Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  const ahead = new Vector3(Math.sin(yaw), 0, Math.cos(yaw));
  const angle = (end: Vector3) => Math.atan2(end.clone().sub(hips).dot(ahead) / WAIST.depth, end.clone().sub(hips).dot(left) / WAIST.width);
  const from = angle(buckle);
  let to = angle(tongue);
  while (to > from - 0.2) to -= 2 * Math.PI;
  const round = (k: number) => {
    const end = k < 0.5 ? buckle : tongue;
    const a = from + (to - from) * k;
    const onHips = hips.clone().addScaledVector(left, WAIST.width * Math.cos(a)).addScaledVector(ahead, WAIST.depth * Math.sin(a));
    onHips.y = buckle.y + (tongue.y - buckle.y) * k;
    // (the ends themselves where they are)
    const edge = Math.min(k, 1 - k) * N;
    return edge < 1 ? end.clone().lerp(onHips, edge) : onHips;
  };
  const near = Math.max(...[buckle, tongue].map((e) => Math.hypot(e.x - hips.x, e.z - hips.z) - Math.max(WAIST.width, WAIST.depth)));
  const high = Math.max(...[buckle, tongue].map((e) => Math.abs(e.y - hips.y)));
  const w = (1 - smooth(0.05, 0.2, near)) * (1 - smooth(0.08, 0.2, high));
  const points = Array.from({ length: N + 1 }, (_, i) => sag(i / N).lerp(round(i / N), w));
  return points.slice(1).map((b, i): Prop => {
    const a = points[i];
    const along = b.clone().sub(a);
    return { kind: 'cylinder', position: a.clone().add(b).multiplyScalar(0.5), radius: 0.01, length: along.length(), quaternion: new Quaternion().setFromUnitVectors(UP, along.normalize()) };
  });
}

/** the half-width and half-depth of the hips where the belt goes round them (m, default body) */
export const WAIST = { width: 0.19, depth: 0.14 };
const UP = new Vector3(0, 1, 0);

/** 0 below `a`, 1 above `b`, smooth between */
function smooth(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** `gear` drawn where its item is now */
export function drawn(gear: Gear): Prop[] {
  const { position, quaternion } = gear.item.current;
  return gear.parts.map((part) => {
    const at = part.at.clone().applyQuaternion(quaternion).add(position);
    const turned = quaternion.clone();
    if (part.turn) turned.multiply(new Quaternion().setFromEuler(part.turn));
    return part.kind === 'box' ? { kind: 'box', position: at, size: part.size, quaternion: turned } : { kind: 'cylinder', position: at, radius: part.radius, length: part.length, quaternion: turned };
  });
}

/** `gear`'s solids where its item is now (world) */
export function solidsOf(gear: Gear): Solid[] {
  const { position, quaternion } = gear.item.current;
  const world = (v: Vector3) => v.clone().applyQuaternion(quaternion).add(position);
  return gear.solids.map((s) => ({ ...s, a: world(s.a), b: world(s.b), item: gear.item }));
}
