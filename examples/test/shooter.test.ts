import { Euler, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { expect, it } from 'vitest';
import type { CharacterModel } from '@pmndrs/viverse';
import { forwardOf, leftOf, wrapAngle, INDEX } from '@drawcall/animate';
import { shooter } from '../src/scenarios/shooter';
import { Simulation } from '../src/simulation';
import { Playback } from '../src/playback';
import { FIXED_DT } from '../src/scenario';
import { PlayerCamera } from '../src/stage/camera';
import { solePoints } from '../../packages/animate/src/humanoid/landmarks';
import { vary } from '../scripts/run';
import type { Role } from '../src/scenario';
import { SKELETONS, skeletonModel } from '../src/skeletons';
import { cases } from '../../packages/animate/test/open';

// The shooter on every body: the default and the skeletons unlike it (`./skeletons`) — the rifle, its grips, the reload and the dev log
// hold for any body; the default's tests keep their names, the others' are named for their body. The cases that do not yet hold are
// listed in `OPEN` (expected to fail: each one fixed comes off the list):
// - the legs at a sprint (both) and in quick turns (the outlier): knee accelerations past the dev check's, a touchdown too fast, the
//   soldier's foot leaving the floor twice a stance (its stride read as half) — the stepper's, not the arms';
// - the soldier's support hand in a quick turn: the trunk lagging the aim the rifle is held in, its handguard goes out of its short
//   arms' reach (up to 4 cm off it) — and its hip carry, held nearer its midline, shows the rifle just left of the view's middle
//   (−0.003 of its half-width) as the view lags a strafe.
const open = cases([
  ...[0, 1, 2].map((i) => `keeps both grips, steady sights and final-pose checks clean #${i} — on the soldier`),
  'keeps the rifle on the aim through fast turns: standing and walking, at the hip and aiming — on the soldier',
  'sprints with the rifle, the trunk turning with the stride, both hands on their grips — on the soldier',
  'takes the foregrip while the player keeps turning, and never throws on a late reach — on the soldier',
  'ADS overrides held sprint and keeps both grips during the raise — on the soldier',
  'jumps from a walk and a sprint: quick take-off, a ballistic arc, momentum kept, the knees taking the landing — on the soldier',
  'reloads while walking: magazine out, stowed, the full one in, back on the handguard, every grip kept — on the soldier',
  'sprinting cancels a reload before the magazine is out, and the hand goes back to the handguard — on the soldier',
  ...[0, 1, 2].map((i) => `keeps both grips, steady sights and final-pose checks clean #${i} — on the outlier`),
  'ADS overrides held sprint and keeps both grips during the raise — on the outlier',
  'jumps from a walk and a sprint: quick take-off, a ballistic arc, momentum kept, the knees taking the landing — on the outlier',
  'reloads while walking: magazine out, stowed, the full one in, back on the handguard, every grip kept — on the outlier',
]);
const BODIES: [string, ((role: Role) => CharacterModel) | undefined][] = [['default', undefined],
  ...Object.entries(SKELETONS).map(([name, { joints, height }]): [string, (role: Role) => CharacterModel] => [name, () => skeletonModel(joints, height)])];

/** The worst grip error (m) of either hand. */
const gripError = (h: Simulation['actors'][number]) => Math.max(0, ...(['left', 'right'] as const).map((side) => {
  const held = h.holding[side];
  return held ? h.pose.position(INDEX[`${side}Hand`]).distanceTo(held.item.grips[held.grip].position.clone().applyQuaternion(held.item.current.quaternion).add(held.item.current.position)) : 0;
}));

/** `playback` shown at a 144 Hz display from its time for `seconds`, as the live app does: `input` before each frame's steps, then the blend and the first-person camera. */
function display(playback: Playback, seconds: number, input: (t: number) => void, shown: (camera: PerspectiveCamera, props: ReturnType<Playback['blend']>['props'], t: number) => void) {
  const player = playback.sim.stage.player!, camera = new PerspectiveCamera(90, 16 / 9, 0.02, 1000), view = new PlayerCamera(), dt = 1 / 144;
  let acc = 0;
  for (let t = 0; t < seconds; t += dt) {
    input(t);
    for (acc += dt; acc >= FIXED_DT; acc -= FIXED_DT) playback.step();
    const { props, look } = playback.blend(acc / FIXED_DT);
    view.apply(camera, look!, player.input.ads, 'first', dt);
    camera.updateMatrixWorld();
    shown(camera, props, t);
  }
}


for (const [body, model] of BODIES) {
  const title = (name: string) => body === 'default' ? name : `${name} — on the ${body}`;
  const test = (name: string, fn: () => void) => open(title(name), fn);

  for (const seed of [0, 1, 2]) test(`keeps both grips, steady sights and final-pose checks clean #${seed}`, () => {
    const scene = shooter();
    const sim = new Simulation(seed ? vary(scene, seed) : scene, model, true);
    let grip = 0, sight = 0, sightLine = 0, acquired = Infinity, walking = 0, low = Infinity;
    let steady = 0, lastYaw = 0, lastPitch = 0, lastFire = 0, sightFrames = 0, lastAds = false;
    const camera = new PerspectiveCamera(90, 16 / 9, 0.02, 1000);
    const framing = new PlayerCamera();
    let hipFrames = 0, flight = 0, flightTime = 0, raised = Infinity, lag = 0, sway = 0, facing = 0, heading = 0, moved = 0, lastMove = '';
    const flights: number[] = [], landings: { time: number; z: number }[] = [];
    let planted = true;
    while (sim.t < scene.duration) {
      sim.step();
      const h = sim.actors[0];
      const rifle = h.holding.right?.item;
      const player = sim.stage.player;
      if (!player) throw new Error('missing input');
      const input = player.input;
      if (input.aimYaw !== lastYaw || input.aimPitch !== lastPitch || input.ads !== lastAds) steady = sim.t;
      if (input.fire) lastFire = sim.t;
      lastYaw = input.aimYaw;
      lastPitch = input.aimPitch;
      lastAds = input.ads;
      // The player owns the root: the body is where the controller puts it, facing where it looks.
      const root = player.root;
      if (!root) throw new Error('missing root');
      // (the root exact along the facing; the hips swaying across it, ±1.4 cm walking)
      const off = new Vector3(h.pose.position(0).x - root.position.x, 0, h.pose.position(0).z - root.position.z);
      lag = Math.max(lag, Math.abs(off.dot(forwardOf(h.locomotion.facing))));
      sway = Math.max(sway, Math.abs(off.dot(leftOf(h.locomotion.facing))));
      const speed = h.locomotion.velocity.length();
      if (`${input.move.x},${input.move.z},${input.sprint},${input.ads}` !== lastMove) [moved, lastMove] = [sim.t, `${input.move.x},${input.move.z},${input.sprint},${input.ads}`];
      // (once the speed has settled after a change of keys: 10 m/s² takes at most 0.5 s)
      if (speed > 0.5 && sim.t - moved > 0.5) {
        facing = Math.max(facing, Math.abs(wrapAngle(h.locomotion.facing - input.aimYaw)));
        const local = Math.atan2(h.locomotion.velocity.x, h.locomotion.velocity.z) - input.aimYaw;
        const asked = Math.atan2(input.move.x, input.move.z);
        if (input.move.x || input.move.z) heading = Math.max(heading, Math.abs(wrapAngle(local - asked)));
      }
      // Visible acquisition precedes the active grip, never a teleport.
      if (!rifle) continue;
      if (acquired === Infinity && h.holding.left?.item !== rifle) continue;
      acquired = Math.min(acquired, sim.t);
      expect(h.holding.right?.grip).toBe('pistol');
      // (each hand on whatever grip it holds: the support hand's off the handguard only through a reload)
      for (const side of ['left', 'right'] as const) {
        const held = h.holding[side];
        if (!held) continue;
        const target = held.item.grips[held.grip].position.clone().applyQuaternion(held.item.current.quaternion).add(held.item.current.position);
        grip = Math.max(grip, h.pose.position(INDEX[`${side}Hand`]).distanceTo(target));
      }
      if (input.ads && sim.t - steady > 0.5 && sim.t - lastFire > 0.5) {
        const wanted = new Vector3(Math.sin(input.aimYaw) * Math.cos(input.aimPitch), Math.sin(input.aimPitch), Math.cos(input.aimYaw) * Math.cos(input.aimPitch));
        sight = Math.max(sight, new Vector3(0, 0, 1).applyQuaternion(rifle.current.quaternion).angleTo(wanted));
        if (h.locomotion.walk < 0.01) {
          const eye = player.look().eye;
          const at = new Vector3(0, 0.12, 0).applyQuaternion(rifle.current.quaternion).add(rifle.current.position).sub(eye);
          sightLine = Math.max(sightLine, at.addScaledVector(wanted, -at.dot(wanted)).length());
        }
        sightFrames++;
      }
      framing.apply(camera, player.look(), input.ads, 'first', 1 / 60);
      camera.updateMatrixWorld();
      if (input.ads && sim.t > 13 && sim.t < 14) {
        const at = new Vector3(0, 0.12, 0).applyQuaternion(rifle.current.quaternion).add(rifle.current.position).sub(player.look().eye);
        if (Math.hypot(at.x, at.y) <= 0.01 && new Vector3(0, 0, 1).applyQuaternion(rifle.current.quaternion).angleTo(new Vector3(0, 0, 1)) < 2 * Math.PI / 180) raised = Math.min(raised, sim.t - 13);
      }
      if (input.ads && sim.t - steady > 0.5 && sim.t - lastFire > 0.5 && h.locomotion.walk < 0.01) {
        const sight = new Vector3(0, 0.12, 0).applyQuaternion(rifle.current.quaternion).add(rifle.current.position).project(camera);
        expect(Math.hypot(sight.x, sight.y)).toBeLessThan(0.035);
      }
      if (!input.ads && !input.sprint && sim.t - steady > 0.5 && sim.t < 13) {
        const projected = new Vector3(0, 0.06, 0.12).applyQuaternion(rifle.current.quaternion).add(rifle.current.position).project(camera);
        expect(projected.x).toBeGreaterThan(0);
        expect(projected.x).toBeLessThan(1);
        expect(projected.y).toBeLessThan(0);
        expect(projected.y).toBeGreaterThan(-1);
        hipFrames++;
      }
      // (on the floor: pushing off on the ball — not a sole point — the toe tips stand up to ~8 mm off it)
      const contacts = (['left', 'right'] as const).map((side) => Math.min(...solePoints(h, h.pose, side).map((p) => p.y)) <= 0.01);
      if (sim.t > 20 && sim.t < 23) {
        const airborne = contacts.every((contact) => !contact);
        if (airborne) { flight++; flightTime += 1 / 60; }
        else if (flightTime) { flights.push(flightTime); flightTime = 0; }
        if (contacts[0] && !planted) landings.push({ time: sim.t, z: h.pose.position(INDEX.leftFoot).z });
        expect(player.look().eye.y - rifle.current.position.y).toBeGreaterThan(0.2);
      }
      planted = contacts[0];
      if (h.locomotion.velocity.length() > 0.5 && h.locomotion.velocity.length() < 1.5 && sim.t < 16) {
        walking++;
        // (walking upright: steady walking, not the moment of a reversal)
        if (sim.t - moved > 0.5) low = Math.min(low, h.pose.position(0).y / h.proportions.hipHeight);
      }
    }
    expect(landings.length).toBeGreaterThan(2);
    expect(flights.length).toBeGreaterThan(2);
    const first = landings[0], last = landings[landings.length - 1];
    const stride = (last.z - first.z) / (landings.length - 1);
    const cadence = 120 * (landings.length - 1) / (last.time - first.time);
    expect(lag).toBeLessThan(1e-9);
    expect(sway).toBeLessThanOrEqual(0.0141 * sim.actors[0].proportions.scale);
    // (the facing eases toward the look over 25 ms; turning harder than the feet can follow, the trunk takes the rest)
    expect(facing).toBeLessThan(0.1);
    expect(heading).toBeLessThan(0.15);
    expect(raised).toBeLessThanOrEqual(0.3);
    expect(cadence).toBeGreaterThan(150);
    // (a stride as long as the legs: the default's 2 m × its legs over the default's)
    expect(stride).toBeGreaterThan(2 * sim.actors[0].proportions.legs);
    expect(hipFrames).toBeGreaterThan(120);
    expect(flight).toBeGreaterThan(0);
    expect(acquired).toBeLessThan(3);
    expect(grip).toBeLessThanOrEqual(0.01);
    expect(sight).toBeLessThanOrEqual(2 * Math.PI / 180);
    expect(sightLine).toBeLessThanOrEqual(0.01);
    expect(sightFrames).toBeGreaterThan(120);
    expect(walking).toBeGreaterThan(300);
    expect(low).toBeGreaterThan(0.9);
    expect(sim.actors[0].log).toEqual([]);
    // A driven body follows its player, not its balance: the XCoM bound is only noted.
    expect(sim.actors[0].notes.every((note) => note.check === 'driven XCoM outside support (m)')).toBe(true);
    expect(sim.stage.done()).toBe(true);
  });

  // (the view is the camera's alone: through the demo's walking, strafing, back-pedalling, aiming and firing — its first 17 s, the view
  // switched three times a second against its own every 7 s — every bone stays exactly as it was)
  test('switches view without changing any body motion', () => {
    const a = new Simulation(shooter(), model);
    const b = new Simulation(shooter(), model);
    const move = b.stage.move;
    b.stage.move = (t) => {
      move?.(t);
      const player = b.stage.player;
      if (!player) throw new Error('missing player');
      player.input.view = Math.floor(t * 3) % 2 ? 'first' : 'third';
    };
    let difference = 0, unequal = 0;
    while (a.t < 17) {
      a.step();
      b.step();
      const p = a.actors[0].pose, q = b.actors[0].pose;
      for (let bone = 0; bone < p.skeleton.bones.length; bone++) {
        difference = Math.max(difference, p.position(bone).distanceTo(q.position(bone)));
        if (!p.local(bone).equals(q.local(bone))) unequal++;
      }
    }
    expect(unequal).toBe(0);
    expect(difference).toBe(0);
  });


  test('keeps the rifle on the aim through fast turns: standing and walking, at the hip and aiming', () => {
    const sim = new Simulation(shooter(), model, true);
    sim.advanceTo(2.5);
    const player = sim.stage.player!, h = sim.actors[0];
    player.live = true;
    Object.assign(player.input, { move: { x: 0, z: 0 }, aimYaw: 0, aimPitch: 0, ads: false, sprint: false, fire: false, crouch: false, jump: false, reload: false });
    // (the rifle's turn in the look's frame: steady, as the aim has it, however the look turns)
    const relative = () => new Quaternion().setFromEuler(new Euler(-player.input.aimPitch, player.input.aimYaw, 0, 'YXZ')).invert().multiply(h.holding.right!.item.current.quaternion);
    const ease = (x: number) => x <= 0 ? 0 : x >= 1 ? 1 : x * x * x * (10 - 15 * x + 6 * x * x);
    const worst: Record<string, { angle: number; grip: number }> = {};
    for (const [name, move, ads] of [['hip', 0, false], ['aiming', 0, true], ['hip walking', 1, false]] as const) {
      Object.assign(player.input, { ads, move: { x: 0, z: move } });
      sim.advanceTo(sim.t + 1);
      const steady = relative(), from = sim.t;
      let angle = 0, grip = 0;
      // (6 rad/s mouse sweeps, 86° one way, 172° back and 86° again, each reversal within 0.1 s)
      while (sim.t < from + 1.2) {
        const u = sim.t - from, at = (t: number) => ease((u - t + 0.05) / 0.1);
        player.input.aimYaw += 6 / 60 * (at(0) - 2 * at(0.25) + 2 * at(0.75) - at(1));
        sim.step();
        angle = Math.max(angle, relative().angleTo(steady));
        grip = Math.max(grip, gripError(h));
      }
      worst[name] = { angle: angle * 180 / Math.PI, grip };
    }
    for (const [name, { angle, grip }] of Object.entries(worst)) {
      expect(angle).toBeLessThanOrEqual(name === 'aiming' ? 2 : 5);
      expect(grip).toBeLessThanOrEqual(0.01);
    }
    // (the arms move with it within their joints' pace; the feet, spinning this fast, may not — the legs are the stepper's)
    expect(h.log.filter((entry) => /Arm|Hand|Shoulder/.test(entry.where))).toEqual([]);
  });


  // (the mouse moves the look between steps, at the display's rate: the camera shows the look the rifle was placed in, blended as the
  // rifle is — the rifle never trails the view; before, the camera took the newest input and the rifle trailed it by a step, 2.6° at 3 rad/s)
  it.each([['standing', 0], ['walking', 1]] as const)(title('shows the rifle steady in the first-person view through fast turns aiming, %s'), (_, walk) => {
    const playback = new Playback(new Simulation(shooter(), model));
    playback.advanceTo(2.5);
    const player = playback.sim.stage.player!;
    player.live = true;
    Object.assign(player.input, { move: { x: 0, z: walk }, aimYaw: 0, aimPitch: 0, ads: true, sprint: false, fire: false, crouch: false, jump: false, reload: false });
    let steady: Quaternion | null = null, angle = 0, sight = 0;
    // (3 rad/s sweeps, reversing every 0.6 s, after 1.5 s aiming)
    display(playback, 3, (t) => { if (t > 1.5) player.input.aimYaw += 3 / 144 * Math.sign(Math.sin((t - 1.5) * Math.PI / 0.6)); }, (camera, props, t) => {
      const rifle = props[0];
      if (rifle.kind !== 'box' || !rifle.quaternion) throw new Error('the rifle is the first prop');
      const relative = camera.quaternion.clone().invert().multiply(rifle.quaternion);
      if (t < 1.5) { steady = relative; return; }
      angle = Math.max(angle, relative.angleTo(steady!));
      const at = props[5].position.clone().project(camera);
      sight = Math.max(sight, Math.hypot(at.x, at.y));
    });
    expect(angle).toBeLessThan(0.05 * Math.PI / 180);
    expect(sight).toBeLessThan(0.002);
  });

  // (a muzzle flash comes and goes: the props the playback blends by their places keep them — before, the flash came amid the scenery, and
  // for a step each prop after it was shown blended with its neighbour's place, a cover box swept 4.8 m across the view)
  test('shows a shot without a jump: the view and every prop continuous', () => {
    const playback = new Playback(new Simulation(shooter(), model));
    playback.advanceTo(14);
    let prop = 0, move = 0, turn = 0, last: { props: ReturnType<Playback['blend']>['props']; position: Vector3; direction: Vector3 } | null = null;
    display(playback, 1.5, () => {}, (camera, props) => {
      const direction = camera.getWorldDirection(new Vector3());
      if (last) {
        move = Math.max(move, camera.position.distanceTo(last.position));
        turn = Math.max(turn, direction.angleTo(last.direction));
        props.forEach((p, i) => { if (last!.props[i]?.kind === p.kind) prop = Math.max(prop, p.position.distanceTo(last!.props[i].position)); });
      }
      last = { props, position: camera.position.clone(), direction };
    });
    expect(playback.sim.stage.props(playback.sim.t).length).toBeGreaterThan(0);
    expect(prop).toBeLessThan(0.02);
    expect(move).toBeLessThan(0.005);
    expect(turn).toBeLessThan(0.005);
  });

  // (standing at ease the rifle breathes, drifts and is shouldered anew now and then, the eyes wander and glance; the sights up, the rifle
  // is held still in the aim and the body's breathing fades to 30%)
  test('stands alive at ease and holds still aiming', () => {
    const sim = new Simulation(shooter(), model);
    sim.advanceTo(2.5);
    const player = sim.stage.player!, h = sim.actors[0];
    player.live = true;
    Object.assign(player.input, { move: { x: 0, z: 0 }, aimYaw: 0, aimPitch: 0, ads: false, sprint: false, fire: false, crouch: false, jump: false, reload: false });
    const range = () => ({ lo: new Vector3(Infinity, Infinity, Infinity), hi: new Vector3(-Infinity, -Infinity, -Infinity), roll: [Infinity, -Infinity], breath: [Infinity, -Infinity] });
    const [easy, aimed] = [range(), range()];
    while (sim.t < 22) {
      player.input.ads = sim.t > 16;
      sim.step();
      const r = sim.t > 4 && sim.t < 16 ? easy : sim.t > 17 ? aimed : null;
      if (!r) continue;
      const { eye, yaw, pitch } = player.look(), frame = new Quaternion().setFromEuler(new Euler(-pitch, yaw, 0, 'YXZ')).invert();
      const rifle = h.holding.right!.item.current, at = rifle.position.clone().sub(eye).applyQuaternion(frame);
      r.lo.min(at);
      r.hi.max(at);
      const roll = new Euler().setFromQuaternion(frame.multiply(rifle.quaternion), 'YXZ').z;
      r.roll = [Math.min(r.roll[0], roll), Math.max(r.roll[1], roll)];
      const breath = 2 * Math.asin(h.pose.local(INDEX.chest).x);
      r.breath = [Math.min(r.breath[0], breath), Math.max(r.breath[1], breath)];
    }
    const spread = (r: ReturnType<typeof range>) => ({ moved: r.hi.clone().sub(r.lo).length(), roll: r.roll[1] - r.roll[0], breath: r.breath[1] - r.breath[0] });
    const [atEase, aiming] = [spread(easy), spread(aimed)];
    expect(atEase.moved).toBeGreaterThan(0.01);
    expect(atEase.roll).toBeGreaterThan(0.03);
    expect(aiming.moved).toBeLessThan(1e-4);
    expect(aiming.roll).toBeLessThan(1e-4);
    expect(aiming.breath).toBeLessThan(0.5 * atEase.breath);
    expect(h.log).toEqual([]);
  });

  // (a sprint with the rifle in both hands: no arm swings, so the trunk turns further with the stride than a free runner's — read, Arellano
  // & Kram 2014: arms held across the chest the pelvis turns 102% further, the shoulders 44%; Pontzer et al. 2009: arms folded, the shoulders
  // 50% further; snippet, Seay et al. 2011: soldiers running with a rifle turn the trunk further — from a free runner's ~14° pelvis and
  // ~20° thorax peak to peak; the grips held throughout)
  test('sprints with the rifle, the trunk turning with the stride, both hands on their grips', () => {
    const sim = new Simulation(shooter(), model, true);
    const pelvis: number[] = [], shoulders: number[] = [];
    let grip = 0;
    while (sim.t < 23) {
      sim.step();
      const h = sim.actors[0];
      if (sim.t < 20.5) continue;
      const across = (l: Vector3, r: Vector3) => {
        const d = l.sub(r);
        return Math.atan2(d.dot(forwardOf(h.locomotion.facing)), d.dot(leftOf(h.locomotion.facing))) * 180 / Math.PI;
      };
      pelvis.push(across(h.pose.position(INDEX.leftUpperLeg).clone(), h.pose.position(INDEX.rightUpperLeg).clone()));
      shoulders.push(across(h.pose.position(INDEX.leftUpperArm).clone(), h.pose.position(INDEX.rightUpperArm).clone()));
      grip = Math.max(grip, gripError(h));
    }
    const range = (a: number[]) => Math.max(...a) - Math.min(...a);
    expect(sim.actors[0].locomotion.run).toBe(1);
    expect(range(pelvis)).toBeGreaterThanOrEqual(18);
    expect(range(pelvis)).toBeLessThanOrEqual(30);
    expect(range(shoulders)).toBeGreaterThanOrEqual(20);
    expect(range(shoulders)).toBeLessThanOrEqual(32);
    expect(grip).toBeLessThanOrEqual(0.01);
    expect(sim.actors[0].log).toEqual([]);
  });

  test('takes the foregrip while the player keeps turning, and never throws on a late reach', () => {
    const sim = new Simulation(shooter(), model, true);
    sim.advanceTo(0.5);
    const player = sim.stage.player!;
    player.live = true;
    // (turning 3 rad/s, back and forth, through the reach for the foregrip: it once stayed behind and threw after 4 s)
    while (sim.t < 6) {
      player.input.aimYaw += 3 / 60 * Math.sign(Math.sin(sim.t * 1.3));
      sim.step();
    }
    expect(sim.actors[0].holding.left?.grip).toBe('foregrip');
    expect(gripError(sim.actors[0])).toBeLessThanOrEqual(0.01);
  });

  test('ADS overrides held sprint and keeps both grips during the raise', () => {
    const sim = new Simulation(shooter(), model, true);
    sim.advanceTo(21);
    const player = sim.stage.player;
    if (!player) throw new Error('missing player');
    player.live = true;
    player.input.ads = true;
    player.input.sprint = true;
    player.input.move.z = 1;
    player.input.aimYaw = 0.3;
    player.input.aimPitch = 0.15;
    const camera = new PerspectiveCamera(90, 16 / 9, 0.02, 1000);
    const framing = new PlayerCamera();
    while (sim.t < 24) {
      sim.step();
      const h = sim.actors[0];
      const rifle = h.holding.right?.item;
      if (!rifle) throw new Error('missing rifle');
      framing.apply(camera, player.look(), player.input.ads, 'first', 1 / 60);
      camera.updateMatrixWorld();
      if (sim.t > 23) {
        const at = new Vector3(0, 0.12, 0).applyQuaternion(rifle.current.quaternion).add(rifle.current.position).project(camera);
        expect(Math.hypot(at.x, at.y)).toBeLessThanOrEqual(0.035);
      }
      for (const [bone, name] of [[INDEX.leftHand, 'foregrip'], [INDEX.rightHand, 'pistol']] as const) {
        const target = rifle.grips[name].position.clone().applyQuaternion(rifle.current.quaternion).add(rifle.current.position);
        expect(h.pose.position(bone).distanceTo(target)).toBeLessThanOrEqual(0.01);
      }
    }
    expect(sim.actors[0].locomotion.velocity.length()).toBeLessThanOrEqual(0.91);
    expect(sim.actors[0].locomotion.run).toBe(0);
    expect(sim.actors[0].log).toEqual([]);
  });

  /** The demo, sampled each sub-step. */
  const demo = () => {
    const sim = new Simulation(shooter(), model, true);
    const frames: { t: number; jump: boolean; reload: boolean; crouch: number; airborne: boolean; speed: number; pelvis: number; soles: number[]; steps: number; reloading: boolean; held: number }[] = [];
    while (sim.t < sim.scenario.duration) {
      sim.step();
      const h = sim.actors[0], player = sim.stage.player!, root = player.root!, status = player.status!();
      let held = 0;
      for (const side of ['left', 'right'] as const) {
        const grip = h.holding[side];
        if (grip) held = Math.max(held, h.pose.position(INDEX[`${side}Hand`]).distanceTo(grip.item.grips[grip.grip].position.clone().applyQuaternion(grip.item.current.quaternion).add(grip.item.current.position)));
      }
      frames.push({ t: sim.t, jump: player.input.jump, reload: player.input.reload, crouch: root.crouch ?? 0, airborne: !!h.stepper?.airborne, speed: Math.hypot(root.velocity.x, root.velocity.z),
        pelvis: h.pose.position(0).y, soles: (['left', 'right'] as const).map((side) => Math.min(...solePoints(h, h.pose, side).map((p) => p.y))),
        steps: status.steps.length, reloading: status.reloading, held });
    }
    return { sim, frames, steps: sim.stage.player!.status!().steps };
  };
  // (run once, by the first test that reads it)
  let demoRun: ReturnType<typeof demo> | undefined;
  const recorded = () => (demoRun ??= demo());

  test('crouches smoothly, deep and slow', () => {
    const { frames, sim } = recorded();
    const standing = frames.find((f) => f.t > 2)!.pelvis;
    const deep = frames.filter((f) => f.crouch === 1);
    const walking = deep.filter((f) => f.speed > 0.1);
    const depth = standing - Math.max(...deep.filter((f) => f.speed < 0.01).map((f) => f.pelvis));
    // (the pelvis' acceleration getting down and up again, standing and crouch-walking: a 0.25 s minimum-jerk
    // crouch peaks at 5.77 × 0.37 m / 0.25² s ≈ 34 m/s², the steps' own less)
    let jerk = 0;
    for (let i = 2; i < frames.length; i++) if (frames[i].t > 35 && frames[i].t < 41) jerk = Math.max(jerk, Math.abs(frames[i].pelvis - 2 * frames[i - 1].pelvis + frames[i - 2].pelvis) * 3600);
    // (as deep as the legs go: the default's 0.33–0.42 m × its legs over the default's)
    const legs = sim.actors[0].proportions.legs;
    expect(depth).toBeGreaterThan(0.33 * legs);
    expect(depth).toBeLessThan(0.42 * legs);
    expect(Math.max(...walking.map((f) => f.speed))).toBeLessThanOrEqual(0.8 + 1e-9);
    expect(walking.length).toBeGreaterThan(60);
    expect(jerk).toBeLessThan(36);
  });

  test('jumps from a walk and a sprint: quick take-off, a ballistic arc, momentum kept, the knees taking the landing', () => {
    const { frames, sim } = recorded();
    const presses = frames.filter((f, i) => f.jump && !frames[i - 1].jump);
    expect(presses.length).toBe(2);
    for (const press of presses) {
      const from = frames.indexOf(press), height = frames[from - 1].pelvis;
      const off = frames.findIndex((f, i) => i >= from && f.airborne);
      const down = frames.findIndex((f, i) => i > off && !f.airborne);
      const after = frames.slice(down, down + 60);
      const latency = frames[off].t - press.t + 1 / 60, airtime = frames[down].t - frames[off].t;
      const apex = Math.max(...frames.slice(off, down).map((f) => f.pelvis)) - height;
      const absorb = Math.min(...after.map((f) => f.pelvis)) - height;
      // (up again: within the steps' own bob of where it was)
      const recovered = after.findIndex((f, i) => i > 5 && Math.abs(f.pelvis - height) < 0.03) / 60;
      const fall = (frames[down - 2].pelvis - frames[down - 1].pelvis) * 60;
      // (the feet's sole speed as each first meets the floor: the one exception to the touchdown limit, a jump's
      // landing, where the feet come down with the falling body — slower than it — and the knees take it up after)
      const touchdown = [0, 1].map((side) => {
        const i = frames.findIndex((f, j) => j > off && f.soles[side] <= 0.005);
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
    // Slides, touchdown speeds and knee snaps are each checked in the code: the dev log stays clean.
    expect(sim.actors[0].log).toEqual([]);
  });

  // (the pouches ride on the vest and the well on the rifle the body holds: bowing would carry them away as far, so the arm alone
  // reaches them and the trunk stays upright)
  test('reloads standing upright: the magazine out, stowed, the full one in, the trunk within 3° of upright', () => {
    const sim = new Simulation(shooter(), model, true), player = sim.stage.player!, h = sim.actors[0];
    player.live = true;
    let most = 0;
    while (sim.t < 6) {
      player.input.reload = sim.t > 3 && sim.t < 3.1;
      sim.step();
      if (sim.t > 3) {
        const up = h.pose.position(INDEX.neck).clone().sub(h.pose.position(INDEX.hips));
        most = Math.max(most, Math.atan2(Math.hypot(up.x, up.z), up.y));
      }
    }
    expect(player.status!().steps).toEqual(['to magazine', 'out', 'stow', 'to pouch', 'insert', 'handguard']);
    expect(most).toBeLessThan(3 * Math.PI / 180);
    expect(h.log).toEqual([]);
  });

  test('reloads while walking: magazine out, stowed, the full one in, back on the handguard, every grip kept', () => {
    const { frames, steps, sim } = recorded();
    expect(steps).toEqual(['to magazine', 'out', 'stow', 'to pouch', 'insert', 'handguard']);
    const press = frames.find((f) => f.reload)!;
    const begun = frames.find((f) => f.reloading)!, ended = frames.find((f) => f.t > begun.t && !f.reloading)!;
    const moving = frames.filter((f) => f.reloading).every((f) => f.speed > 1);
    expect(begun.t - press.t).toBeLessThan(0.05);
    expect(ended.t - begun.t).toBeGreaterThan(1.8);
    expect(ended.t - begun.t).toBeLessThan(2.8);
    expect(moving).toBe(true);
    expect(Math.max(...frames.map((f) => f.held))).toBeLessThanOrEqual(0.01);
    expect(sim.actors[0].log).toEqual([]);
  });

  test('sprinting cancels a reload before the magazine is out, and the hand goes back to the handguard', () => {
    const sim = new Simulation(shooter(), model, true);
    sim.advanceTo(30);
    const player = sim.stage.player!;
    player.live = true;
    Object.assign(player.input, { move: { x: 0, z: 1 }, reload: true, ads: false, sprint: false, fire: false, crouch: false, jump: false });
    sim.advanceTo(30.1);
    player.input.reload = false;
    player.input.sprint = true;
    sim.advanceTo(32);
    const h = sim.actors[0];
    expect(player.status!().steps).toEqual(['to magazine', 'cancelled']);
    expect(h.holding.left?.grip).toBe('foregrip');
    expect(h.locomotion.run).toBeGreaterThan(0.5);
    expect(h.log).toEqual([]);
  });
}
