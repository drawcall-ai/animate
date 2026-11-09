import { grip } from '@drawcall/animate';
import { BoxCollider, RigidBody } from '@drawcall/physics';
import { Group, MeshStandardMaterial, Object3D } from 'three';
import { Parts, type Point } from '../parts';

/** The rungs' spacing (m): as near this as divides the climb evenly. */
const SPACING = 0.27;
/** How far each stile stands off the middle, how far the ladder stands off the wall and how far its stiles run on above the landing (m). */
export const STILE = 0.22;
/** A stile's flat bar: how thick it is across the ladder and how deep toward the wall; and a rung's radius (m). */
export const STILE_BAR = { thick: 0.012, deep: 0.065 } as const;
export const RUNG_RADIUS = 0.014;
const STANDOFF = 0.18;
export const RAIL = 1.15;

export interface Ladder {
  body: RigidBody;
  /** the landing's height above the foot (m), and how many rungs climb to it, the top one level with it, `spacing` (m) apart */
  height: number;
  rungs: number;
  spacing: number;
  /**
   * where a climber stands to get on or off, facing the way it climbs, a step clear of the ladder (its rifle too): at the foot, and on
   * the landing with its back to the ladder
   */
  marks: { foot: Object3D; top: Object3D };
}

/**
 * A fixed steel ladder up a wall to a landing `height` (m) above its foot. In its frame its rungs run along X at z = 0, rising from
 * y = 0; the wall and the landing are toward +Z, and a climber faces +Z. Its stiles run on above the landing, to hold while stepping off
 * between them.
 */
export function createLadder(height: number): Ladder {
  const rungs = Math.round(height / SPACING), spacing = height / rungs, top = height + RAIL;
  const steel = new MeshStandardMaterial({ name: 'Galvanised steel', color: '#8d969b', metalness: 0.75, roughness: 0.42 });
  const p = new Parts();
  for (const side of [-1, 1]) {
    const x = side * STILE;
    p.box([STILE_BAR.thick, top, STILE_BAR.deep], [x, top / 2, 0], steel, 0.004);
    // Brackets to the wall below the landing and to its edge, and the stile's head bent over toward the landing.
    for (const y of [0.4, height / 2, height - 0.08]) p.box([0.012, 0.05, STANDOFF], [x, y, STANDOFF / 2], steel, 0.004);
    p.rod(0.016, [x, top, 0], [x, top - 0.12, STANDOFF], steel);
  }
  for (let rung = 1; rung <= rungs; rung++) p.rod(RUNG_RADIUS, [-STILE, rung * spacing, 0], [STILE, rung * spacing, 0], steel);
  const model = new Group();
  model.name = 'Ladder';
  p.finish(model);

  const body = new RigidBody({ bodyType: 'static' });
  body.name = 'Ladder';
  body.add(model);
  const collider = (size: Point, at: Point) => {
    const box = new BoxCollider({ size });
    box.position.set(...at);
    body.add(box);
  };
  // Nothing walks through it below the landing, nor between its stiles above (they stand closer than a body is wide).
  collider([2 * STILE + 0.02, height, 0.06], [0, height / 2, 0]);
  for (const side of [-1, 1]) collider([0.02, RAIL, 0.07], [side * STILE, height + RAIL / 2, 0]);

  return {
    body, height, rungs, spacing,
    marks: { foot: grip(body, 'ladder foot', [0, 0, -1.1]), top: grip(body, 'ladder top', [0, height, STANDOFF + 0.45]) },
  };
}
