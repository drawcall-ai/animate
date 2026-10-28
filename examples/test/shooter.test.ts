import { Euler, Group, PerspectiveCamera, Quaternion, Vector3, type Object3D } from 'three';
import { expect } from 'vitest';
import { carry, grab, release, wait, type LogEntry, type Root } from '@drawcall/animate';
import { shooter } from '../src/scenarios/shooter';
import { Simulation } from '../src/simulation';
import { Playback } from '../src/playback';
import { FIXED_DT, type Person, type Player, type Scenario, type Stage } from '../src/scenario';
import { box, empty } from '../src/things';
import { PlayerCamera } from '../src/stage/camera';
import { OUTLIER, SOLDIER, type PersonSkeleton } from '../src/skeletons';
import { seeded } from '../scripts/run';
import { solePoints } from '../../packages/animate/src/species/humanoid/landmarks';
import { INDEX } from '../../packages/animate/src/species/humanoid/bones';
import { Actor, wrapAngle } from './actor';
import { cases } from '../../packages/animate/test/open';

const BODIES: readonly [on: string, skeleton: PersonSkeleton | undefined][] = [['', undefined], [' on the soldier', SOLDIER], [' on the outlier', OUTLIER]];
const BODY_NAMES = BODIES.map(([on]) => on);

// The shooter on every body: the default and the skeletons unlike it — the rifle, its grips, the reload and the dev log hold for any
// body. The cases that do not hold yet are listed (expected to fail: each one fixed comes off the list), each with what fails, at seed 0:
// - the default body's variation #2 still has its right foot at 95 205°/s² (limit 83 333) at 23.65 s;
// - the soldier at a sprint and sprinting off: its knees fold at up to 96 000°/s² (19.53 s and on, the check's 83 333), its stride read
//   as 1.14 m (2× its legs is 1.92: a foot leaving the floor twice a stance) — the stepper's, not the arms'; its jumps' landings fold
//   them at 91 000°/s² (44.98 s); its short arms hold the rifle at the hip just below the first-person view (the receiver at −1.013 of
//   the half-height, varied #1) and sprinting 0.197 m below the eye (#2; 0.2 at least);
// - the outlier's knees, sprinting off and landing a jump: 95 600°/s² (21.20 s), 95 500 (44.52 s), 94 600 (30.77 s).
const test = cases([
  'keeps both grips, steady sights and final-pose checks clean #2',
  ...BODY_NAMES.filter(Boolean).flatMap((on) => [0, 1, 2].map((seed) => `keeps both grips, steady sights and final-pose checks clean${on} #${seed}`)),
  ...BODY_NAMES.filter(Boolean).map((on) => `reloads while walking: magazine out, stowed, the full one in, back on the handguard, every grip kept${on}`),
  ...[' on the soldier', ' on the outlier'].flatMap((on) => [
    `ADS overrides held sprint and keeps both grips during the raise${on}`,
    `jumps from a walk and a sprint: quick take-off, a ballistic arc, momentum kept, the knees taking the landing${on}`,
    `sprinting cancels a reload before the magazine is out, and the hand goes back to the handguard${on}`,
  ]),
  'sprints with the rifle, the trunk turning with the stride, both hands on their grips on the soldier',
]);

/** a run of the shooter on `skeleton`, development checks on, its people varied by `seed` (none: as written) */
function staged(skeleton?: PersonSkeleton, seed?: number) {
  const sim = new Simulation(shooter(), { dev: true, skeleton, vary: seed ? seeded(seed) : undefined });
  const person = sim.people[0], actor = new Actor(person), player = sim.stage.player!;
  const rifle = person.object.getObjectByName('rifle')!;
  return { sim, person, actor, player, rifle };
}

/** what `actor`'s hands hold, by side: the thing and the grip's name */
const held = (actor: Actor, side: 'left' | 'right') => actor.insides.holding[side];
/** the worst distance (m) of either wrist from the grip it holds */
const gripError = (actor: Actor) => Math.max(0, ...(['left', 'right'] as const).map((side) => {
  const hold = actor.holding[side];
  return hold ? actor.joint(`${side}Hand`).distanceTo(hold.grip) : 0;
}));
/** `node`'s point `local` (its frame) in the world */
const pointOn = (node: Object3D, local: Vector3) => node.localToWorld(local.clone());
/** the way a look points */
const lookDirection = ({ yaw, pitch }: { yaw: number; pitch: number }) => new Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
/** the look's turn */
const lookTurn = ({ yaw, pitch }: { yaw: number; pitch: number }) => new Quaternion().setFromEuler(new Euler(-pitch, yaw, 0, 'YXZ'));
/** the rifle's sight (its frame, m) */
const SIGHT = new Vector3(0, 0.12, 0);
/** a dev log's first entries, readable */
const logged = (log: readonly LogEntry[]) => log.slice(0, 4).map((entry) => `${entry.check} ${entry.where} ${entry.value.toFixed(3)} (limit ${entry.limit}) @${entry.time.toFixed(2)}`);
/** the player's keys and buttons all let go (the look where it is) */
const idle = (player: Player) => Object.assign(player.input, { move: { x: 0, z: 0 }, ads: false, sprint: false, fire: false, crouch: false, jump: false, reload: false });

for (const [on, skeleton] of BODIES) {
  for (const seed of [0, 1, 2]) test(`keeps both grips, steady sights and final-pose checks clean${on} #${seed}`, () => {
    const { sim, person, actor, player, rifle } = staged(skeleton, seed);
    const input = player.input, camera = new PerspectiveCamera(90, 16 / 9, 0.02, 1000), framing = new PlayerCamera();
    let grip = 0, sight = 0, sightLine = 0, acquired = Infinity, walking = 0, low = Infinity, raised = Infinity, facing = 0, heading = 0;
    let steady = 0, lastYaw = 0, lastPitch = 0, lastAds = false, lastFire = 0, sightFrames = 0, hipFrames = 0, flight = 0, moved = 0, lastMove = '';
    const landings: { time: number; z: number }[] = [];
    let planted = true;
    while (sim.t < sim.scenario.duration) {
      sim.step();
      if (input.aimYaw !== lastYaw || input.aimPitch !== lastPitch || input.ads !== lastAds) steady = sim.t;
      if (input.fire) lastFire = sim.t;
      [lastYaw, lastPitch, lastAds] = [input.aimYaw, input.aimPitch, input.ads];
      const keys = `${input.move.x},${input.move.z},${input.sprint},${input.ads}`;
      if (keys !== lastMove) [moved, lastMove] = [sim.t, keys];
      const speed = actor.locomotion.velocity.length();
      // (once the speed has settled after a change of keys: 10 m/s² takes at most 0.5 s)
      if (speed > 0.5 && sim.t - moved > 0.5) {
        facing = Math.max(facing, Math.abs(wrapAngle(person.facing - input.aimYaw)));
        const asked = Math.atan2(input.move.x, input.move.z), going = Math.atan2(actor.locomotion.velocity.x, actor.locomotion.velocity.z) - input.aimYaw;
        if (input.move.x || input.move.z) heading = Math.max(heading, Math.abs(wrapAngle(going - asked)));
      }
      if (held(actor, 'right')?.thing.object !== rifle) continue;
      if (acquired === Infinity && held(actor, 'left')?.thing.object !== rifle) continue;
      acquired = Math.min(acquired, sim.t);
      expect(held(actor, 'right')?.grip).toBe('pistol');
      grip = Math.max(grip, gripError(actor));
      sim.stage.scene.updateMatrixWorld(true);
      const look = player.look(), wanted = lookDirection(look), muzzle = new Vector3(0, 0, 1).applyQuaternion(rifle.getWorldQuaternion(new Quaternion()));
      const aimedSteady = input.ads && sim.t - steady > 0.5 && sim.t - lastFire > 0.5;
      if (aimedSteady) {
        sight = Math.max(sight, muzzle.angleTo(wanted));
        if (person.gait.walk < 0.01) {
          const offset = pointOn(rifle, SIGHT).sub(look.eye);
          sightLine = Math.max(sightLine, offset.addScaledVector(wanted, -offset.dot(wanted)).length());
        }
        sightFrames++;
      }
      framing.apply(camera, look, input.ads, 'first', FIXED_DT);
      camera.updateMatrixWorld();
      if (input.ads && sim.t > 13 && sim.t < 14) {
        const offset = pointOn(rifle, SIGHT).sub(look.eye);
        if (offset.addScaledVector(wanted, -offset.dot(wanted)).length() <= 0.01 && muzzle.angleTo(wanted) < 2 * Math.PI / 180) raised = Math.min(raised, sim.t - 13);
      }
      if (aimedSteady && person.gait.walk < 0.01) {
        const shown = pointOn(rifle, SIGHT).project(camera);
        expect(Math.hypot(shown.x, shown.y)).toBeLessThan(0.035);
      }
      // (at the hip, the rifle in the lower right of the view)
      if (!input.ads && !input.sprint && sim.t - steady > 0.5 && sim.t < 13) {
        const shown = pointOn(rifle, new Vector3(0, 0.06, 0.12)).project(camera);
        expect(shown.x).toBeGreaterThan(0);
        expect(shown.x).toBeLessThan(1);
        expect(shown.y).toBeLessThan(0);
        expect(shown.y).toBeGreaterThan(-1);
        hipFrames++;
      }
      // (on the floor: pushing off on the ball — not a sole point — the toe tips stand up to ~8 mm off it)
      const contacts = (['left', 'right'] as const).map((side) => Math.min(...solePoints(actor.proportions, person.pose, side).map((point) => point.y)) <= 0.01);
      if (sim.t > 20 && sim.t < 23) {
        if (contacts.every((contact) => !contact)) flight++;
        if (contacts[0] && !planted) landings.push({ time: sim.t, z: actor.joint('leftFoot').z });
        // (sprinting, the rifle low across the chest)
        expect(look.eye.y - rifle.getWorldPosition(new Vector3()).y).toBeGreaterThan(0.2);
      }
      planted = contacts[0];
      if (speed > 0.5 && speed < 1.5 && sim.t < 16) {
        walking++;
        // (walking upright: steady walking, not the moment of a reversal)
        if (sim.t - moved > 0.5) low = Math.min(low, actor.joint('hips').y / actor.proportions.hipHeight);
      }
    }
    expect(landings.length).toBeGreaterThan(2);
    const first = landings[0], last = landings[landings.length - 1];
    const stride = (last.z - first.z) / (landings.length - 1), cadence = 120 * (landings.length - 1) / (last.time - first.time);
    // (the facing eases toward the look over 25 ms; turning harder than the feet can follow, the trunk takes the rest)
    expect(facing).toBeLessThan(0.1);
    expect(heading).toBeLessThan(0.15);
    expect(raised).toBeLessThanOrEqual(0.3);
    expect(cadence).toBeGreaterThan(150);
    // (a stride as long as the legs: the default's 2 m × its legs over the default's)
    expect(stride).toBeGreaterThan(2 * actor.proportions.legs);
    expect(hipFrames).toBeGreaterThan(120);
    expect(flight).toBeGreaterThan(0);
    expect(acquired).toBeLessThan(3);
    expect(grip).toBeLessThanOrEqual(0.01);
    expect(sight).toBeLessThanOrEqual(2 * Math.PI / 180);
    expect(sightLine).toBeLessThanOrEqual(0.01);
    expect(sightFrames).toBeGreaterThan(120);
    expect(walking).toBeGreaterThan(300);
    expect(low).toBeGreaterThan(0.9);
    expect(logged(person.log)).toEqual([]);
    expect(sim.stage.done()).toBe(true);
  }, 60000);

  test(`keeps the rifle on the aim through fast turns: standing and walking, at the hip and aiming${on}`, () => {
    const { sim, person, actor, player, rifle } = staged(skeleton);
    sim.advanceTo(2.5);
    player.live = true;
    idle(player);
    // (the rifle's turn in the look's frame: steady, as the aim has it, however the look turns)
    const relative = () => lookTurn(player.look()).invert().multiply(rifle.getWorldQuaternion(new Quaternion()));
    const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * x * (10 - 15 * x + 6 * x * x));
    for (const [name, move, ads] of [['hip', 0, false], ['aiming', 0, true], ['hip walking', 1, false]] as const) {
      Object.assign(player.input, { ads, move: { x: 0, z: move } });
      sim.advanceTo(sim.t + 1);
      const steady = relative(), from = sim.t;
      let angle = 0, grip = 0;
      // (6 rad/s mouse sweeps, 86° one way, 172° back and 86° again, each reversal within 0.1 s)
      while (sim.t < from + 1.2) {
        const u = sim.t - from, at = (t: number) => ease((u - t + 0.05) / 0.1);
        player.input.aimYaw += (6 / 60) * (at(0) - 2 * at(0.25) + 2 * at(0.75) - at(1));
        sim.step();
        angle = Math.max(angle, relative().angleTo(steady));
        grip = Math.max(grip, gripError(actor));
      }
      expect(angle * 180 / Math.PI, name).toBeLessThanOrEqual(ads ? 2 : 5);
      expect(grip, name).toBeLessThanOrEqual(0.01);
    }
    // (the arms move with it within their joints' pace; the feet, spinning this fast, may not — the legs are the stepper's)
    expect(logged(person.log.filter((entry) => /Arm|Hand|Shoulder/.test(entry.where)))).toEqual([]);
  });

  // (the mouse moves the look between steps, at the display's rate: the camera shows the look the rifle was placed in, blended as the
  // rifle is — the rifle never trails the view)
  for (const [name, walk] of [['standing', 0], ['walking', 1]] as const) test(`shows the rifle steady in the first-person view through fast turns aiming, ${name}${on}`, () => {
    const playback = new Playback(staged(skeleton).sim);
    playback.advanceTo(2.5);
    const player = playback.sim.stage.player!, rifle = playback.sim.people[0].object.getObjectByName('rifle')!;
    player.live = true;
    idle(player);
    Object.assign(player.input, { move: { x: 0, z: walk }, ads: true });
    const camera = new PerspectiveCamera(90, 16 / 9, 0.02, 1000), view = new PlayerCamera(), dt = 1 / 144;
    let steady: Quaternion | null = null, angle = 0, sight = 0, behind = 0;
    // (3 rad/s sweeps, reversing every 0.6 s, after 1.5 s aiming; shown at 144 Hz)
    for (let t = 0; t < 3; t += dt) {
      if (t > 1.5) player.input.aimYaw += (3 / 144) * Math.sign(Math.sin(((t - 1.5) * Math.PI) / 0.6));
      for (behind += dt; behind >= FIXED_DT; behind -= FIXED_DT) playback.step();
      const { look } = playback.blend(behind / FIXED_DT);
      view.apply(camera, look!, true, 'first', dt);
      camera.updateMatrixWorld();
      playback.sim.stage.scene.updateMatrixWorld(true);
      const relative = camera.quaternion.clone().invert().multiply(rifle.getWorldQuaternion(new Quaternion()));
      if (t < 1.5) {
        steady = relative;
        continue;
      }
      angle = Math.max(angle, relative.angleTo(steady!));
      const shown = pointOn(rifle, SIGHT).project(camera);
      sight = Math.max(sight, Math.hypot(shown.x, shown.y));
    }
    expect(angle * 180 / Math.PI).toBeLessThan(0.05);
    expect(sight).toBeLessThan(0.002);
  });

  test(`keeps the head level while aiming, including walking, firing and fast turns${on}`, () => {
    const { sim, actor, player } = staged(skeleton);
    let roll = 0, aimed = 0;
    while (sim.t < sim.scenario.duration) {
      sim.step();
      if (!player.input.ads) continue;
      const eyes = actor.joint('leftEye').sub(actor.joint('rightEye'));
      roll = Math.max(roll, Math.abs(Math.atan2(eyes.y, Math.hypot(eyes.x, eyes.z))));
      aimed++;
    }
    expect(aimed).toBeGreaterThan(600);
    // The aim asks for a level look; judge every aimed frame, independently of gait stride selection.
    expect(roll * 180 / Math.PI).toBeLessThanOrEqual(2);
  });

  // (standing at ease the rifle breathes with the body; the sights up, it is held still in the aim and the body's breathing fades)
  test(`stands alive at ease and holds still aiming${on}`, () => {
    const { sim, person, player, rifle } = staged(skeleton);
    sim.advanceTo(2.5);
    player.live = true;
    idle(player);
    const range = () => ({ low: new Vector3(Infinity, Infinity, Infinity), high: new Vector3(-Infinity, -Infinity, -Infinity), roll: [Infinity, -Infinity], breath: [Infinity, -Infinity] });
    const [easy, aimed] = [range(), range()];
    while (sim.t < 22) {
      player.input.ads = sim.t > 16;
      sim.step();
      const span = sim.t > 4 && sim.t < 16 ? easy : sim.t > 17 ? aimed : null;
      if (!span) continue;
      const look = player.look(), back = lookTurn(look).invert();
      const at = rifle.getWorldPosition(new Vector3()).sub(look.eye).applyQuaternion(back);
      span.low.min(at);
      span.high.max(at);
      const roll = new Euler().setFromQuaternion(back.multiply(rifle.getWorldQuaternion(new Quaternion())), 'YXZ').z;
      span.roll = [Math.min(span.roll[0], roll), Math.max(span.roll[1], roll)];
      const breath = 2 * Math.asin(person.pose.local(INDEX.chest).x);
      span.breath = [Math.min(span.breath[0], breath), Math.max(span.breath[1], breath)];
    }
    const spread = (span: ReturnType<typeof range>) => ({ moved: span.high.clone().sub(span.low).length(), roll: span.roll[1] - span.roll[0], breath: span.breath[1] - span.breath[0] });
    const [atEase, aiming] = [spread(easy), spread(aimed)];
    expect(atEase.moved).toBeGreaterThan(0.005);
    expect(atEase.roll).toBeGreaterThan(0.03);
    expect(aiming.moved).toBeLessThan(1e-3);
    expect(aiming.roll).toBeLessThan(1e-3);
    expect(aiming.breath).toBeLessThan(0.5 * atEase.breath);
    expect(logged(person.log)).toEqual([]);
  });

  // (a sprint with the rifle in both hands: no arm swings, so the trunk turns further with the stride than a free runner's — read, Arellano
  // & Kram 2014: arms held across the chest the pelvis turns 102% further, the shoulders 44%; Pontzer et al. 2009: arms folded, the shoulders
  // 50% further; snippet, Seay et al. 2011: soldiers running with a rifle turn the trunk further — from a free runner's ~14° pelvis and
  // ~20° thorax peak to peak; the grips held throughout)
  test(`sprints with the rifle, the trunk turning with the stride, both hands on their grips${on}`, () => {
    const { sim, person, actor } = staged(skeleton);
    const pelvis: number[] = [], shoulders: number[] = [];
    let grip = 0;
    while (sim.t < 23) {
      sim.step();
      if (sim.t < 20.5) continue;
      const facing = person.facing, forward = new Vector3(Math.sin(facing), 0, Math.cos(facing)), left = new Vector3(Math.cos(facing), 0, -Math.sin(facing));
      const across = (leftJoint: string, rightJoint: string) => {
        const line = actor.joint(leftJoint).sub(actor.joint(rightJoint));
        return Math.atan2(line.dot(forward), line.dot(left)) * 180 / Math.PI;
      };
      pelvis.push(across('leftUpperLeg', 'rightUpperLeg'));
      shoulders.push(across('leftUpperArm', 'rightUpperArm'));
      grip = Math.max(grip, gripError(actor));
    }
    const range = (values: number[]) => Math.max(...values) - Math.min(...values);
    expect(person.gait.run).toBe(1);
    expect(range(pelvis)).toBeGreaterThanOrEqual(18);
    expect(range(pelvis)).toBeLessThanOrEqual(30);
    expect(range(shoulders)).toBeGreaterThanOrEqual(20);
    expect(range(shoulders)).toBeLessThanOrEqual(32);
    expect(grip).toBeLessThanOrEqual(0.01);
    expect(logged(person.log)).toEqual([]);
  });

  test(`takes the foregrip while the player keeps turning${on}`, () => {
    const { sim, actor, player } = staged(skeleton);
    sim.advanceTo(0.5);
    player.live = true;
    // (turning 3 rad/s, back and forth, through the reach for the foregrip)
    while (sim.t < 6) {
      player.input.aimYaw += (3 / 60) * Math.sign(Math.sin(sim.t * 1.3));
      sim.step();
    }
    expect(held(actor, 'left')?.grip).toBe('foregrip');
    expect(gripError(actor)).toBeLessThanOrEqual(0.01);
  });

  test(`ADS overrides held sprint and keeps both grips during the raise${on}`, () => {
    const { sim, person, actor, player, rifle } = staged(skeleton);
    sim.advanceTo(21);
    player.live = true;
    Object.assign(player.input, { ads: true, sprint: true, move: { x: 0, z: 1 }, aimYaw: 0.3, aimPitch: 0.15 });
    const camera = new PerspectiveCamera(90, 16 / 9, 0.02, 1000), framing = new PlayerCamera();
    while (sim.t < 24) {
      sim.step();
      framing.apply(camera, player.look(), true, 'first', FIXED_DT);
      camera.updateMatrixWorld();
      if (sim.t > 23) {
        const shown = pointOn(rifle, SIGHT).project(camera);
        expect(Math.hypot(shown.x, shown.y)).toBeLessThanOrEqual(0.035);
      }
      expect(held(actor, 'left')?.grip).toBe('foregrip');
      expect(gripError(actor)).toBeLessThanOrEqual(0.01);
    }
    expect(actor.locomotion.velocity.length()).toBeLessThanOrEqual(0.91);
    expect(person.gait.run).toBe(0);
    expect(logged(person.log.filter((entry) => entry.time > 21))).toEqual([]);
  });

  /** The demo, sampled each frame. */
  const demo = () => {
    const { sim, person, actor, player } = staged(skeleton);
    const frames: { t: number; jump: boolean; reload: boolean; crouch: boolean; airborne: boolean; speed: number; pelvis: number; soles: number[]; reloading: boolean; held: number }[] = [];
    while (sim.t < sim.scenario.duration) {
      sim.step();
      const { input } = player;
      frames.push({ t: sim.t, jump: input.jump, reload: input.reload, crouch: input.crouch, airborne: person.airborne, speed: actor.locomotion.velocity.length(),
        pelvis: actor.joint('hips').y, soles: (['left', 'right'] as const).map((side) => Math.min(...solePoints(actor.proportions, person.pose, side).map((point) => point.y))),
        reloading: player.status!().reloading, held: gripError(actor) });
    }
    return { sim, person, actor, frames, steps: player.status!().steps };
  };
  // (run once, by the first test that reads it)
  let demoRun: ReturnType<typeof demo> | undefined;
  const recorded = () => (demoRun ??= demo());

  test(`crouches smoothly, deep and slow${on}`, () => {
    const { frames, actor } = recorded();
    const standing = frames.find((frame) => frame.t > 2)!.pelvis;
    // (crouched a while: the legs ease the crouch in)
    const deep = frames.filter((frame, i) => frame.crouch && frames[i - 30]?.crouch);
    const walking = deep.filter((frame) => frame.speed > 0.1);
    const depth = standing - Math.max(...deep.filter((frame) => frame.speed < 0.01).map((frame) => frame.pelvis));
    // (the pelvis' acceleration getting down and up again, standing and crouch-walking: a 0.25 s minimum-jerk crouch peaks at
    // 5.77 × 0.37 m / 0.25² s ≈ 34 m/s², the steps' own less)
    let jerk = 0;
    for (let i = 2; i < frames.length; i++) if (frames[i].t > 35 && frames[i].t < 41) jerk = Math.max(jerk, Math.abs(frames[i].pelvis - 2 * frames[i - 1].pelvis + frames[i - 2].pelvis) * 3600);
    // (as deep as the legs go: the default's 0.33–0.42 m × its legs over the default's)
    const legs = actor.proportions.legs;
    expect(depth).toBeGreaterThan(0.33 * legs);
    expect(depth).toBeLessThan(0.42 * legs);
    expect(Math.max(...walking.map((frame) => frame.speed))).toBeLessThanOrEqual(0.8 + 0.05);
    expect(walking.length).toBeGreaterThan(60);
    expect(jerk).toBeLessThan(36);
  });

  test(`jumps from a walk and a sprint: quick take-off, a ballistic arc, momentum kept, the knees taking the landing${on}`, () => {
    const { frames, person } = recorded();
    const presses = frames.filter((frame, i) => frame.jump && !frames[i - 1].jump);
    expect(presses.length).toBe(2);
    for (const press of presses) {
      const from = frames.indexOf(press), height = frames[from - 1].pelvis;
      const off = frames.findIndex((frame, i) => i >= from && frame.airborne);
      const down = frames.findIndex((frame, i) => i > off && !frame.airborne);
      const after = frames.slice(down, down + 60);
      const latency = frames[off].t - press.t + FIXED_DT, airtime = frames[down].t - frames[off].t;
      const apex = Math.max(...frames.slice(off, down).map((frame) => frame.pelvis)) - height;
      const absorb = Math.min(...after.map((frame) => frame.pelvis)) - height;
      // (up again: within the steps' own bob of where it was)
      const recovered = after.findIndex((frame, i) => i > 5 && Math.abs(frame.pelvis - height) < 0.03) / 60;
      const fall = (frames[down - 2].pelvis - frames[down - 1].pelvis) * 60;
      // (the feet's sole speed as each first meets the floor: the feet come down with the falling body, slower than it, and the knees
      // take it up after)
      const touchdown = [0, 1].map((side) => {
        const i = frames.findIndex((frame, j) => j > off && frame.soles[side] <= 0.005);
        return (frames[i - 1].soles[side] - frames[i].soles[side]) * 60;
      });
      expect(latency).toBeLessThanOrEqual(0.12);
      expect(airtime).toBeGreaterThan(0.4);
      expect(airtime).toBeLessThan(0.6);
      expect(apex).toBeGreaterThan(0.25);
      expect(absorb).toBeLessThan(-0.04);
      expect(absorb).toBeGreaterThan(-0.25);
      expect(recovered).toBeGreaterThan(0);
      expect(recovered).toBeLessThanOrEqual(0.6);
      expect(Math.max(...touchdown)).toBeLessThan(fall);
      // (in the air the keys only steer a little: the speed taken off with is kept)
      expect(frames[down].speed).toBeGreaterThan(press.speed - 2 * airtime - 0.05);
    }
    expect(presses[1].speed).toBeGreaterThan(3);
    // (slides, touchdown speeds and knee snaps are each checked in the code: nothing from a second before the first jump to a second
    // after the last landing)
    const [from, to] = [presses[0].t - 1, frames.filter((frame) => frame.airborne).at(-1)!.t + 1];
    expect(logged(person.log.filter((entry) => entry.time > from && entry.time < to))).toEqual([]);
  });

  // (the pouches ride on the vest and the well on the rifle the body holds: bowing would carry them away as far, so the arm alone reaches
  // them and the trunk stays upright)
  test(`reloads standing upright: the magazine out, stowed, the full one in, the trunk within 3° of upright${on}`, () => {
    const { sim, person, actor, player } = staged(skeleton);
    player.live = true;
    let most = 0;
    while (sim.t < 7) {
      player.input.reload = sim.t > 3 && sim.t < 3.1;
      sim.step();
      if (sim.t < 3) continue;
      const up = actor.joint('neck').sub(actor.joint('hips'));
      most = Math.max(most, Math.atan2(Math.hypot(up.x, up.z), up.y));
    }
    expect(player.status!().steps).toEqual(['to magazine', 'stow', 'to pouch', 'insert', 'handguard']);
    expect(player.status!().reloading).toBe(false);
    expect(most * 180 / Math.PI).toBeLessThan(3);
    expect(logged(person.log)).toEqual([]);
  });

  test(`reloads while walking: magazine out, stowed, the full one in, back on the handguard, every grip kept${on}`, () => {
    const { frames, steps, person } = recorded();
    expect(steps).toEqual(['to magazine', 'stow', 'to pouch', 'insert', 'handguard']);
    const press = frames.find((frame) => frame.reload)!;
    const begun = frames.find((frame) => frame.reloading)!, ended = frames.find((frame) => frame.t > begun.t && !frame.reloading)!;
    expect(begun.t - press.t).toBeLessThan(0.05);
    expect(ended.t - begun.t).toBeGreaterThan(1.8);
    expect(ended.t - begun.t).toBeLessThan(2.8);
    // (walking on throughout)
    expect(frames.filter((frame) => frame.reloading).every((frame) => frame.speed > 1)).toBe(true);
    expect(Math.max(...frames.map((frame) => frame.held))).toBeLessThanOrEqual(0.01);
    expect(logged(person.log)).toEqual([]);
  });

  test(`sprinting cancels a reload before the magazine is out, and the hand goes back to the handguard${on}`, () => {
    const { sim, person, actor, player } = staged(skeleton);
    sim.advanceTo(30);
    player.live = true;
    idle(player);
    Object.assign(player.input, { move: { x: 0, z: 1 }, reload: true });
    sim.advanceTo(30.1);
    Object.assign(player.input, { reload: false, sprint: true });
    sim.advanceTo(32);
    expect(player.status!().steps).toEqual(['to magazine', 'cancelled']);
    expect(held(actor, 'left')?.grip).toBe('foregrip');
    expect(person.gait.run).toBeGreaterThan(0.5);
    expect(logged(person.log.filter((entry) => entry.time > 30))).toEqual([]);
  });
}

// The library's part of what the shooter shows, each as small as it goes.

/** one person playing `story` (made once it stands) for `duration` s, development checks on; `each` reads it after every frame */
function play(duration: number, story: (person: Person) => Stage['story'], drive?: (time: number) => Root, each?: (time: number, actor: Actor) => void) {
  const scenario: Scenario = {
    id: 'small', title: 'small', duration,
    stage: (cast) => {
      const person = cast.person({ drive });
      return { scene: new Group(), bodies: [person], story: story(person), done: () => true };
    },
  };
  const sim = new Simulation(scenario, { dev: true });
  const actor = new Actor(sim.people[0]);
  while (sim.t < duration) {
    sim.step();
    each?.(sim.t, actor);
  }
  return sim.people[0];
}

/** a 0.5 kg bar named `name` under `parent` at `at`, taken by its middle as the hand comes */
function bar(parent: Object3D, name: string, at: Vector3): Object3D {
  const thing = box(parent, name, new Vector3(0.03, 0.12, 0.03), at);
  thing.userData.mass = 0.5;
  empty(thing, 'grip', new Vector3());
  return thing;
}

/** an empty named `name` on `person`'s chest, `offset` from the chest bone as the body stands (+X left, +Z ahead) */
function onChest(person: Person, name: string, offset: Vector3): Object3D {
  const chest = person.bones.chest, place = new Group();
  place.name = name;
  place.position.copy(chest.getWorldPosition(new Vector3())).add(offset);
  chest.attach(place);
  return place;
}

test('a hand that puts one thing down and takes another keeps to the grip it takes', () => {
  let worst = 0;
  const person = play(3, (person) => {
    const tray = empty(person.object, 'tray', new Vector3(0.25, 1.0, 0.35));
    const cup = bar(tray, 'cup', new Vector3()), rod = bar(person.object, 'rod', new Vector3(0.2, 1.05, 0.45));
    return function* () {
      yield* grab(person, cup, { left: 'grip' });
      release(person, cup, tray);
      yield* grab(person, rod, { left: 'grip' });
      yield* wait(Infinity);
    };
  }, undefined, (_, actor) => {
    const hold = actor.holding.left;
    if (hold?.thing.name === 'rod') worst = Math.max(worst, actor.joint('leftHand').distanceTo(hold.grip));
  });
  expect(worst).toBeLessThanOrEqual(0.01);
  expect(logged(person.log)).toEqual([]);
});

test('a carry into a pouch on the chest comes to rest there while the body walks', () => {
  // (a player's walk: 1.4 m/s, eased in over a second)
  const root: Root = { position: new Vector3(), velocity: new Vector3(), yaw: 0 };
  const drive = (time: number) => {
    root.velocity?.set(0, 0, 1.4 * Math.min(1, time));
    root.position.set(0, 0, time < 1 ? 0.7 * time * time : 0.7 + 1.4 * (time - 1));
    return root;
  };
  let clock = 0, carried = NaN;
  const person = play(5, (person) => {
    const pouch = (name: string, aside: number) => {
      const place = onChest(person, name, new Vector3(aside, -0.17, 0.2));
      empty(place, `over ${name}`, new Vector3(0, 0.1, 0));
      place.userData.approach = [`over ${name}`];
      return place;
    };
    const from = pouch('pouch 1', 0.06), to = pouch('pouch 2', 0.13), magazine = bar(from, 'magazine', new Vector3());
    return function* () {
      yield* wait(1);
      yield* grab(person, magazine, { left: 'grip' });
      const began = clock;
      yield* carry(person, magazine, to);
      carried = clock - began;
      release(person, magazine, to);
      yield* wait(Infinity);
    };
  }, drive, (time) => { clock = time; });
  expect(carried).toBeLessThan(1.5);
  expect(logged(person.log)).toEqual([]);
});
