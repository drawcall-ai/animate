import { Group } from 'three';
import { Figures, Wardrobe } from './stage/bodies';
import { Framing, placeCamera, PlayerCamera, VIEWS } from './stage/camera';
import { byId } from './dom';
import { Playback } from './playback';
import { FIXED_DT, type Look, type Scenario } from './scenario';
import { DOG, HORSE, LION, OUTLIER, PERSON, SOLDIER, type PersonSkeleton } from './skeletons';
import { SCENARIOS } from './scenarios';
import { Simulation } from './simulation';
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
/** the skeleton people stand on where a scenario names none: the soldier (wearing its model) unless body=person|outlier asks for a bare one */
const skeleton = ({ person: PERSON, outlier: OUTLIER, soldier: SOLDIER } as Record<string, PersonSkeleton | undefined>)[params.get('body') ?? 'soldier'];
if (!skeleton) throw new Error(`body=${params.get('body')}: a body is person, outlier or soldier`);
/** the models bodies wear, by the skeleton measured on each: the bodies of other skeletons go bare */
byId('time', HTMLElement).textContent = 'rigging the models…';
const wardrobe = await Wardrobe.load([[SOLDIER, 'models/soldier.glb'], [HORSE, 'models/horse.glb'], [DOG, 'models/dog.glb'], [LION, 'models/lion.glb']]);
const figures = new Figures();
/** the run's scene, then the figures (they follow its world matrices) */
const shown = new Group();
stage.scene.add(shown, figures.group);
const caption = byId('caption', HTMLElement);
const zoom = Number(params.get('zoom') ?? 1);
/** the shots turned about the focus by this much (rad, + = toward the body's left): the far side of what it faces */
const turn = Number(params.get('turn') ?? 0);
const framing = new Framing();
let playerCamera = new PlayerCamera();
/** the player's look as last shown (`sync`): the camera's, the one the shown rifle is placed in */
let shownLook: Look | null = null;
/** the first person's head is hidden as the camera is in it */
let headHidden = false;
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
let playback = start(scenario);
show();

function load(s: Scenario) {
  scenario = s;
  playback = start(s);
  show();
}

/** a run of the scenario, its bodies dressed from the wardrobe */
function start(s: Scenario) {
  return new Playback(new Simulation(s, { skeleton, dress: wardrobe.dress }));
}

/** sets the stage for the playback just started */
function show() {
  playerCamera = new PlayerCamera();
  const { scenario: s, stage: run } = playback.sim;
  shown.clear();
  shown.add(run.scene);
  figures.cast(run.bodies);
  framing.set(playback.blend(1).focus, facing());
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
  const still = capture && !video;
  if (still) framing.set(between.focus, facing());
  else framing.follow(between.focus, playback.velocity, facing(), dt);
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
  headHidden = !!usePlayer && playerView === 'first';
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
  figures.hidden = settings.flat;
  figures.hideHead(headHidden);
  stage.draw(settings.flat ? figures.joints : null);
  figures.hideHead(false);
}

if (video) recordVideo();
else if (capture) captureStill();
else playLive();

function recordVideo() {
  let acc = 0;
  window.__frame = (dt: number) => {
    acc += dt;
    while (acc >= FIXED_DT - 1e-9) {
      acc -= FIXED_DT;
      playback.step();
    }
    sync(Math.max(0, acc) / FIXED_DT, dt);
    aim(dt);
    draw();
    return playback.sim.t < playback.sim.scenario.duration;
  };
  aim();
  draw();
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
