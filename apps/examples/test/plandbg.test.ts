import { it } from 'vitest';
import { SCENARIOS } from '../src/scenarios';
import { Simulation } from '../src/scenario';
it('plan', () => {
  const sc = SCENARIOS.find((s) => s.id === (process.env.SC ?? 'vr'))!;
  const sim = new Simulation(sc);
  const a: any = sim.actors[0];
  const from = Number(process.env.FROM ?? 5), to = Number(process.env.TO ?? 7), every = Number(process.env.EVERY ?? 6);
  let i = 0;
  while (sim.t < to) {
    sim.step();
    if (sim.t < from || i++ % every) continue;
    const pl = a.plan, g = a.gait, c = a.cur;
    const f = g.feet.map((f: any) => `${f.phase[0]}(${f.anchor.x.toFixed(2)},${f.anchor.z.toFixed(2)})`).join(' ');
    const w = a.pose.rightWrist, tg = sim.lastInputs[0].rightHand?.position as any;
    console.log(`t=${sim.t.toFixed(2)} plan=(${pl[0].toFixed(2)},${pl[1].toFixed(2)},y${pl[2].toFixed(2)}) goal=(${a.goal.x.toFixed(2)},${a.goal.z.toFixed(2)},y${a.goal.yaw.toFixed(2)}) root=(${g.root.x.toFixed(2)},${g.root.z.toFixed(2)},y${g.root.yaw.toFixed(2)}) mv=${g.moving ? 1 : 0} cur:yaw${c[2].toFixed(2)} drop${c[3].toFixed(2)} sh${c[4].toFixed(2)} hip${c[5].toFixed(2)} roll${c[7].toFixed(2)} tw${c[8].toFixed(2)} side${c[9].toFixed(2)} ${f} wr=${tg ? w.distanceTo(tg).toFixed(2) : '-'} rw=${a.reach[1].value.toFixed(2)}`);
  }
});
