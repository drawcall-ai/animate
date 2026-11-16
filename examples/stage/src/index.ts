// What the examples share: a three.js stage (renderer, camera, orbit, light, ground), a draggable handle, and
// simple flesh on bones. Nothing here knows about the solver.

import {
  BoxGeometry, CapsuleGeometry, Color, DirectionalLight, GridHelper, HemisphereLight, Mesh, MeshStandardMaterial, type Object3D, PerspectiveCamera,
  Scene, SphereGeometry, Vector3, WebGLRenderer,
} from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js'

export const SKIN = new MeshStandardMaterial({ color: 0xc9d2de, roughness: 0.7 })
export const PROP = new MeshStandardMaterial({ color: 0xe0a23c, roughness: 0.6 })

/** A stage filling the window. `frame` runs every animation frame with the seconds since the last one. */
export function stage(frame: (dt: number) => void) {
  const renderer = new WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
  document.body.appendChild(renderer.domElement)
  const scene = new Scene()
  scene.background = new Color(0x14171c)
  const camera = new PerspectiveCamera(45, 1, 0.05, 200)
  camera.position.set(-2.4, 1.7, 3.2)
  const orbit = new OrbitControls(camera, renderer.domElement)
  orbit.target.set(0, 1, 0)
  const sun = new DirectionalLight(0xffffff, 1.8)
  sun.position.set(2, 5, 3)
  const grid = new GridHelper(60, 60, 0x3a424e, 0x262c35)
  scene.add(new HemisphereLight(0xffffff, 0x334455, 1.6), sun, grid)
  const resize = () => {
    renderer.setSize(innerWidth, innerHeight)
    camera.aspect = innerWidth / innerHeight
    camera.updateProjectionMatrix()
  }
  addEventListener('resize', resize)
  resize()
  let last = performance.now()
  renderer.setAnimationLoop(now => {
    frame(Math.min(0.05, Math.max(0, (now - last) / 1000)))
    last = now
    orbit.update()
    renderer.render(scene, camera)
  })
  /** Keep the camera on something that walks away, without changing the viewing angle. */
  const follow = (at: Vector3) => {
    const d = new Vector3(at.x, 1, at.z).sub(orbit.target)
    orbit.target.add(d)
    camera.position.add(d)
    grid.position.set(Math.round(at.x), 0, Math.round(at.z))
  }
  /** Put translate (and optionally rotate) gizmos on an object; orbiting pauses while one is dragged. */
  const drag = (object: Object3D, rotate = false) => {
    for (const mode of rotate ? (['translate', 'rotate'] as const) : (['translate'] as const)) {
      const gizmo = new TransformControls(camera, renderer.domElement)
      gizmo.setMode(mode)
      gizmo.setSize(mode === 'rotate' ? 0.45 : 0.7)
      gizmo.addEventListener('dragging-changed', e => (orbit.enabled = !e.value))
      gizmo.attach(object)
      scene.add(gizmo.getHelper())
    }
  }
  /** One gizmo to point at whatever is being moved or turned; orbiting pauses while it is dragged. */
  const gizmo = () => {
    const control = new TransformControls(camera, renderer.domElement)
    control.setSize(0.6)
    control.addEventListener('dragging-changed', e => (orbit.enabled = !e.value))
    scene.add(control.getHelper())
    return control
  }
  return { scene, camera, orbit, follow, drag, gizmo }
}

/** A small sphere to drag about. */
export function handle(color = 0xe5484d, radius = 0.045): Mesh {
  return new Mesh(new SphereGeometry(radius, 20, 12), new MeshStandardMaterial({ color }))
}

/** A box mesh at a place: the examples' props are made of these. */
export function block(size: [number, number, number], at: [number, number, number] = [0, 0, 0], material = PROP): Mesh {
  const mesh = new Mesh(new BoxGeometry(...size), material)
  mesh.position.set(...at)
  return mesh
}

/** Simple flesh on a skeleton: a capsule from every bone to each bone hanging from it, and a head. */
export function flesh(root: Object3D, radius = 0.045) {
  const up = new Vector3(0, 1, 0)
  root.traverse(bone => {
    if (!(bone as { isBone?: boolean }).isBone) return
    if (bone.name === 'head') bone.add(new Mesh(new SphereGeometry(0.1, 20, 14), SKIN).translateY(0.1), block([0.03, 0.03, 0.04], [0, 0.1, 0.1], SKIN))
    if (bone.name.startsWith('foot')) bone.add(block([0.09, 0.06, 0.24], [0, -0.03, 0.06], SKIN))
    if (bone.name.startsWith('hand')) bone.add(block([0.03, 0.16, 0.08], [0, -0.08, 0], SKIN))
    for (const child of [...bone.children]) {
      if (!(child as { isBone?: boolean }).isBone || child.position.lengthSq() < 1e-6) continue
      const r = /spine|chest|pelvis/.test(bone.name + child.name) ? 2 * radius : radius
      const limb = new Mesh(new CapsuleGeometry(r, child.position.length(), 4, 12), SKIN)
      limb.position.copy(child.position).multiplyScalar(0.5)
      limb.quaternion.setFromUnitVectors(up, child.position.clone().normalize())
      bone.add(limb)
    }
  })
}
