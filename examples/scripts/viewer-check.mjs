// Reproduce the two reported stories with the viewer's skinned SOLDIER and live Playback path.
// From the workspace root: pnpm exec node examples/scripts/viewer-check.mjs
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { BASE, devServer, pageError } from './examples.mjs';

const server = await devServer();
let browser;
try {
  browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage();
  const failed = pageError(page);
  await page.goto(`${BASE}?capture=1&t=0&example=stable-morning`);
  await Promise.race([page.waitForFunction(() => window.__ready, null, { timeout: 120000 }), failed]);
  const root = `/@fs${fileURLToPath(new URL('../../', import.meta.url))}`;
  const results = await page.evaluate(async (root) => {
    const { Wardrobe } = await import('/src/stage/bodies.ts');
    const { SOLDIER, HORSE } = await import('/src/skeletons/index.ts');
    const { Simulation } = await import('/src/simulation.ts');
    const { Playback } = await import('/src/playback.ts');
    const { SCENARIOS } = await import('/src/scenarios/index.ts');
    const { Actor } = await import('/test/actor.ts');
    const { Clearance } = await import('/test/clearance.ts');
    const { INDEX, SIDES } = await import(`${root}/packages/animate/src/species/humanoid/bones.ts`);
    const legBones = SIDES.flatMap((side) => ['UpperLeg', 'LowerLeg', 'Foot', 'Toes'].map((part) => INDEX[`${side}${part}`]));
    const { spinOf } = await import(`${root}/packages/animate/src/kernel/rotation.ts`);
    const { hullOf, outside, xcomOfPoses } = await import(`${root}/packages/animate/src/legs/support.ts`);
    const { solePoints } = await import(`${root}/packages/animate/src/species/humanoid/landmarks.ts`);
    const { footprint } = await import(`${root}/packages/animate/src/legs/person/foot.ts`);
    const wardrobe = await Wardrobe.load([[SOLDIER, 'models/soldier.glb'], [HORSE, 'models/horse.glb']]);
    return ['stable-morning', 'knight-arming'].map((id) => {
      const scenario = SCENARIOS.find((each) => each.id === id);
      if (!scenario) throw new Error(`missing scenario: ${id}`);
      const sim = new Simulation(scenario, { skeleton: SOLDIER, dress: wardrobe.dress, dev: true });
      const playback = new Playback(sim), actor = new Actor(sim.people[0]), clearance = new Clearance();
      const Vector3 = sim.people[0].position.constructor;
      const last = new Map();
      let ended = null, speed = 0, acceleration = 0, xcom = 0;
      while (sim.t < scenario.duration) {
        playback.step();
        if (ended === null && sim.stage.done()) ended = sim.t;
        sim.stage.scene.updateMatrixWorld(true);
        clearance.see({ t: sim.t, h: actor, solids: sim.stage.solids?.() ?? [], asked: new Map() });
        const frame = actor.insides.frame;
        for (const bone of legBones) {
          const velocity = spinOf(frame.prev2.local(bone), frame.prev.local(bone), frame.dt, new Vector3());
          speed = Math.max(speed, velocity.length() * 180 / Math.PI);
          const previous = last.get(bone);
          if (previous) acceleration = Math.max(acceleration, velocity.clone().sub(previous).length() / frame.dt * 180 / Math.PI);
          last.set(bone, velocity);
        }
        const support = (actor.insides.stepper?.legs ?? []).flatMap((leg, i) => leg.swing
          ? footprint(actor.proportions, leg.anchor, leg.yaw)
          : solePoints(actor.proportions, frame.prev, i === 0 ? 'left' : 'right').map((point) => [point.x, point.z]));
        xcom = Math.max(xcom, outside(hullOf(support), xcomOfPoses(frame.prev, frame.prev2, frame.dt, actor.proportions.legLength, new Vector3())));
        playback.blend(0.5);
        sim.stage.scene.updateMatrixWorld(true);
      }
      return { id, ended, legDegreesPerSecond: speed, legDegreesPerSecondSquared: acceleration, xcomOutsideMetres: xcom,
        clearance, logs: sim.stage.bodies.flatMap((body) => body.log) };
    });
  }, root.replace(/\/$/, ''));
  console.log(JSON.stringify(results, null, 2));
  if (results.some((result) => result.ended === null || result.logs.length)) process.exitCode = 1;
} finally {
  await Promise.all([browser?.close(), server[Symbol.asyncDispose]()]);
}
