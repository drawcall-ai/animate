import { CylinderGeometry, Group, LatheGeometry, TorusGeometry, Vector2, type Material } from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { Parts } from '../parts';

/** A 7.50R16 military tyre on a painted steel wheel of `radius` (m): the outer face toward +X, the axle along X. */
export function roadWheel(radius: number, m: { rubber: Material; rim: Material; steel: Material }) {
  const p = new Parts(), width = 0.235, half = width / 2;
  // Bead, bulging sidewall and squared shoulders, turned about the axle.
  const section = [[0.2, -half + 0.01], [0.26, -half - 0.004], [0.33, -half - 0.01], [radius - 0.035, -half + 0.002], [radius - 0.014, -half + 0.025],
    [radius - 0.014, half - 0.025], [radius - 0.035, half - 0.002], [0.33, half + 0.01], [0.26, half + 0.004], [0.2, half - 0.01]];
  p.shape(new LatheGeometry(section.map(([r, x]) => new Vector2(r, x)), 64).rotateZ(Math.PI / 2), [0, 0, 0], m.rubber);
  // Chevron tread blocks staggered across the crown, close enough that the outline stays round.
  const blocks = 40;
  for (let i = 0; i < blocks; i++) {
    const angle = i / blocks * Math.PI * 2;
    for (const side of [-1, 1]) {
      const block = new RoundedBoxGeometry(0.09, 0.016, 0.036, 2, 0.006).rotateY(side * 0.4).translate(side * 0.052, radius - 0.008, 0);
      p.shape(block.rotateX(angle + (side > 0 ? Math.PI / blocks : 0)), [0, 0, 0], m.rubber);
    }
  }
  p.shape(new CylinderGeometry(0.205, 0.205, 0.17, 40).rotateZ(Math.PI / 2), [0, 0, 0], m.rim);
  p.shape(new TorusGeometry(0.2, 0.012, 8, 40).rotateY(Math.PI / 2), [0.085, 0, 0], m.rim);
  p.shape(new CylinderGeometry(0.15, 0.16, 0.025, 36).rotateZ(Math.PI / 2), [0.07, 0, 0], m.rim);
  p.shape(new CylinderGeometry(0.06, 0.075, 0.06, 20).rotateZ(Math.PI / 2), [0.1, 0, 0], m.rim);
  p.shape(new CylinderGeometry(0.035, 0.035, 0.03, 12).rotateZ(Math.PI / 2), [0.135, 0, 0], m.steel);
  for (let i = 0; i < 5; i++) {
    const angle = i / 5 * Math.PI * 2;
    p.pin(0.012, 0.035, [0.095, Math.sin(angle) * 0.1, Math.cos(angle) * 0.1], m.steel);
    p.pin(0.022, 0.012, [0.083, Math.sin(angle + 0.6) * 0.125, Math.cos(angle + 0.6) * 0.125], m.rim);
  }
  const wheel = new Group();
  wheel.name = 'Wheel';
  p.finish(wheel);
  return wheel;
}

/** How far the side spokes droop below level (rad), clear of the hands a little above nine and three. */
const DROOP = 0.35;

/** The steering wheel's rim: its radius to the middle of its section, and its section's (m). */
export const RIM = { radius: 0.19, thick: 0.015 };

/**
 * A three-spoke steering wheel in its XY plane, facing +Z: spokes and boss, and its rim apart (`Steering rim`, a child of the wheel), so
 * that what is held on the rim may turn round it less than the wheel, the rim being round.
 */
export function steeringWheel(m: { plastic: Material; steel: Material }) {
  const rim = new Group();
  rim.name = 'Steering rim';
  const r = new Parts();
  r.shape(new TorusGeometry(RIM.radius, RIM.thick, 12, 48), [0, 0, 0], m.plastic);
  r.finish(rim);
  const p = new Parts();
  for (const angle of [-DROOP, Math.PI + DROOP, -Math.PI / 2]) p.rod(0.009, [0, 0, -0.03], [Math.cos(angle) * 0.18, Math.sin(angle) * 0.18, 0], m.steel);
  p.shape(new CylinderGeometry(0.045, 0.05, 0.05, 20).rotateX(Math.PI / 2), [0, 0, -0.03], m.plastic);
  const wheel = new Group();
  wheel.name = 'Steering wheel';
  p.finish(wheel);
  wheel.add(rim);
  return { wheel, rim };
}
