import {
  BufferGeometry,
  Line,
  BoxGeometry,
  Color,
  EdgesGeometry,
  GridHelper,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  HalfFloatType,
  MeshBasicMaterial,
  NeutralToneMapping,
  NoToneMapping,
  OctahedronGeometry,
  PCFSoftShadowMap,
  PerspectiveCamera,
  Scene,
  Vector2,
  WebGLRenderTarget,
  SphereGeometry,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { createBoxingArena, type Environment } from './environments/arena';
import { CinematicCamera } from './cinematic';
import { createPose, forwardOf, leftOf, type HumanoidInput, type Pose } from '@prohuman/core';
import { drawOpenPose2D, OpenPoseSkeleton, projectBody25 } from '@prohuman/openpose';
import { FIXED_DT, Simulation, type Prop, type Scenario } from './scenario';
import { SCENARIOS } from './scenarios';
import { SHELF_BOARDS } from './scenarios/pickup';

type View = 'orbit' | 'front' | 'side' | 'back' | 'three' | 'top';
const VIEWS: View[] = ['orbit', 'front', 'side', 'three', 'back', 'top'];

const params = new URLSearchParams(location.search);
// video: frame-exact recording of live playback (capture layout, live camera smoothing),
// driven one frame at a time through window.__frame(dt) — see scripts/video.mjs
const video = params.has('video');
// cam=cinematic: scripted third → first person camera for recordings (video mode)
let cinematic: CinematicCamera | null = null;
let videoT = 0;
let videoDt = 1 / 60;
const capture = params.has('capture') || video;
if (capture) document.body.classList.add('capture');

const canvas = document.getElementById('c') as HTMLCanvasElement;
const overlay = document.getElementById('overlay') as HTMLCanvasElement;
const octx = overlay.getContext('2d')!;
const caption = document.getElementById('caption')!;
const renderer = new WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: capture });
renderer.setPixelRatio(capture ? 1 : Math.min(2, devicePixelRatio));
const scene = new Scene();
scene.background = new Color(0x000000);
const camera = new PerspectiveCamera(38, 1, 0.05, 100);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;

const grid = new GridHelper(40, 80, 0x2a2a2a, 0x161616);
scene.add(grid);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = PCFSoftShadowMap;

// surroundings (e.g. the boxing arena): lit, shadowed, tone-mapped (neutral, so the OpenPose
// colours stay true) with bloom on the lights only (threshold 1: only HDR emitters glow)
let env: Environment | null = null;
const composer = new EffectComposer(renderer, new WebGLRenderTarget(1, 1, { type: HalfFloatType, samples: 4 }));
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new Vector2(1, 1), 0.55, 0.55, 1.0);
composer.addPass(bloom);
composer.addPass(new OutputPass());

function setEnvironment(s: Scenario) {
  if (env) {
    scene.remove(env.group);
    env.dispose();
    env = null;
  }
  if (s.environment?.kind === 'boxing-arena') {
    env = createBoxingArena(new Vector3(...s.environment.center));
    scene.add(env.group);
  }
  grid.visible = !env;
  scene.fog = env?.fog ?? null;
  scene.background = env?.background ?? new Color(0x000000);
  renderer.toneMapping = env ? NeutralToneMapping : NoToneMapping;
}

const propsGroup = new Group();
scene.add(propsGroup);
const markerGroup = new Group();
scene.add(markerGroup);
const markerMat = new MeshBasicMaterial({ color: 0xffffff, wireframe: true });
const markerGeo = new OctahedronGeometry(0.035);
const edgeMat = new LineBasicMaterial({ color: 0x6b6b75 });
const faceMat = new MeshBasicMaterial({ color: 0x1a1a1f, transparent: true, opacity: 0.85 });
const ballMat = new MeshBasicMaterial({ color: 0x777777, wireframe: true });

let sim!: Simulation;
let skeletons: OpenPoseSkeleton[] = [];
let view: View = (params.get('view') as View) ?? 'orbit';
let mode: '3d' | '2d' = params.get('mode') === '2d' ? '2d' : '3d';
let playing = !params.has('t');
let showMarkers = params.get('markers') !== '0';
let camYaw = 0;
let focus = new Vector3(0, 1, 0);
// the sim runs at a fixed 60 Hz; displays often refresh faster (120 Hz), so what's drawn is
// interpolated between the last two steps — otherwise the body moves only on some frames
// while the camera glides every frame, which reads as stutter ("Fix Your Timestep")
let prevPoses: Pose[] = [];
let prevProps: Prop[] = [];
let shown: Pose[] = [];
const prevRoot = new Vector3();

function snapshot() {
  prevPoses = sim.actors.map((a, i) => {
    const out = prevPoses[i] ?? createPose();
    for (const k in a.pose) out[k as keyof Pose].copy(a.pose[k as keyof Pose]);
    return out;
  });
  prevProps = sim.run.props().map((p) => ({ ...p, position: p.position.clone() }));
  const r = sim.actors[0].gait.root;
  prevRoot.set(r.x, 0.95, r.z);
}

/** advance one fixed step, remembering the state it started from */
function step() {
  snapshot();
  sim.step();
}

let envFor: Scenario | null = null;
function load(s: Scenario) {
  sim = new Simulation(s);
  for (const sk of skeletons) scene.remove(sk);
  skeletons = sim.actors.map(() => new OpenPoseSkeleton());
  skeletons.forEach((sk) => scene.add(sk));
  if (sim.scenario !== envFor) {
    setEnvironment(s);
    envFor = s;
  }
  // bodies ground themselves with contact shadows in lit surroundings
  for (const sk of skeletons) sk.traverse((o) => (o.castShadow = !!env));
  camYaw = sim.actors[0].gait.root.yaw;
  focus.copy(s.focus?.(sim.actors) ?? sim.actors[0].pose.pelvis);
  shown = sim.actors.map(() => createPose());
  snapshot();
  const info = document.getElementById('info')!;
  info.innerHTML = `<div class="drives">input: ${s.drives}</div><p>${s.description}</p>`;
  document.querySelectorAll('#list button').forEach((b) => b.classList.toggle('active', (b as HTMLElement).dataset.id === s.id));
  if (view === 'orbit') placeCamera('three', true);
  const url = new URL(location.href);
  url.searchParams.set('example', s.id);
  if (!capture) history.replaceState(null, '', url);
  syncFrame();
}

function seek(t: number) {
  if (t < sim.t - 1e-9) load(sim.scenario);
  sim.advanceTo(t);
  snapshot();
  syncFrame();
}

// ---------------------------------------------------------------- props

function box(size: Vector3, pos: Vector3, yaw = 0) {
  const g = new BoxGeometry(size.x, size.y, size.z);
  const m = new Mesh(g, faceMat);
  const e = new LineSegments(new EdgesGeometry(g), edgeMat);
  m.add(e);
  m.position.copy(pos);
  m.rotation.y = yaw;
  return m;
}

function drawProps(props: Prop[]) {
  propsGroup.clear();
  for (const p of props) {
    if (p.kind === 'box' || p.kind === 'tray') propsGroup.add(box(p.size, p.position, p.yaw));
    if (p.kind === 'ball') {
      const m = new Mesh(new SphereGeometry(p.size.x / 2, 12, 8), ballMat);
      m.position.copy(p.position);
      propsGroup.add(m);
    }
    if (p.kind === 'shelf') {
      const { x, z } = p.position;
      const w = p.size.x;
      const d = p.size.z;
      for (const sx of [-1, 1]) propsGroup.add(box(new Vector3(0.03, p.size.y, d), new Vector3(x + (sx * w) / 2, p.size.y / 2, z), 0));
      for (const y of SHELF_BOARDS) propsGroup.add(box(new Vector3(w, 0.02, d), new Vector3(x, y - 0.01, z), 0));
    }
  }
}

function drawMarkers(inputs: HumanoidInput[]) {
  markerGroup.clear();
  if (!showMarkers) return;
  for (const inp of inputs) {
    for (const k of ['head', 'torso', 'pelvis', 'leftHand', 'rightHand', 'leftFoot', 'rightFoot'] as const) {
      const e = inp[k];
      if (!e?.position || (e.weight ?? 1) <= 0.02) continue;
      const m = new Mesh(markerGeo, markerMat);
      m.position.set(e.position.x, e.position.y, e.position.z);
      m.scale.setScalar(0.6 + 0.4 * (e.weight ?? 1));
      markerGroup.add(m);
    }
  }
}

// ---------------------------------------------------------------- camera

function placeCamera(v: View, immediate = false) {
  const s = sim.scenario;
  const dist = (s.cameraDistance ?? 4.6) / Number(params.get('zoom') ?? 1);
  const f = forwardOf(camYaw);
  const l = leftOf(camYaw);
  const dir = new Vector3();
  switch (v) {
    case 'front':
      dir.copy(f);
      break;
    case 'back':
      dir.copy(f).negate();
      break;
    case 'side':
      dir.copy(l).negate(); // looking at the right side
      break;
    case 'three':
    case 'orbit':
      dir.copy(f).multiplyScalar(0.75).addScaledVector(l, -0.66).normalize();
      dir.y = 0.32;
      break;
    case 'top':
      dir.set(f.x * 0.02, 1, f.z * 0.02);
      break;
  }
  if (v !== 'top' && v !== 'three' && v !== 'orbit') dir.y = 0.06;
  dir.normalize();
  const target = focus.clone();
  if (v === 'top') target.y = 0.5;
  camera.position.copy(target).addScaledVector(dir, v === 'top' ? dist * 1.1 : dist);
  camera.lookAt(target);
  if (v === 'orbit' && immediate) controls.target.copy(target);
}

/** `alpha`: how far the display time is between the previous and the current sim step */
function syncFrame(alpha = 1, dt = 1 / 60) {
  sim.actors.forEach((a, i) => {
    const prev = prevPoses[i];
    for (const k in a.pose) {
      const j = k as keyof Pose;
      if (prev) shown[i][j].lerpVectors(prev[j], a.pose[j], alpha);
      else shown[i][j].copy(a.pose[j]);
    }
    skeletons[i].update(shown[i]);
  });
  const props = sim.run.props();
  drawProps(
    props.map((p, i) => {
      const q = prevProps[i];
      return q && q.kind === p.kind ? { ...p, position: q.position.clone().lerp(p.position, alpha) } : p;
    }),
  );
  drawMarkers(sim.lastInputs);
  env?.update(sim.t);
  const s = sim.scenario;
  // the camera follows the body's travel path (the gait root), not the pelvis: the hips'
  // natural sway and bob shouldn't rock the camera
  const r = sim.actors[0].gait.root;
  const targetFocus = s.focus?.(sim.actors) ?? prevRoot.clone().lerp(new Vector3(r.x, 0.95, r.z), alpha);
  if (capture && !video) {
    focus.copy(targetFocus);
    camYaw = sim.actors[0].gait.root.yaw;
  } else {
    // frame-rate independent smoothing (same feel as the old per-frame 0.08 / 0.04 at 60 Hz)
    focus.lerp(targetFocus, 1 - Math.exp(-5 * dt));
    camYaw += (sim.actors[0].gait.root.yaw - camYaw) * (1 - Math.exp(-2.45 * dt));
  }
  (document.getElementById('scrub') as HTMLInputElement).value = String(Math.round((sim.t / s.duration) * 1000));
  document.getElementById('time')!.textContent = `t = ${sim.t.toFixed(2)} s / ${s.duration} s`;
  caption.textContent = capture && !video ? `${s.id}  t=${sim.t.toFixed(2)}s  ${view}` : '';
}

function resize() {
  const r = canvas.parentElement!.getBoundingClientRect();
  renderer.setSize(r.width, r.height, false);
  overlay.width = r.width * (capture ? 1 : devicePixelRatio);
  overlay.height = r.height * (capture ? 1 : devicePixelRatio);
  camera.aspect = r.width / r.height;
  camera.updateProjectionMatrix();
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(r.width, r.height);
}

const orbitPos = new Vector3();
let orbitInit = false;
function render() {
  // (the cinematic camera starts from the normal shot: keep that shot's own camera state
  // separate, so taking the camera over doesn't disturb the orbit it blends from)
  if (cinematic && orbitInit) {
    camera.position.copy(orbitPos);
    camera.fov = 38;
  }
  if (view === 'orbit') {
    // (per 60 Hz frame; time-based in video mode, where subframes may render faster)
    controls.target.lerp(focus, video ? 1 - Math.pow(0.9, videoDt * 60) : 0.1);
    controls.update();
  } else placeCamera(view);
  if (cinematic) {
    orbitPos.copy(camera.position);
    orbitInit = true;
    const look = view === 'orbit' ? controls.target.clone() : focus.clone();
    cinematic.apply(camera, videoT, videoDt, shown, { pos: camera.position.clone(), look, fov: 38 });
    skeletons[0]?.setHidden(cinematic.hideOwnHead ? [0, 15, 16, 17, 18] : []);
  }
  skeletons.forEach((s) => (s.visible = mode === '3d'));
  if (env) composer.render();
  else renderer.render(scene, camera);
  octx.clearRect(0, 0, overlay.width, overlay.height);
  if (mode === '2d') {
    camera.updateMatrixWorld();
    for (const p of shown) drawOpenPose2D(octx, projectBody25(p, camera, overlay.width, overlay.height));
  }
}

// ---------------------------------------------------------------- UI

function buildUI() {
  const list = document.getElementById('list')!;
  for (const s of SCENARIOS) {
    const b = document.createElement('button');
    b.textContent = s.title;
    b.dataset.id = s.id;
    b.onclick = () => {
      load(s);
      playing = true;
      playBtn.textContent = 'Pause';
    };
    list.appendChild(b);
  }
  const views = document.getElementById('views')!;
  for (const v of VIEWS) {
    const b = document.createElement('button');
    b.textContent = v;
    b.classList.toggle('on', v === view);
    b.onclick = () => {
      view = v;
      views.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      if (v === 'orbit') placeCamera('three', true);
    };
    views.appendChild(b);
  }
  const playBtn = document.getElementById('play') as HTMLButtonElement;
  playBtn.onclick = () => {
    playing = !playing;
    playBtn.textContent = playing ? 'Pause' : 'Play';
  };
  const modeBtn = document.getElementById('mode') as HTMLButtonElement;
  modeBtn.onclick = () => {
    mode = mode === '3d' ? '2d' : '3d';
    modeBtn.textContent = mode === '3d' ? '2D OpenPose' : '3D skeleton';
  };
  (document.getElementById('markers') as HTMLInputElement).onchange = (e) => {
    showMarkers = (e.target as HTMLInputElement).checked;
    drawMarkers(sim.lastInputs);
  };
  const scrub = document.getElementById('scrub') as HTMLInputElement;
  scrub.oninput = () => {
    playing = false;
    playBtn.textContent = 'Play';
    seek((Number(scrub.value) / 1000) * sim.scenario.duration);
  };
}

// ---------------------------------------------------------------- boot

buildUI();
window.addEventListener('resize', resize);
resize();
const initial = SCENARIOS.find((s) => s.id === params.get('example')) ?? SCENARIOS[0];
load(initial);

if (video) {
  let acc = 0;
  if (params.get('cam') === 'cinematic') {
    cinematic = new CinematicCamera();
  }
  (window as unknown as { __frame: (dt: number) => boolean }).__frame = (dt: number) => {
    videoT += dt;
    videoDt = dt;
    acc += dt;
    while (acc >= FIXED_DT - 1e-9) {
      acc -= FIXED_DT;
      step();
    }
    syncFrame(Math.max(0, acc) / FIXED_DT, dt);
    render();
    return sim.t < sim.scenario.duration;
  };
  render();
  (window as unknown as { __ready: boolean }).__ready = true;
} else if (capture) {
  const t = Number(params.get('t') ?? 0);
  // trail=<seconds>: overlay each key joint's path over that window, one dot per frame
  // (zig-zags = jitter, dot spacing = speed, loops at the feet = extra steps)
  const trail = Number(params.get('trail') ?? 0);
  if (trail > 0) {
    sim.advanceTo(Math.max(0, t - trail));
    const joints = ['headCenter', 'leftWrist', 'rightWrist', 'leftKnee', 'rightKnee', 'leftAnkle', 'rightAnkle', 'pelvis'] as const;
    const paths = sim.actors.map(() => joints.map(() => [] as Vector3[]));
    while (sim.t + FIXED_DT * 0.5 < t) {
      sim.step();
      sim.actors.forEach((a, i) => joints.forEach((j, k) => paths[i][k].push(a.pose[j].clone())));
    }
    const dotGeo = new SphereGeometry(0.006, 6, 4);
    const dotMat = new MeshBasicMaterial({ color: 0xffffff });
    for (const actorPaths of paths)
      for (const pts of actorPaths) {
        const line = new Line(new BufferGeometry().setFromPoints(pts), new LineBasicMaterial({ color: 0xbbbbbb }));
        scene.add(line);
        pts.forEach((pt, n) => {
          if (n % 2) return;
          const d = new Mesh(dotGeo, dotMat);
          d.position.copy(pt);
          scene.add(d);
        });
      }
  }
  sim.advanceTo(t);
  syncFrame();
  render();
  (window as unknown as { __ready: boolean }).__ready = true;
} else {
  if (params.has('t')) seek(Number(params.get('t')));
  let last = performance.now();
  let acc = 0;
  const loop = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (playing) {
      acc += dt;
      while (acc >= FIXED_DT) {
        acc -= FIXED_DT;
        step();
        if (sim.t > sim.scenario.duration) load(sim.scenario);
      }
      syncFrame(acc / FIXED_DT, dt);
    }
    render();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
