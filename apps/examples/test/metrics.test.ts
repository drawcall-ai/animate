// Objective motion metrics per scenario. Run: pnpm --filter examples metrics [-- -t <id>]
import { it } from 'vitest';
import { Vector3 } from 'three';
import { SCENARIOS } from '../src/scenarios';
import { Simulation } from '../src/scenario';

const deg = (r: number) => (r * 180) / Math.PI;
function angle(a: Vector3, b: Vector3, c: Vector3) {
  const u = a.clone().sub(b).normalize();
  const v = c.clone().sub(b).normalize();
  return deg(Math.PI - Math.acos(Math.max(-1, Math.min(1, u.dot(v))))); // 0 = straight
}

for (const sc of SCENARIOS) {
  it(sc.id, () => {
    const sim = new Simulation(sc);
    const a0 = sim.actors[0];
    const d = a0.dims;
    const lines: string[] = [];
    const steps: { t: number; len: number; side: string }[] = [];
    const lastPhase = ['planted', 'planted'];
    const liftPos = [new Vector3(), new Vector3()];
    let maxBoneErr = 0, minFootY = 1, maxSlide = 0, maxKnee = 0, minKneeWalk = 180, hyper = 0;
    let pelMin = 9, pelMax = -9, maxHandErr = 0, maxLean = 0, elbowBad = 0, crossings = 0;
    const prevAnchor = a0.gait.feet.map((f) => f.anchor.clone());
    let frames = 0;
    let handAt = 0, headAt = 0;
    let maxComOut = 0, comAt = 0, minWidth = 9, maxHeadErr = 0, steadyMin = 9, steadyMax = -9;
    // dynamic balance (Hof's extrapolated centre of mass): XCoM = CoM + v/ω0 must stay within
    // the base of support = planted feet + where the swinging foot is landing (walking
    // balance is foot placement: the XCoM is ahead of the stance foot until the swing lands)
    const prevCom = sim.actors.map(() => null as Vector3 | null);
    const w0 = Math.sqrt(9.81 / d.legLength);
    let maxXcom = 0, xcomAt = 0, xcomFrames = 0;
    while (sim.t < sc.duration) {
      sim.step();
      frames++;
      for (const [ai, a] of sim.actors.entries()) {
        const p = a.pose;
        const bones: [keyof typeof p, keyof typeof p, number][] = [
          ['leftShoulder', 'leftElbow', d.upperArm], ['leftElbow', 'leftWrist', d.forearm],
          ['rightShoulder', 'rightElbow', d.upperArm], ['rightElbow', 'rightWrist', d.forearm],
          ['leftHip', 'leftKnee', d.thigh], ['leftKnee', 'leftAnkle', d.shin],
          ['rightHip', 'rightKnee', d.thigh], ['rightKnee', 'rightAnkle', d.shin],
        ];
        for (const [x, y, l] of bones) maxBoneErr = Math.max(maxBoneErr, Math.abs(p[x].distanceTo(p[y]) - l));
        for (const j of ['leftHeel', 'leftBigToe', 'leftSmallToe', 'rightHeel', 'rightBigToe', 'rightSmallToe'] as const) minFootY = Math.min(minFootY, p[j].y);
        for (const s of ['left', 'right'] as const) {
          const k = angle(p[`${s}Hip`], p[`${s}Knee`], p[`${s}Ankle`]);
          maxKnee = Math.max(maxKnee, k);
          // knee bending backwards: knee behind the hip-ankle line relative to foot forward
          const hip = p[`${s}Hip`], ank = p[`${s}Ankle`], knee = p[`${s}Knee`];
          const mid = hip.clone().lerp(ank, 0.5);
          const toe = p[`${s}BigToe`].clone().sub(p[`${s}Heel`]).setY(0).normalize();
          if (knee.clone().sub(mid).dot(toe) < -0.02) hyper++;
          const e = angle(p[`${s}Shoulder`], p[`${s}Elbow`], p[`${s}Wrist`]);
          void e;
        }
        {
          const com = comOf(p);
          const prev = prevCom[ai];
          prevCom[ai] = com;
          // (seated: the chair is the support)
          if (prev && !((a as unknown as { sit: number }).sit > 0)) {
            const x = com.clone().addScaledVector(com.clone().sub(prev).divideScalar(1 / 60), 1 / w0);
            const pts: [number, number][] = [];
            a.gait.feet.forEach((f, s) => {
              const side = s ? 'right' : 'left';
              if (f.phase === 'planted') for (const j of ['Heel', 'BigToe', 'SmallToe'] as const) pts.push([p[`${side}${j}`].x, p[`${side}${j}`].z]);
              else if (f.phase === 'swing') {
                const fx = Math.sin(f.toYaw), fz = Math.cos(f.toYaw);
                for (const [k, l] of [[-d.heelBack, 0], [d.toeFront, 0.04], [d.toeFront, -0.04]]) pts.push([f.to.x + fx * k + fz * l, f.to.z + fz * k - fx * l]);
              }
            });
            if (pts.length >= 3 && a.gait.feet.some((f) => f.phase === 'planted')) {
              // walking is controlled falling forward (the fore-aft margin is normally
              // negative); at speed only the sideways margin counts, standing/slow the full one
              let out: number;
              if (a.gait.walk > 0.5) {
                const lx = Math.cos(a.gait.root.yaw), lz = -Math.sin(a.gait.root.yaw);
                const ls = pts.map(([px, pz]) => px * lx + pz * lz);
                const q = x.x * lx + x.z * lz;
                out = Math.max(0, q - Math.max(...ls), Math.min(...ls) - q);
              } else out = outsideHull(pts, [x.x, x.z]);
              if (out > maxXcom) { maxXcom = out; xcomAt = sim.t; }
              if (out > 0.1) xcomFrames++;
            }
          }
        }
        // centre of mass vs support polygon (standing, both feet down)
        const planted = a.gait.feet.filter((f) => f.phase === 'planted');
        if (planted.length === 2 && a.gait.walk < 0.1) {
          const com = new Vector3()
            .addScaledVector(p.headCenter, 0.081)
            .addScaledVector(p.chest, 0.25).addScaledVector(p.spine, 0.25)
            .addScaledVector(p.leftShoulder.clone().lerp(p.leftWrist, 0.4), 0.05).addScaledVector(p.rightShoulder.clone().lerp(p.rightWrist, 0.4), 0.05)
            .addScaledVector(p.leftHip.clone().lerp(p.leftAnkle, 0.4), 0.161).addScaledVector(p.rightHip.clone().lerp(p.rightAnkle, 0.4), 0.161);
          const pts = (['left', 'right'] as const).flatMap((s) => [p[`${s}Heel`], p[`${s}BigToe`], p[`${s}SmallToe`]]).map((v) => [v.x, v.z] as [number, number]);
          const out = outsideHull(pts, [com.x, com.z]);
          if (out > maxComOut) { maxComOut = out; comAt = sim.t; }
          const l = new Vector3(Math.cos(a.gait.root.yaw), 0, -Math.sin(a.gait.root.yaw));
          const w = Math.abs(p.leftAnkle.clone().sub(p.rightAnkle).dot(l));
          minWidth = Math.min(minWidth, w);
        }
        if (ai === 0) {
          const inpH = sim.lastInputs[0]?.head;
          if (inpH?.position && (inpH.weight ?? 1) > 0.99 && p.headCenter.distanceTo(inpH.position as Vector3) > maxHeadErr) { maxHeadErr = p.headCenter.distanceTo(inpH.position as Vector3); headAt = sim.t; }
          if (a.gait.walk > 0.95 && sim.t > 4) { steadyMin = Math.min(steadyMin, p.pelvis.y); steadyMax = Math.max(steadyMax, p.pelvis.y); }
          const lean = deg(Math.acos(p.neck.clone().sub(p.pelvis).normalize().y));
          maxLean = Math.max(maxLean, lean);
          if (a.gait.walk > 0.8) {
            pelMin = Math.min(pelMin, p.pelvis.y);
            pelMax = Math.max(pelMax, p.pelvis.y);
            for (const s of ['left', 'right'] as const) minKneeWalk = Math.min(minKneeWalk, angle(p[`${s}Hip`], p[`${s}Knee`], p[`${s}Ankle`]));
          }
          const inp = sim.lastInputs[0];
          for (const s of ['left', 'right'] as const) {
            const e = inp?.[`${s}Hand`];
            if (e?.position && (e.weight ?? 1) > 0.99) {
              const dist = p[`${s}Wrist`].distanceTo(e.position as Vector3);
              // only targets within reach range (far ones are walked to first, by design)
              if (p[`${s}Shoulder`].distanceTo(e.position as Vector3) < d.armLength + 0.35 && dist > maxHandErr) { maxHandErr = dist; handAt = sim.t; }
            }
          }
          a.gait.feet.forEach((f, s) => {
            if (f.phase === 'planted' && lastPhase[s] === 'planted') maxSlide = Math.max(maxSlide, f.anchor.distanceTo(prevAnchor[s]));
            if (f.phase === 'swing' && lastPhase[s] !== 'swing') liftPos[s].copy(f.anchor);
            if (f.phase === 'planted' && lastPhase[s] === 'swing') steps.push({ t: sim.t, len: f.anchor.distanceTo(liftPos[s]), side: s ? 'R' : 'L' });
            lastPhase[s] = f.phase;
            prevAnchor[s].copy(f.anchor);
          });
          // legs crossing: left ankle right of right ankle in body frame
          const l = new Vector3(Math.cos(a.gait.root.yaw), 0, -Math.sin(a.gait.root.yaw));
          if (p.leftAnkle.clone().sub(p.rightAnkle).dot(l) < 0.02) crossings++;
        }
      }
    }
    const walkSteps = steps.filter((s) => s.len > 0.25);
    lines.push(`== ${sc.id} (${frames} frames)`);
    lines.push(`steps=${steps.length} walking-steps=${walkSteps.length} len(avg/max)=${avg(walkSteps.map((s) => s.len)).toFixed(2)}/${Math.max(0, ...steps.map((s) => s.len)).toFixed(2)} m`);
    lines.push(`step times: ${steps.map((s) => `${s.side}${s.t.toFixed(2)}(${s.len.toFixed(2)})`).join(' ')}`);
    lines.push(`walking pelvis y range: ${pelMin.toFixed(3)}..${pelMax.toFixed(3)} (bob ${(pelMax - pelMin).toFixed(3)} m), min knee flex while walking ${minKneeWalk.toFixed(0)}°`);
    lines.push(`max knee flex ${maxKnee.toFixed(0)}°, knee-backward frames ${hyper}, leg-crossing frames ${crossings}, max trunk lean ${maxLean.toFixed(0)}°`);
    lines.push(`bone err ${maxBoneErr.toExponential(1)}, min foot y ${minFootY.toFixed(3)}, planted slide ${maxSlide.toExponential(1)}, max wrist err (w=1, target within arm+0.35m) ${maxHandErr.toFixed(3)} m @${handAt.toFixed(2)}s`);
    lines.push(`COM outside support (standing) max ${maxComOut.toFixed(3)} m @${comAt.toFixed(2)}s, min standing ankle width ${minWidth.toFixed(3)} m, head target err ${maxHeadErr.toFixed(3)} m @${headAt.toFixed(2)}s, steady-walk bob ${(steadyMax - steadyMin).toFixed(3)} m`);
    lines.push(`balance: XCoM outside support max ${maxXcom.toFixed(3)} m @${xcomAt.toFixed(2)}s, frames >10 cm out: ${xcomFrames}`);
    console.log(lines.join('\n'));
  });
}
function comOf(p: Simulation['actors'][number]['pose']) {
  return new Vector3()
    .addScaledVector(p.headCenter, 0.081)
    .addScaledVector(p.chest, 0.25).addScaledVector(p.spine, 0.25)
    .addScaledVector(p.leftShoulder.clone().lerp(p.leftWrist, 0.4), 0.05).addScaledVector(p.rightShoulder.clone().lerp(p.rightWrist, 0.4), 0.05)
    .addScaledVector(p.leftHip.clone().lerp(p.leftAnkle, 0.4), 0.161).addScaledVector(p.rightHip.clone().lerp(p.rightAnkle, 0.4), 0.161);
}
function avg(a: number[]) {
  return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
}

function outsideHull(pts: [number, number][], q: [number, number]): number {
  // monotone chain hull, then distance from q to hull if outside (0 inside)
  const P = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: number[][] = [], up: number[][] = [];
  for (const p of P) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (const p of [...P].reverse()) { while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  const H = lo.slice(0, -1).concat(up.slice(0, -1));
  let inside = true, best = Infinity;
  for (let i = 0; i < H.length; i++) {
    const a = H[i], b = H[(i + 1) % H.length];
    if (cross(a, b, q) < 0) inside = false;
    const abx = b[0] - a[0], aby = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((q[0] - a[0]) * abx + (q[1] - a[1]) * aby) / (abx * abx + aby * aby || 1)));
    best = Math.min(best, Math.hypot(q[0] - a[0] - t * abx, q[1] - a[1] - t * aby));
  }
  return inside ? 0 : best;
}
