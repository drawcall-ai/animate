import {
  Color,
  DirectionalLight,
  GridHelper,
  HemisphereLight,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { drawOpenPose2D, projectBody25 } from '../openpose';
import type { Joints } from '../joints';

export const FOV = 38;

/** The viewer’s renderer, camera, lights and floor grid. */
export class Stage {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(FOV, 1, 0.05, 100);
  readonly controls: OrbitControls;
  private readonly grid = new GridHelper(40, 80, 0x2a2a2a, 0x161616);
  private readonly overlay: CanvasRenderingContext2D;

  /** `capture`: a still or video frame — one pixel per CSS pixel, and the drawing buffer kept for screenshots */
  constructor(
    private readonly canvas: HTMLCanvasElement,
    overlay: HTMLCanvasElement,
    private readonly capture: boolean,
  ) {
    const context = overlay.getContext('2d');
    if (!context) throw new Error('no 2D context');
    this.overlay = context;
    this.renderer = new WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: capture });
    this.renderer.setPixelRatio(capture ? 1 : Math.min(2, devicePixelRatio));
    this.scene.background = new Color(0x000000);
    const sun = new DirectionalLight(0xffffff, 2.2);
    sun.position.set(2, 4, 3);
    this.scene.add(this.grid, new HemisphereLight(0xdde4ff, 0x302820, 1.4), sun);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
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
  }

  /** renders the scene; `flat` = these people drawn as 2D OpenPose over it */
  draw(flat: readonly Joints[] | null) {
    // (the grid goes along under the camera, its lines where they were: a ride leaves its middle)
    this.grid.position.set(Math.round(this.camera.position.x), 0, Math.round(this.camera.position.z));
    this.renderer.render(this.scene, this.camera);
    const { canvas } = this.overlay;
    this.overlay.clearRect(0, 0, canvas.width, canvas.height);
    if (!flat) return;
    for (const joints of flat) drawOpenPose2D(this.overlay, projectBody25(joints, this.camera, canvas.width, canvas.height));
  }
}
