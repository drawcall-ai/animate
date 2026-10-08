import {
  Color,
  DirectionalLight,
  GridHelper,
  Group,
  HalfFloatType,
  HemisphereLight,
  NeutralToneMapping,
  NoToneMapping,
  PCFSoftShadowMap,
  PerspectiveCamera,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type { CharacterModel } from '@pmndrs/viverse';
import { drawOpenPose2D, projectBody25 } from '@prohuman/openpose';
import { createBoxingArena, type Environment } from './arena';
import { context2d } from '../dom';
import type { Scenario } from '../scenario';

export const FOV = 38;

/**
 * The renderer, scene and camera, and the scenario's surroundings: a plain grid, or an
 * environment (the boxing arena) that is lit, shadowed and tone-mapped (neutral, so the
 * OpenPose colours stay true) with bloom on its lights only (threshold 1: only HDR emitters glow).
 */
export class Stage {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(FOV, 1, 0.05, 100);
  readonly controls: OrbitControls;
  env: Environment | null = null;
  private envFor: Scenario | null = null;
  private readonly grid = new GridHelper(40, 80, 0x2a2a2a, 0x161616);
  /** the plain grid's light: only the characters are lit (everything else is unlit) */
  private readonly light = new Group();
  private readonly composer: EffectComposer;
  private readonly overlay: CanvasRenderingContext2D;

  /** `capture`: a still or video frame — one pixel per CSS pixel, and the drawing buffer kept for screenshots */
  constructor(
    private readonly canvas: HTMLCanvasElement,
    overlay: HTMLCanvasElement,
    private readonly capture: boolean,
  ) {
    this.overlay = context2d(overlay);
    this.renderer = new WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: capture });
    this.renderer.setPixelRatio(capture ? 1 : Math.min(2, devicePixelRatio));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    this.scene.background = new Color(0x000000);
    const sun = new DirectionalLight(0xffffff, 2.2);
    sun.position.set(2, 4, 3);
    this.light.add(new HemisphereLight(0xdde4ff, 0x302820, 1.4), sun);
    this.scene.add(this.grid, this.light);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.composer = new EffectComposer(this.renderer, new WebGLRenderTarget(1, 1, { type: HalfFloatType, samples: 4 }));
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.composer.addPass(new UnrealBloomPass(new Vector2(1, 1), 0.55, 0.55, 1.0));
    this.composer.addPass(new OutputPass());
  }

  /** the scenario's surroundings (kept when it is the scenario already shown) */
  setEnvironment(s: Scenario) {
    if (s === this.envFor) return;
    this.envFor = s;
    if (this.env) {
      this.scene.remove(this.env.group);
      this.env.dispose();
      this.env = null;
    }
    if (s.environment?.kind === 'boxing-arena') {
      this.env = createBoxingArena(new Vector3(...s.environment.center));
      this.scene.add(this.env.group);
    }
    this.grid.visible = !this.env && s.grid !== false;
    this.light.visible = !this.env;
    this.scene.fog = this.env?.fog ?? null;
    this.scene.background = this.env?.background ?? new Color(0x000000);
    this.renderer.toneMapping = this.env ? NeutralToneMapping : NoToneMapping;
  }

  resize() {
    const stage = this.canvas.parentElement;
    if (!stage) throw new Error('the canvas is not on the page');
    const r = stage.getBoundingClientRect();
    const ratio = this.capture ? 1 : devicePixelRatio;
    this.renderer.setSize(r.width, r.height, false);
    this.overlay.canvas.width = r.width * ratio;
    this.overlay.canvas.height = r.height * ratio;
    this.camera.aspect = r.width / r.height;
    this.camera.updateProjectionMatrix();
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(r.width, r.height);
  }

  /** renders the scene; `flat` = these models drawn as 2D OpenPose over it instead */
  draw(flat: readonly CharacterModel[] | null) {
    // (the grid goes along under the camera, its lines where they were: a ride leaves its middle)
    this.grid.position.set(Math.round(this.camera.position.x), 0, Math.round(this.camera.position.z));
    if (this.env) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
    const { canvas } = this.overlay;
    this.overlay.clearRect(0, 0, canvas.width, canvas.height);
    if (!flat) return;
    this.camera.updateMatrixWorld();
    for (const m of flat) drawOpenPose2D(this.overlay, projectBody25(m, this.camera, canvas.width, canvas.height));
  }
}
