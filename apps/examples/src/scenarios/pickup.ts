import { Vector3 } from 'three';
import { lerp, minimumJerk, quatYXZ, Spring3, wrapAngle, type Humanoid } from '@prohuman/core';
import type { Scenario } from '../scenario';
import { spline, v, type V3 } from '../keys';

const BOX = v(0.34, 0.26, 0.26);
const SHELF = { x: -1.3, z: 4.4, boards: [0.4, 0.95, 1.4, 1.8], width: 1.0, depth: 0.34 };

type Phase = 'idle' | 'approach' | 'lift' | 'carry' | 'place' | 'release' | 'done';

/**
 * Only wrist targets are scripted, as a state machine reacting to the body:
 * the targets jump to a box on the floor (the body walks over and squats),
 * then the box is lifted, carried to a shelf and pushed onto the top board.
 */
export const pickupShelf: Scenario = {
  id: 'pickup-shelf',
  title: 'Pick up a box, shelve it overhead',
  drives: 'left + right hand (+ a walk-to spot while carrying)',
  description:
    'Hand targets snap to a box on the floor 2.6 m away: the body walks there (arms free), squats and grasps, lifts, carries the box close to the body to a shelf (a walk-to spot is given while carrying) and places it on the top board above head height, on tiptoe.',
  duration: 17,
  actors: [{}],
  focus: (a) => a[0].pose.pelvis.clone().setY(0.9),
  create() {
    const box = v(0.35, BOX.y / 2, 2.6);
    let boxYaw = 0.35;
    let phase: Phase = 'idle';
    let t0 = 0;
    let dwell = 0;
    const from = new Vector3();
    const via = new Vector3();
    const to = new Vector3();
    let yawFrom = 0;
    let dur = 1;
    let liftPath: (t: number, out?: Vector3) => Vector3 = (_t, out = new Vector3()) => out.copy(box);
    const walkTo = new Vector3();
    const carrySpot = new Vector3();
    const carrySpring = new Spring3();
    const carryFrom = new Vector3();
    const carryTo = new Vector3();
    const left = new Vector3();
    const right = new Vector3();
    const top = SHELF.boards[3];

    const grips = () => {
      const lx = Math.cos(boxYaw) * (BOX.x / 2 + 0.015);
      const lz = -Math.sin(boxYaw) * (BOX.x / 2 + 0.015);
      left.set(box.x + lx, box.y + 0.02, box.z + lz);
      right.set(box.x - lx, box.y + 0.02, box.z - lz);
    };
    const enter = (p: Phase, t: number) => {
      phase = p;
      t0 = t;
      from.copy(box);
      yawFrom = boxYaw;
    };

    return {
      inputs(t, dt, [h]: Humanoid[]) {
        const e = (t - t0) / dur;
        switch (phase) {
          case 'idle':
            if (t > 0.8) enter('approach', t);
            break;
          case 'approach': {
            grips();
            const ok = h.pose.leftWrist.distanceTo(left) < 0.035 && h.pose.rightWrist.distanceTo(right) < 0.035;
            dwell = ok ? dwell + dt : 0;
            if (dwell > 0.25) {
              enter('lift', t);
              dur = 1.8;
              // bring it up close in front of the chest
              const f = h.gait.forward();
              to.set(h.gait.root.x + f.x * 0.36, 1.05, h.gait.root.z + f.z * 0.36);
              const via = from.clone().addScaledVector(f, 0.12).setY(0.6);
              liftPath = spline([
                [0, from.toArray() as V3],
                [0.5, via.toArray() as V3],
                [1, to.toArray() as V3],
              ]);
            }
            break;
          }
          case 'lift': {
            // one smooth arc: up in front of the knees, then in toward the chest — the body
            // gives way to the box (avoid volumes), the box never jumps out of the hands
            liftPath(minimumJerk(Math.min(1, e)), box);
            // already turning to go while the box comes up (once the body is up with it)
            if (e >= 0.8 && h.pose.pelvis.y > 0.8 && box.y > 0.9) {
              enter('carry', t);
              carrySpring.reset(box);
              carryFrom.set(h.gait.root.x, 0, h.gait.root.z);
              // stand where the box can go up onto the shelf
              carryTo.set(SHELF.x, 0, SHELF.z - 0.56);
              dur = carryFrom.distanceTo(carryTo) / 0.9 + 0.8;
            }
            break;
          }
          case 'carry': {
            // carried close in front of the body; the walk itself is expressed as a
            // "go there" root target moving toward the shelf
            const s = minimumJerk(Math.min(1, e));
            walkTo.lerpVectors(carryFrom, carryTo, s);
            const f = h.gait.forward();
            const pel = h.pose.pelvis;
            // held in front of the chest — relative to where the body stands, not to the
            // chest itself (the chest gives way to the box; chasing it would push the body
            // back); the arms damp the body's sway and turns
            const r = h.gait.root;
            carrySpot.set(r.x + f.x * 0.36, lerp(from.y, 1.1, minimumJerk(Math.min(1, e * 3))), r.z + f.z * 0.36);
            box.copy(carrySpring.step(carrySpot, 6, dt));
            boxYaw = yawFrom + wrapAngle(h.gait.root.yaw - yawFrom) * minimumJerk(Math.min(1, e * 2));
            if (e >= 1 && Math.hypot(h.gait.root.x - carryTo.x, h.gait.root.z - carryTo.z) < 0.1) {
              enter('place', t);
              via.set(SHELF.x, top + BOX.y / 2 + 0.08, SHELF.z - 0.3);
              to.set(SHELF.x, top + BOX.y / 2 + 0.005, SHELF.z - SHELF.depth / 2 + BOX.z / 2 + 0.01);
              dur = 1.8;
            }
            break;
          }
          case 'place':
            if (e < 0.6) box.lerpVectors(from, via, minimumJerk(e / 0.6));
            else box.lerpVectors(via, to, minimumJerk((e - 0.6) / 0.4));
            if (e >= 1) {
              enter('release', t);
              dur = 0.8;
            }
            break;
          case 'release':
            if (e >= 1) enter('done', t);
            break;
        }

        const obstacles = [
          { minX: SHELF.x - SHELF.width / 2, maxX: SHELF.x + SHELF.width / 2, minZ: SHELF.z - SHELF.depth / 2, maxZ: SHELF.z + SHELF.depth / 2 },
        ];
        if (phase === 'idle' || phase === 'done') return [{ obstacles }];
        grips();
        if (phase === 'release') {
          // hands open away from the box and come down, target weight fades
          // (progress of *this* phase: `e` may still belong to the phase that just ended)
          const k = minimumJerk((t - t0) / dur);
          const w = 1 - k;
          const lx = Math.cos(boxYaw) * 0.08 * k;
          const lz = -Math.sin(boxYaw) * 0.08 * k;
          left.x += lx;
          left.z += lz - 0.1 * k;
          right.x -= lx;
          right.z -= lz + 0.1 * k;
          left.y -= 0.1 * k;
          right.y -= 0.1 * k;
          return [{ leftHand: { position: left, weight: w }, rightHand: { position: right, weight: w }, obstacles }];
        }
        // walk to the shelf, then stand squarely in front of it while placing
        const facing = quatYXZ(0, 0, 0);
        const root =
          phase === 'carry'
            ? {
                position: walkTo,
                // turn toward the shelf during the approach, not after arriving
                rotation: Math.hypot(h.gait.root.x - carryTo.x, h.gait.root.z - carryTo.z) < 1.2 ? facing : undefined,
              }
            : phase === 'place'
              ? { position: carryTo, rotation: facing }
              : undefined;
        // gaze: the box while getting it, the path/shelf while carrying, the shelf top while placing
        const lookAt =
          phase === 'carry' ? v(SHELF.x, top, SHELF.z) : phase === 'place' ? v(SHELF.x, top + 0.1, SHELF.z) : box.clone();
        // the held box is a volume the body keeps clear of
        // (a box approximated by two spheres, left and right half, covers its corners)
        const lat = v(Math.cos(boxYaw), 0, -Math.sin(boxYaw)).multiplyScalar(BOX.x / 4);
        const avoid =
          phase === 'approach'
            ? []
            : [
                { center: box.clone().add(lat), radius: 0.15 },
                { center: box.clone().sub(lat), radius: 0.15 },
              ];
        return [{ leftHand: { position: left }, rightHand: { position: right }, obstacles, root, lookAt, avoid }];
      },
      props: () => [
        { kind: 'box', position: box, size: BOX, yaw: boxYaw },
        { kind: 'shelf', position: v(SHELF.x, 0, SHELF.z), size: v(SHELF.width, top, SHELF.depth) },
      ],
    };
  },
};

export const SHELF_BOARDS = SHELF.boards;
