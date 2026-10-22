import { Group, Vector3, type Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { Skin } from './stage/skin';
import { flattenCharacterModelOptions, loadCharacterModel, type CharacterModel } from '@pmndrs/viverse';
import { Bodies, instance } from './stage/bodies';
import { Framing, placeCamera, PlayerCamera, VIEWS } from './stage/camera';
import { CinematicCamera } from './stage/cinematic';
import { byId } from './dom';
import { Playback } from './playback';
import { FIXED_DT, type Look, type Scenario } from './scenario';
import { SCENARIOS } from './scenarios';
import { stroll, walkThere } from './scenarios/stroll';
import { legSystem } from '../../packages/animate/src/humanoid/idle';
import { Simulation } from './simulation';
import { drawProps } from './stage/props';
import { FOV, Stage } from './stage';
import { drawTrail } from './stage/trail';
import { Panel, type Settings } from './ui';

const params = new URLSearchParams(location.search);
// video: frame-exact recording of live playback (capture layout, live camera smoothing),
// driven one frame at a time through window.__frame(dt) — see scripts/video.mjs
const video = params.has('video');
// capture: a still at t (scripts/capture.mjs), or a video
const capture = params.has('capture') || video;
if (capture) document.body.classList.add('capture');

const stage = new Stage(byId('c', HTMLCanvasElement), byId('overlay', HTMLCanvasElement), capture);
const props = new Group();
stage.scene.add(props);
const bodies = new Bodies(stage.scene);
/** the soldier the people wear unless a scenario or body=openpose|mannequin says otherwise (rigged from a generated model) */
const SOLDIER = { url: 'models/soldier.glb' };
/** the scenario's body, or the one body=openpose|mannequin asks for */
function bodyOf(s: Scenario): NonNullable<Scenario['body']> {
  const asked = params.get('body');
  if (asked === 'openpose') return 'openpose';
  if (asked === 'mannequin') return {};
  return s.body ?? SOLDIER;
}
// the viverse characters the scenarios wear, loaded up front (by url; no url = viverse's mannequin;
// Draco decoding for compressed files such as Drawcall Market characters)
const characters = new Map<string | undefined, CharacterModel>();
// the skins the scenarios' other bodies wear (none drawn as skeletons: body=openpose)
const skins = new Map<string, Object3D>();
for (const s of SCENARIOS) {
  const body = bodyOf(s);
  if (body !== 'openpose' && !characters.has(body.url)) characters.set(body.url, await loadCharacterModel(...flattenCharacterModelOptions({ url: body.url, useDraco: true })));
  if (body !== 'openpose') for (const url of s.skins ?? []) if (url && !skins.has(url)) skins.set(url, (await new GLTFLoader().loadAsync(url)).scene);
}
const caption = byId('caption', HTMLElement);
const zoom = Number(params.get('zoom') ?? 1);
/** the shots turned about the focus by this much (rad, + = toward the body's left): the far side of what it faces */
const turn = Number(params.get('turn') ?? 0);
const framing = new Framing();
let playerCamera = new PlayerCamera();
/** the player's look as last shown (`sync`): the camera's, the one the shown rifle is placed in */
let shownLook: Look | null = null;
const settings: Settings = {
  view: VIEWS.find((v) => v === params.get('view')) ?? 'orbit',
  flat: params.get('mode') === '2d',
  playing: !params.has('t'),
};
const panel = new Panel(settings, {
  select: load,
  viewChanged: () => {
    if (settings.view === 'orbit') startOrbit();
  },
  seek: (fraction) => seek(fraction * playback.sim.scenario.duration),
});
window.addEventListener('resize', () => stage.resize());
stage.resize();

let scenario = SCENARIOS.find((s) => s.id === params.get('example')) ?? SCENARIOS[0];
const legs = params.get('legs');
if (scenario.id === 'stroll' && (legs === 'old' || legs === 'core'))
  [legSystem.path, scenario] = [legs, params.has('face') ? walkThere(new Vector3(0, 0, 4), Number(params.get('face'))) : stroll({ radius: Number(params.get('radius') ?? 3) })];
let playback = start(scenario);
show();

function load(s: Scenario) {
  scenario = s;
  playback = start(s);
  show();
}

/** the scenario's actors are OpenPose skeletons, or copies of its viverse character */
function start(s: Scenario) {
  const body = bodyOf(s);
  if (body === 'openpose') return new Playback(new Simulation(s));
  const character = characters.get(body.url);
  if (!character) throw new Error(`character ${body.url ?? 'mannequin'} was not loaded`);
  return new Playback(new Simulation(s, () => instance(character, body.url === undefined), false, (url, b) => new Skin(clone(skins.get(url)!), b.pose.skeleton)));
}

/** sets the stage for the playback just started */
function show() {
  playerCamera = new PlayerCamera();
  bodies.hideHead(false);
  const { scenario: s, actors } = playback.sim;
  bodies.cast(actors, playback.sim.skins);
  stage.setEnvironment(s);
  bodies.castShadows(!!stage.env);
  framing.set(playback.blend(1).root, facing());
  panel.select(s);
  if (settings.view === 'orbit') startOrbit();
  if (!capture) {
    const url = new URL(location.href);
    url.searchParams.set('example', s.id);
    history.replaceState(null, '', url);
  }
  sync();
}

function seek(t: number) {
  if (t < playback.sim.t - 1e-9) load(scenario);
  playback.advanceTo(t);
  sync();
}

/** the free camera starts from the three-quarter shot, orbiting the focus */
function startOrbit() {
  placeCamera(stage.camera, 'three', framing, distance(), playback.bounds);
  stage.controls.target.copy(framing.focus);
}

function distance() {
  return (playback.sim.scenario.cameraDistance ?? 4.6) / zoom;
}

/** shows the state `alpha` of the way from the previous step to the current one; `dt` = display frame time */
function sync(alpha = 1, dt = 1 / 60) {
  const { sim } = playback;
  const s = sim.scenario;
  const between = playback.blend(alpha);
  shownLook = between.look;
  // (a body wearing its skin is not drawn as a skeleton too)
  const skinned = sim.skins.some((s) => s);
  drawProps(props, skinned ? between.props.filter((p) => p.kind === 'ball' || !p.bone) : between.props);
  stage.env?.update(sim.t);
  const still = capture && !video;
  if (still) framing.set(between.root, facing());
  else framing.follow(between.root, playback.velocity, facing(), dt);
  panel.showTime(sim.t, s.duration);
  caption.textContent = still ? `${s.id}  t=${sim.t.toFixed(2)}s  ${settings.view}` : '';
}

/** the way the shots are taken against: the way the body faces, as balance has it (not the hips' twist as they step or swing) */
function facing() {
  return playback.facing + turn;
}

/** aims the camera at the framing (which is smoothed already) */
function aim(dt = FIXED_DT) {
  const player = playback.sim.stage.player;
  const playerView = settings.view === 'first' || settings.view === 'third' ? settings.view : player?.input.view;
  const usePlayer = player && (player.live || settings.view === 'first' || settings.view === 'third' || !params.has('view') && settings.view === 'orbit');
  stage.controls.enabled = !usePlayer;
  bodies.hideHead(!!usePlayer && playerView === 'first');
  if (usePlayer && playerView) {
    if (!shownLook) throw new Error('a player camera needs the look sync showed');
    playerCamera.apply(stage.camera, shownLook, player.input.ads, playerView, dt);
    return;
  }
  stage.camera.fov = FOV;
  stage.camera.near = 0.05;
  stage.camera.updateProjectionMatrix();
  if (settings.view === 'orbit') {
    stage.controls.target.copy(framing.focus);
    stage.controls.update();
  } else {
    const angles = playback.sim.scenario.cameraAngles;
    const bearing = settings.view === 'front' || settings.view === 'side' ? angles?.[settings.view] : undefined;
    placeCamera(stage.camera, settings.view === 'first' || settings.view === 'third' ? 'three' : settings.view, framing, distance(), playback.bounds, bearing);
  }
}

function draw() {
  bodies.hidden = settings.flat;
  stage.draw(settings.flat ? bodies.all : null);
}

if (video) recordVideo();
else if (capture) captureStill();
else playLive();

function recordVideo() {
  // cam=cinematic: a scripted third → first person camera
  const cinematic = params.get('cam') === 'cinematic' ? new CinematicCamera() : null;
  // (the cinematic camera starts from the normal shot: keep that shot's own camera state
  // separate, so taking the camera over doesn't disturb the orbit it blends from)
  let orbit: Vector3 | null = null;
  let t = 0;
  let acc = 0;
  const render = (dt: number) => {
    const camera = stage.camera;
    if (cinematic && orbit) {
      camera.position.copy(orbit);
      camera.fov = FOV;
    }
    aim(dt);
    if (cinematic) {
      orbit = camera.position.clone();
      const look = settings.view === 'orbit' ? stage.controls.target.clone() : framing.focus.clone();
      cinematic.apply(camera, t, dt, playback.sim.actors, { pos: camera.position.clone(), look, fov: FOV });
      bodies.hideHead(cinematic.hideOwnHead);
    }
    draw();
  };
  window.__frame = (dt: number) => {
    t += dt;
    acc += dt;
    while (acc >= FIXED_DT - 1e-9) {
      acc -= FIXED_DT;
      playback.step();
    }
    sync(Math.max(0, acc) / FIXED_DT, dt);
    render(dt);
    return playback.sim.t < playback.sim.scenario.duration;
  };
  render(1 / 60);
  window.__ready = true;
}

function captureStill() {
  const t = Number(params.get('t') ?? 0);
  // trail=<seconds>: each key joint's path over that window
  const trail = Number(params.get('trail') ?? 0);
  if (trail > 0) drawTrail(stage.scene, playback, t - trail, t);
  playback.advanceTo(t);
  sync();
  aim();
  draw();
  window.__ready = true;
}

function bindPlayerInput() {
  const canvas = byId('c', HTMLCanvasElement);
  const keys = new Set<string>();
  const clearInput = () => {
    keys.clear();
    const player = playback.sim.stage.player;
    if (player) Object.assign(player.input, { move: { x: 0, z: 0 }, fire: false, ads: false, sprint: false, crouch: false, jump: false, reload: false });
  };
  const moveInput = () => {
    const player = playback.sim.stage.player;
    if (!player?.live) return;
    player.input.move.x = Number(keys.has('KeyA')) - Number(keys.has('KeyD'));
    player.input.move.z = Number(keys.has('KeyW')) - Number(keys.has('KeyS'));
    player.input.sprint = keys.has('ShiftLeft') || keys.has('ShiftRight');
    player.input.crouch = keys.has('KeyC') || keys.has('ControlLeft') || keys.has('ControlRight');
    player.input.jump = keys.has('Space');
    player.input.reload = keys.has('KeyR');
  };
  canvas.addEventListener('click', () => {
    const player = playback.sim.stage.player;
    if (!player || document.pointerLockElement === canvas) return;
    player.live = true;
    clearInput();
    settings.view = 'orbit';
    settings.playing = true;
    void canvas.requestPointerLock();
  });
  document.addEventListener('pointerlockchange', () => { if (!document.pointerLockElement) clearInput(); });
  window.addEventListener('blur', clearInput);
  document.addEventListener('keydown', (event) => {
    if (document.pointerLockElement !== canvas) return;
    if (event.code === 'Escape') { document.exitPointerLock(); return; }
    keys.add(event.code);
    moveInput();
    const player = playback.sim.stage.player;
    if (event.code === 'KeyV' && !event.repeat && player) player.input.view = player.input.view === 'first' ? 'third' : 'first';
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyV', 'KeyC', 'KeyR', 'Space', 'ControlLeft', 'ControlRight'].includes(event.code)) event.preventDefault();
  });
  document.addEventListener('keyup', (event) => { keys.delete(event.code); moveInput(); });
  document.addEventListener('mousemove', (event) => {
    const player = playback.sim.stage.player;
    if (document.pointerLockElement !== canvas || !player) return;
    // Tuned mouse sensitivity, radians per pixel; positive world yaw turns toward screen left.
    player.input.aimYaw -= event.movementX * 0.002;
    player.input.aimPitch = Math.max(-1.3, Math.min(0.65, player.input.aimPitch - event.movementY * 0.002));
  });
  document.addEventListener('mousedown', (event) => {
    const player = playback.sim.stage.player;
    if (document.pointerLockElement !== canvas || !player) return;
    if (event.button === 0) player.input.fire = true;
    if (event.button === 2) player.input.ads = true;
  });
  document.addEventListener('mouseup', (event) => {
    const player = playback.sim.stage.player;
    if (!player) return;
    if (event.button === 0) player.input.fire = false;
    if (event.button === 2) player.input.ads = false;
  });
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());
}

function playLive() {
  bindPlayerInput();
  if (params.has('t')) seek(Number(params.get('t')));
  let last = performance.now();
  let acc = 0;
  const loop = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (settings.playing) {
      acc += dt;
      while (acc >= FIXED_DT) {
        acc -= FIXED_DT;
        playback.step();
        if (playback.sim.t > playback.sim.scenario.duration && !playback.sim.stage.player?.live) load(scenario);
      }
      sync(acc / FIXED_DT, dt);
    }
    aim(dt);
    draw();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
