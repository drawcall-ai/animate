import { type Box3, BufferGeometry, CanvasTexture, Color, Float32BufferAttribute, Group, type Matrix4, Points, PointsMaterial, Vector3 } from 'three'
import { LineMaterial } from 'three/addons/lines/LineMaterial.js'
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js'

/** how wide a line is drawn and how large a dot (px) */
const WIDE = { line: 2.5, dot: 9 }
/** drawn over everything else in the scene */
const OVER = 1000

/** a round dot */
function disc() {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 32
  const pen = canvas.getContext('2d')
  if (!pen) throw new Error('the page draws no 2d canvas')
  pen.fillStyle = '#fff'
  pen.beginPath()
  pen.arc(16, 16, 13, 0, 2 * Math.PI)
  pen.fill()
  return new CanvasTexture(canvas)
}

/**
 * Lines and dots drawn anew each frame, in the scene, over whatever is in it: what is drawn between one `begin` and
 * the next `show` is what shows.
 */
export class Pen extends Group {
  private readonly lines = new LineSegments2(
    new LineSegmentsGeometry(),
    new LineMaterial({ vertexColors: true, linewidth: WIDE.line, depthTest: false, depthWrite: false, transparent: true }),
  )
  private readonly dots = new Points(
    new BufferGeometry(),
    new PointsMaterial({ vertexColors: true, size: WIDE.dot, sizeAttenuation: false, map: disc(), alphaTest: 0.5, depthTest: false, depthWrite: false, transparent: true }),
  )
  private ends: number[] = []
  private hues: number[] = []
  private spots: number[] = []
  private tints: number[] = []

  constructor() {
    super()
    for (const drawn of [this.lines, this.dots]) {
      drawn.renderOrder = OVER
      drawn.frustumCulled = false
    }
    this.add(this.lines, this.dots)
  }

  begin() {
    this.ends = []
    this.hues = []
    this.spots = []
    this.tints = []
  }

  line(from: Vector3, to: Vector3, color: Color) {
    this.ends.push(from.x, from.y, from.z, to.x, to.y, to.z)
    this.hues.push(color.r, color.g, color.b, color.r, color.g, color.b)
  }

  /** a line through places, one after another */
  through(places: readonly Vector3[], color: Color) {
    for (let k = 1; k < places.length; k++) this.line(places[k - 1], places[k], color)
  }

  /** a diamond about a place, so far out each way: where an end is to be */
  diamond(at: Vector3, far: number, color: Color) {
    const tips = [[far, 0, 0], [-far, 0, 0], [0, 0, far], [0, 0, -far]].map(([x, y, z]) => at.clone().add(new Vector3(x, y, z)))
    const [up, down] = [at.clone().setY(at.y + far), at.clone().setY(at.y - far)]
    tips.forEach((tip, k) => {
      this.line(up, tip, color)
      this.line(down, tip, color)
      this.line(tip, tips[[2, 3, 1, 0][k]], color)
    })
  }

  /** a flat ring about a place, so wide: where a foot is to come down */
  ring(at: Vector3, far: number, color: Color, corners = 16) {
    const round = Array.from({ length: corners + 1 }, (_, k) => {
      const angle = (2 * Math.PI * k) / corners + Math.PI / 4
      return at.clone().add(new Vector3(Math.cos(angle) * far, 0, Math.sin(angle) * far))
    })
    this.through(round, color)
  }

  /** a flat square about a place: where a foot is put, or the hips sent */
  square(at: Vector3, far: number, color: Color) {
    this.ring(at, far * Math.SQRT2, color, 4)
  }

  /** an arrow from a place, so long along a way */
  arrow(from: Vector3, way: Vector3, long: number, color: Color) {
    const along = way.clone().normalize()
    const tip = from.clone().addScaledVector(along, long)
    const back = along.clone().multiplyScalar(-0.12)
    const aside = new Vector3(-along.z, 0, along.x).multiplyScalar(0.06)
    this.line(from, tip, color)
    this.line(tip, tip.clone().add(back).add(aside), color)
    this.line(tip, tip.clone().add(back).sub(aside), color)
  }

  /** the edges of a box, posed so */
  box({ min, max }: Box3, posed: Matrix4, color: Color) {
    const corner = (k: number) =>
      new Vector3(k & 1 ? max.x : min.x, k & 2 ? max.y : min.y, k & 4 ? max.z : min.z).applyMatrix4(posed)
    const corners = Array.from({ length: 8 }, (_, k) => corner(k))
    for (let k = 0; k < 8; k++) for (const bit of [1, 2, 4]) if (!(k & bit)) this.line(corners[k], corners[k | bit], color)
  }

  dot(at: Vector3, color: Color) {
    this.spots.push(at.x, at.y, at.z)
    this.tints.push(color.r, color.g, color.b)
  }

  show() {
    const { lines, dots } = this
    // (a geometry of no segments draws nothing, but still has to be told so)
    lines.visible = this.ends.length > 0
    if (lines.visible) {
      lines.geometry.dispose()
      lines.geometry = new LineSegmentsGeometry().setPositions(this.ends).setColors(this.hues)
    }
    dots.geometry.setAttribute('position', new Float32BufferAttribute(this.spots, 3))
    dots.geometry.setAttribute('color', new Float32BufferAttribute(this.tints, 3))
  }
}

export const tint = (hex: number) => new Color(hex)
