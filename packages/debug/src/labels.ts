import { CanvasTexture, type Color, Group, LinearFilter, Sprite, SpriteMaterial, type Vector3 } from 'three'

/** how tall a label's text is, of the height of the view, and its canvas (px) */
const TALL = { view: 0.032, canvas: 48 }
/** drawn over everything else in the scene, and over the lines */
const OVER = 1001

/** a sprite with a line of text on it, which is drawn anew only when the text or its colour changes */
class Label extends Sprite {
  private said = ''
  private readonly canvas = document.createElement('canvas')

  constructor() {
    super(new SpriteMaterial({ depthTest: false, depthWrite: false, transparent: true, sizeAttenuation: false }))
    this.renderOrder = OVER
    this.center.set(0, 0.5)
    this.material.map = new CanvasTexture(this.canvas)
    this.material.map.minFilter = LinearFilter
  }

  say(text: string, color: Color) {
    const said = `${text}#${color.getHexString()}`
    if (said === this.said) return
    this.said = said
    const { canvas } = this
    const pen = canvas.getContext('2d')
    if (!pen) throw new Error('the page draws no 2d canvas')
    const font = `bold ${TALL.canvas * 0.75}px ui-monospace, monospace`
    pen.font = font
    canvas.width = Math.ceil(pen.measureText(text).width) + 12
    canvas.height = TALL.canvas
    // (resizing the canvas forgets the font)
    pen.font = font
    pen.textBaseline = 'middle'
    pen.lineWidth = 6
    pen.strokeStyle = 'rgba(0,0,0,0.85)'
    pen.strokeText(text, 6, TALL.canvas / 2)
    pen.fillStyle = `#${color.getHexString()}`
    pen.fillText(text, 6, TALL.canvas / 2)
    this.material.map?.dispose()
    const map = new CanvasTexture(canvas)
    map.minFilter = LinearFilter
    this.material.map = map
    this.scale.set((TALL.view * canvas.width) / canvas.height, TALL.view, 1)
  }
}

/** labels written anew each frame: what is said between one `begin` and the next `show` is what shows */
export class Labels extends Group {
  private used = 0
  private readonly pool: Label[] = []

  begin() {
    this.used = 0
  }

  /** a line of text just right of a place, or so many lines below it, to list several at one place */
  say(at: Vector3, text: string, color: Color, row = 0) {
    let label = this.pool[this.used++]
    if (!label) {
      label = new Label()
      this.pool.push(label)
      this.add(label)
    }
    label.position.copy(at)
    label.center.y = 0.5 + 1.1 * row
    label.say(text, color)
  }

  show() {
    this.pool.forEach((label, k) => {
      label.visible = k < this.used
    })
  }
}
