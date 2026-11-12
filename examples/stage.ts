import './stage.css'
import {
  Color,
  DirectionalLight,
  GridHelper,
  HemisphereLight,
  type Object3D,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from 'three'

function element<T extends Element>(id: string, kind: new () => T): T {
  const found = document.getElementById(id)
  if (!(found instanceof kind)) throw new Error(`#${id} is missing from the page`)
  return found
}

/** Shows a scene from the side, +z to the right: `begin` starts it over and returns what to show, `update` advances it, `readout` says what happened. */
export function run(stage: { begin(): Object3D; update(delta: number): void; readout(): string }) {
  const canvas = element('stage', HTMLCanvasElement)
  const speed = element('speed', HTMLSelectElement)
  const readout = element('readout', HTMLPreElement)
  const renderer = new WebGLRenderer({ canvas, antialias: true })
  const camera = new PerspectiveCamera(30, 1 / 0.42)
  camera.position.set(-5.5, 1.3, 1.2)
  camera.lookAt(0, 1, 1.2)
  const scene = new Scene()
  scene.background = new Color(0x202020)
  const sun = new DirectionalLight(0xffffff, 2.5)
  sun.position.set(-3, 5, -2)
  scene.add(new HemisphereLight(0xffffff, 0x404040, 1.5), sun, new GridHelper(40, 40, 0x808080, 0x404040))
  let shown = stage.begin()
  scene.add(shown)
  element('again', HTMLButtonElement).addEventListener('click', () => {
    scene.remove(shown)
    shown = stage.begin()
    scene.add(shown)
  })
  let last: number | undefined
  renderer.setAnimationLoop((now) => {
    stage.update(last === undefined ? 0 : Math.min(0.05, (now - last) / 1000) * Number(speed.value))
    last = now
    renderer.setPixelRatio(window.devicePixelRatio)
    renderer.setSize(canvas.clientWidth, Math.round(canvas.clientWidth * 0.42), false)
    renderer.render(scene, camera)
    readout.textContent = stage.readout()
  })
}
