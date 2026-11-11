import './stage.css'
import { type Figure, SIZE, STEP, type Vec, V, planted } from 'animate-2d'

function element<T extends Element>(id: string, kind: new () => T): T {
  const found = document.getElementById(id)
  if (!(found instanceof kind)) throw new Error(`#${id} is missing from the page`)
  return found
}

/** A side view of the ground from `left` to `right` (m), drawn in the page's text color. */
export class View {
  private context: CanvasRenderingContext2D
  private scale = 1
  private floor = 0
  private left = 0

  constructor(private canvas: HTMLCanvasElement, private aspect: number) {
    const context = canvas.getContext('2d')
    if (!context) throw new Error('this browser has no 2D canvas')
    this.context = context
  }

  begin(left: number, right: number) {
    const { canvas, context } = this
    const ratio = window.devicePixelRatio || 1
    const width = canvas.clientWidth
    const height = Math.round(width * this.aspect)
    canvas.width = Math.round(width * ratio)
    canvas.height = Math.round(height * ratio)
    canvas.style.height = `${height}px`
    this.left = left
    this.scale = width / (right - left)
    this.floor = height - 24
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    context.lineCap = context.lineJoin = 'round'
    context.strokeStyle = context.fillStyle = getComputedStyle(canvas).color
    this.line([V(left, 0), V(right, 0)], 0.01, 0.4)
    for (let m = Math.ceil(left); m < right; m++) this.line([V(m, 0), V(m, -0.06)], 0.01, 0.4)
  }

  private x = (p: Vec) => (p.x - this.left) * this.scale
  private y = (p: Vec) => this.floor - p.y * this.scale

  /** a line through points, `width` m thick */
  line(points: Vec[], width: number, alpha = 1) {
    const { context } = this
    context.globalAlpha = alpha
    context.lineWidth = Math.max(1.5, width * this.scale)
    context.beginPath()
    points.forEach((p, k) => (k ? context.lineTo(this.x(p), this.y(p)) : context.moveTo(this.x(p), this.y(p))))
    context.stroke()
  }

  dot(p: Vec, radius: number, alpha = 1) {
    const { context } = this
    context.globalAlpha = alpha
    context.beginPath()
    context.arc(this.x(p), this.y(p), Math.max(2, radius * this.scale), 0, 7)
    context.fill()
  }

  /** a figure as a stick man: the far arm and leg fainter */
  figure({ hips, chest, head, arms, legs }: Figure) {
    const toe = (foot: Figure['legs'][0]['foot']) => V(foot.p.x + SIZE.foot - 0.05, planted(foot) ? 0.01 : foot.p.y - 0.03)
    this.line([hips.p, legs[1].knee.p, legs[1].foot.p, toe(legs[1].foot)], 0.05, 0.45)
    this.line([chest.p, arms[1].elbow.p, arms[1].hand.p], 0.05, 0.45)
    this.line([hips.p, chest.p], 0.06)
    this.line([hips.p, legs[0].knee.p, legs[0].foot.p, toe(legs[0].foot)], 0.05)
    this.dot(head.p, SIZE.head)
    this.line([chest.p, arms[0].elbow.p, arms[0].hand.p], 0.05)
  }
}

/** Runs a scene in the page: `begin` starts it over, `tick` steps it by STEP, `draw` shows it and returns what to read out. */
export function run(scene: { begin(): void; tick(): void; draw(view: View): string }) {
  const view = new View(element('stage', HTMLCanvasElement), 0.42)
  const speed = element('speed', HTMLSelectElement)
  const readout = element('readout', HTMLPreElement)
  element('again', HTMLButtonElement).addEventListener('click', () => scene.begin())
  let last: number | null = null
  let owed = 0
  const frame = (now: number) => {
    owed += last === null ? 0 : Math.min(0.05, (now - last) / 1000) * Number(speed.value)
    last = now
    for (; owed >= STEP; owed -= STEP) scene.tick()
    readout.textContent = scene.draw(view)
    requestAnimationFrame(frame)
  }
  scene.begin()
  requestAnimationFrame(frame)
}
