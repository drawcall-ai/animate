import { ACESFilmicToneMapping, CubeCamera, DirectionalLight, HalfFloatType, HemisphereLight, MathUtils, Mesh, PCFSoftShadowMap, PMREMGenerator, Scene, Vector3, WebGLCubeRenderTarget, WebGLRenderer } from 'three';
import { RigLoader } from '@drawcall/rig';
import { buildWorld } from '@drawcall/physics-rapier';
import { Audio } from './audio';
import { CameraRig } from './camera';
import { MAGAZINE } from './combat';
import { Enemy } from './enemy';
import { createEnvironment } from './environment';
import { Input } from './input';
import { GRAVITY } from './movement';
import { Navigation } from './nav';
import { Playback } from './playback';
import type { Climber } from './ladder/climber';
import type { Mount } from './mount';
import type { Driver } from './rover/driver';
import { Handling } from './rover/handling';
import { createRover, loadPaintMaps } from './rover/model';
import { RoverSound } from './rover/sound';
import { SOLDIER } from './skeleton';
import { Soldier } from './soldier';
import './style.css';

/** Seconds the damage vignette takes to fade. */
const VIGNETTE = 0.3;
/** Seconds the player watches through its falling body's eyes before the restart screen. */
const DEATH_CAM = 2;

/** How the HUD speaks of a mount, and where the view settles getting on it (rad). */
interface Words { use: string; getting: string; leaving: string; on: string; keys: string; pitch: number }

/** The player as the rover's driver and the ladder's climber. */
function mountsOf(player: Soldier): { driver: Driver; climber: Climber } {
  const { driver, climber } = player;
  if (!driver || !climber) throw new Error('The player has no driver seat or no ladder');
  return { driver, climber };
}

function element<T extends HTMLElement>(id: string, type: { new(): T }): T {
  const value = document.getElementById(id);
  if (!(value instanceof type)) throw new Error(`Missing ${id}`);
  return value;
}

const canvas = element('game', HTMLCanvasElement);
const play = element('play', HTMLButtonElement);
const notice = element('notice', HTMLElement);
const prompt = element('prompt', HTMLElement);
const labels = {
  motion: element('motion', HTMLElement), speed: element('speed', HTMLElement),
  ammo: element('ammo', HTMLElement), reload: element('reload', HTMLElement), feedback: element('feedback', HTMLElement), hit: element('hit', HTMLElement),
  health: element('health', HTMLElement), enemy: element('enemy', HTMLElement), damage: element('damage', HTMLElement),
};
document.body.classList.add('paused');

async function start() {
  const renderer = new WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;
  renderer.toneMapping = ACESFilmicToneMapping;
  const scene = new Scene();
  const environment = createEnvironment(scene);
  scene.add(new HemisphereLight(0xc7dff4, 0x5c4c41, 1.1));
  const sun = new DirectionalLight(0xffdfb0, 3.2);
  sun.position.set(-15, 18, -12);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -29, right: 29, top: 29, bottom: -29, near: 0.5, far: 85 });
  sun.shadow.normalBias = 0.012;
  scene.add(sun);
  // Capture the actual yard for the rifle's metal reflections, once before the player enters.
  const cube = new WebGLCubeRenderTarget(128, { type: HalfFloatType });
  const probe = new CubeCamera(0.1, 100, cube);
  probe.position.copy(environment.spawn).add(new Vector3(0, 1.6, 0));
  probe.update(renderer, scene);
  const pmrem = new PMREMGenerator(renderer);
  const reflections = pmrem.fromCubemap(cube.texture);
  scene.environment = reflections.texture;
  scene.environmentIntensity = 0.25;
  pmrem.dispose();
  cube.dispose();

  notice.textContent = 'Loading the soldier and preparing its rig…';
  const url = 'models/soldier.glb';
  const rig = await new RigLoader().loadAsync({ url, skeleton: SOLDIER, source: { url, dependencyUrls: [] } });
  rig.scene.traverse((node) => {
    node.frustumCulled = false;
    if (node instanceof Mesh) node.castShadow = node.receiveShadow = true;
  });
  notice.textContent = 'Fuelling the Land Rover…';
  const maps = await loadPaintMaps();
  const rover = createRover(maps);
  rover.body.position.set(-4.5, 0, -14.6);
  rover.body.rotation.y = Math.PI / 2;
  scene.add(rover.body);
  const world = await buildWorld({ scene, gravity: [0, GRAVITY, 0], fixedDelta: 1 / 60, maxSubsteps: 5 });
  environment.bind(world);
  const audio = await Audio.load();
  const handling = new Handling(world, rover);
  const roverSound = new RoverSound(audio, rover, handling);
  const player = new Soldier('Player', world, scene, rig.scene, environment.spawn, true, (...args) => audio.play(...args),
    { vehicle: { rover, handling }, ladder: environment.ladder });
  const opponent = new Soldier('Opponent', world, scene, rig.scene, new Vector3(0, 0.04, 13.5), false,
    (sound, gain, offset, duration) => audio.play(sound, gain, offset, duration, opponent.position));
  // (a function's result, as the hoisted functions below see no narrowing of `player.driver` and `player.climber`)
  const { driver, climber } = mountsOf(player);
  // (the view settles onto the wheel and bonnet, and up the ladder)
  const words = new Map<Mount, Words>([
    [driver, { use: 'Drive', getting: 'Getting in', leaving: 'Getting out', on: 'Driving', keys: 'W S · Drive  A D · Steer  Space · Handbrake', pitch: -0.45 }],
    [climber, { use: 'Climb', getting: 'Getting on', leaving: 'Getting off', on: 'Climbing', keys: 'W S · Climb up or down', pitch: 0.15 }],
  ]);
  const wordsOf = (mount: Mount) => {
    const found = words.get(mount);
    if (!found) throw new Error('A mount the HUD has no words for');
    return found;
  };
  player.combat.targets = [opponent];
  opponent.combat.targets = [player];
  const { movement, avatar, combat } = player;
  const camera = new CameraRig();
  notice.textContent = 'Building navigation through the course…';
  const navigation = new Navigation(world);
  const enemy = new Enemy(opponent, player, navigation, world);
  const playback = new Playback([avatar.group, opponent.avatar.group, player.remains, opponent.remains, rover.body, ...environment.moving], () => player.look(), world.fixedDelta);
  const input = new Input(canvas, (locked) => {
    if (!locked) void audio.pause().catch(showError);
    document.body.classList.toggle('playing', locked);
    document.body.classList.toggle('paused', !locked);
    play.textContent = player.alive ? 'Resume course' : 'Restart encounter';
    notice.textContent = player.alive ? 'Click to capture the mouse. Press Esc to pause.' : 'You were hit. Restart the encounter to try another approach.';
  }, () => camera.camera.fov);
  const muzzle = new Vector3(), shot = new Vector3();
  let previous: number | undefined;
  // The last health and hit count seen, and the seconds left on the damage vignette.
  let health = player.health, hits = 0, hurt = 0;
  // Seconds since the player died.
  let dead = 0;
  let stopped = false;
  let resetting = false;

  function reset() {
    resetting = true;
    dead = 0;
    world.reset();
    handling.reset();
    player.reset();
    opponent.reset(undefined, Math.PI);
    enemy.reset();
    input.reset();
    world.update(world.fixedDelta * 4);
    player.view.pitch = input.pitch;
    // Both soldiers begin holding their rifle, using the same procedural acquisition.
    for (let frame = 0; frame < 180; frame++) { player.update(1 / 60); opponent.update(1 / 60); }
    playback.reset();
    resetting = false;
  }

  const stopAnimation = world.onAfterStep((dt) => {
    if (resetting) return;
    playback.step(() => { player.update(dt); opponent.update(dt); });
    enemy.update(dt);
    audio.lift(environment.lift.position, environment.lift.getVelocity().linear.y);
  });

  function resize() { renderer.setSize(innerWidth, innerHeight); camera.resize(innerWidth, innerHeight); }
  resize();
  window.addEventListener('resize', resize);

  function draw(dt: number) {
    input.direction();
    if (input.locked) {
      // E uses what the player is on or setting off for, else what it stands near.
      if (input.pressed('KeyE')) (active() ?? player.mounts.find((mount) => mount.near))?.use();
      const mount = active();
      if (mount) ride(mount, dt);
      else walk();
      player.view.pitch = input.pitch;
      if (input.pressed('Backspace')) reset();
      const before = world.time;
      world.update(dt);
      playback.advance(dt, world.time - before);
      if (player.position.y < -8) reset();
      if (!player.alive && (dead += dt) > DEATH_CAM) document.exitPointerLock();
    }
    // The camera turns with the mouse every rendered frame; the blended body turns with it about the eye.
    // Dead, it sees through its ragdoll's head, the mouse no longer turning it.
    // Seated or on the ladder, it sees along its head as posed.
    const free = player.alive && !player.mounted;
    const show = () => free ? avatar.face(playback.blend(playback.alpha), input.yaw, input.pitch) : playback.blend(playback.alpha);
    const look = show();
    avatar.muzzle.getWorldPosition(muzzle);
    // Queries synchronize scene transforms into physics; keep display interpolation out of them.
    playback.restore();
    camera.update(look, free ? avatar.aimWeight : 0);
    audio.listen(camera.camera);
    roverSound.update();
    if (input.locked && input.trigger && !active()) {
      // The shot leaves the muzzle for what the crosshair covers, recoil's kick included; along the view when that is nearer than
      // the muzzle (pressed against a wall) or nothing.
      const sighted = world.raycast(look.eye, camera.direction, 120);
      if (sighted && sighted.distance > look.eye.distanceTo(muzzle)) shot.copy(sighted.point).sub(muzzle).normalize();
      else shot.copy(camera.direction);
      if (player.shoot(look.eye, muzzle, shot)) {
        input.fired();
        enemy.hear(player.position);
      }
    }
    if (combat.hits > hits) audio.tick();
    hits = combat.hits;
    hurt = player.health < health ? VIGNETTE : Math.max(0, hurt - dt);
    health = player.health;
    document.body.classList.toggle('aiming', movement.input.aim);
    const low = combat.ammo <= MAGAZINE / 3;
    labels.ammo.classList.toggle('low', low);
    labels.motion.textContent = motionLabel();
    labels.speed.textContent = driver.posed ? `${Math.abs(handling.speed * 3.6).toFixed(0)} km/h` : `${movement.speed.toFixed(1)} m/s`;
    prompt.textContent = promptLabel();
    labels.ammo.textContent = String(combat.ammo);
    labels.reload.textContent = avatar.reloading ? 'Reloading…' : low ? 'R · Reload' : 'Practice rifle · unlimited magazines';
    labels.feedback.textContent = combat.feedback;
    labels.hit.style.opacity = combat.hit ? '1' : '0';
    labels.hit.classList.toggle('kill', combat.kill);
    labels.damage.style.opacity = String(hurt / VIGNETTE);
    labels.health.textContent = String(player.health);
    labels.enemy.textContent = `${enemy.status} · ${opponent.health}`;
    show();
    try {
      avatar.beforeRender();
      renderer.render(scene, camera.camera);
    } finally {
      avatar.afterRender();
      playback.restore();
    }
  }

  /** What the player is on or setting off for. */
  function active() { return player.mounts.find((mount) => mount.state !== 'off'); }

  function motionLabel() {
    const mount = active();
    if (mount) {
      const said = wordsOf(mount);
      return mount.state === 'on' ? said.on : mount.state === 'dismounting' ? said.leaving : said.getting;
    }
    if (movement.crouched) return 'Crouched';
    if (!movement.grounded) return 'Airborne';
    return movement.sprinting ? 'Sprinting' : 'Grounded';
  }

  function promptLabel() {
    const near = player.mounts.find((mount) => mount.near), mount = active();
    if (near) return `E · ${wordsOf(near).use}`;
    if (driver.canExit) return 'E · Get out';
    if (driver.blocked) return 'No room to get out';
    return mount?.state === 'on' ? wordsOf(mount).keys : '';
  }

  /** On foot: the keys move the capsule and the mouse turns it. */
  function walk() {
    handling.park();
    // Ask for the reload first, so this frame's aim already gives way to it.
    if (input.pressed('KeyR') || combat.ammo === 0) player.reload();
    movement.input.move.copy(input.move);
    movement.input.yaw = input.yaw;
    player.aim = input.aim;
    // Firing (held or a quick click) ends a sprint, except during a reload; the shot goes as soon as the rifle is up.
    movement.input.sprint = input.sprint && !(input.trigger && !avatar.reloading);
    movement.input.crouch = input.crouch;
    movement.input.jump = input.jump;
  }

  /**
   * On a mount: walking to it, the view turns with the walk; on it, the view turns with it and no further than the head and shoulders
   * can, seated the keys drive and on the ladder they climb.
   */
  function ride(mount: Mount, dt: number) {
    if (mount.state === 'approaching' || mount.state === 'mounting') input.pitch = MathUtils.damp(input.pitch, wordsOf(mount).pitch, 3, dt);
    input.yaw = mount.state === 'approaching' ? movement.input.yaw : mount.aim(input.yaw, input.pitch);
    const ahead = mount.state === 'on' ? Number(input.down('KeyW')) - Number(input.down('KeyS')) : 0;
    if (mount === driver && mount.state === 'on') handling.drive(ahead, Number(input.down('KeyA')) - Number(input.down('KeyD')), input.jump);
    else handling.park();
    if (mount === climber) climber.climb(ahead);
  }

  function frame(now: number) {
    if (stopped) return;
    const dt = previous === undefined ? 0 : Math.min((now - previous) / 1000, 1 / 20);
    previous = now;
    try { draw(dt); }
    catch (error) { stopped = true; document.exitPointerLock(); showError(error); return; }
    requestAnimationFrame(frame);
  }
  reset();
  draw(1 / 60);
  play.disabled = false;
  play.textContent = 'Enter the course';
  notice.textContent = 'Click to capture the mouse. Press Esc to pause.';
  const capture = () => {
    if (!player.alive) reset();
    return Promise.all([audio.resume(), input.lock()]).catch((error: unknown) => {
      void audio.pause().catch(showError);
      notice.textContent = `${error instanceof Error ? error.message : String(error)} Click to retry.`;
    });
  };
  play.addEventListener('click', capture);
  canvas.addEventListener('click', () => { if (!input.locked) void capture(); });
  requestAnimationFrame(frame);

  const dispose = () => {
    stopped = true;
    roverSound.dispose();
    void audio.dispose().catch(showError);
    reflections.dispose();
    stopAnimation(); handling.dispose(); rover.dispose(); maps.dispose(); input.dispose(); player.dispose(); opponent.dispose(); environment.dispose(); world.dispose(); rig.dispose(); renderer.dispose();
    window.removeEventListener('resize', resize);
  };
  window.addEventListener('pagehide', dispose, { once: true });
  return { world, audio, movement, camera, combat, input, avatar, player, opponent, enemy, navigation, rover, handling, driver, climber, ladder: environment.ladder, reset, dispose };
}

function showError(error: unknown) {
  console.error(error);
  document.body.classList.remove('playing');
  document.body.classList.add('paused');
  notice.textContent = error instanceof Error ? error.message : String(error);
  play.textContent = 'Reload the page to try again';
  play.disabled = true;
}

export const game = start().catch(showError);
