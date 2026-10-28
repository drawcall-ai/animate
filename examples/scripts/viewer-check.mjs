// Reproduce the two reported stories with the viewer's skinned SOLDIER and live Playback path.
// From the workspace root: pnpm viewer:check
import { chromium } from 'playwright';
import { BASE, devServer, pageError } from './examples.mjs';

const stopServer = await devServer();
let browser;
try {
  browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage();
  const failed = pageError(page);
  await page.goto(`${BASE}?video=1&body=soldier&example=stable-morning`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await Promise.race([page.waitForFunction(() => window.__ready, null, { timeout: 120000 }), failed]);
  const results = await page.evaluate(async () => {
    const { Wardrobe } = await import('/src/stage/bodies.ts');
    const { SOLDIER, HORSE } = await import('/src/skeletons/index.ts');
    const { Simulation } = await import('/src/simulation.ts');
    const { Playback } = await import('/src/playback.ts');
    const { SCENARIOS } = await import('/src/scenarios/index.ts');
    const wardrobe = await Wardrobe.load([[SOLDIER, 'models/soldier.glb'], [HORSE, 'models/horse.glb']]);
    return ['stable-morning', 'knight-arming'].map((id) => {
      const scenario = SCENARIOS.find((each) => each.id === id);
      if (!scenario) throw new Error(`missing scenario: ${id}`);
      const sim = new Simulation(scenario, { skeleton: SOLDIER, dress: wardrobe.dress, dev: true });
      const playback = new Playback(sim);
      let ended = null;
      while (sim.t < scenario.duration) {
        playback.step();
        if (ended === null && sim.stage.done()) ended = sim.t;
        sim.stage.scene.updateMatrixWorld(true);
        playback.blend(0.5);
        sim.stage.scene.updateMatrixWorld(true);
      }
      return { id, ended, logs: sim.stage.bodies.flatMap((body) => body.log) };
    });
  });
  // Exercise the real viewer's render loop as well as the checked Playback runs above.
  for (const { id } of results) {
    await page.locator(`#list button[data-id="${id}"]`).dispatchEvent('click');
    const frames = await Promise.race([page.evaluate(() => {
      if (!window.__frame) throw new Error('viewer has no video frame driver');
      for (let frame = 1; frame <= 6000; frame++) if (!window.__frame(1 / 60)) return frame;
      throw new Error('viewer did not finish within 100 seconds');
    }), failed]);
    console.log(`${id}: rendered ${frames} soldier frames`);
  }
  console.log(JSON.stringify(results, null, 2));
  if (results.some((result) => result.ended === null || result.logs.length)) process.exitCode = 1;
} finally {
  await Promise.all([browser?.close(), stopServer()]);
}
