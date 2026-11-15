import './touch.css'

/** whether the page is played by fingers: it then shows a stick and buttons, and hides the key help */
export const touching = matchMedia('(pointer: coarse)').matches
document.documentElement.classList.toggle('touch', touching)

/** how far the stick is pushed, of its reach, from where it runs */
const RIM = 0.9

/** a key a button presses: its `code` as the keyboard would give it, and whether a tap holds it until the next */
export type Button = { code: string; label: string; toggle?: boolean }

function add<K extends keyof HTMLElementTagNameMap>(parent: HTMLElement, tag: K, name: string) {
  const element = document.createElement(tag)
  element.className = name
  parent.append(element)
  return element
}

/** what is done as a finger lands on an element, moves and lifts */
type Finger = { down?(event: PointerEvent): void; move(event: PointerEvent): void; up?(): void }

/** one finger at a time on `element`, followed until it lifts, even off it */
function follow(element: HTMLElement, on: Finger) {
  let finger: number | undefined
  element.addEventListener('pointerdown', (event) => {
    // (no mouse events made up after it, no focus, no selection)
    event.preventDefault()
    if (finger !== undefined) return
    finger = event.pointerId
    element.setPointerCapture(finger)
    on.down?.(event)
  })
  element.addEventListener('pointermove', (event) => {
    if (event.pointerId === finger) on.move(event)
  })
  const up = (event: PointerEvent) => {
    if (event.pointerId !== finger) return
    finger = undefined
    on.up?.()
  }
  element.addEventListener('pointerup', up)
  element.addEventListener('pointercancel', up)
}

/** the layer of a stick and buttons over the page */
export function controls() {
  return add(document.body, 'div', 'controls')
}

/** a thumb stick at the bottom left: which way it is pushed, x to the right and y up, at most 1 long */
export class Stick {
  x = 0
  y = 0

  constructor(parent: HTMLElement) {
    const base = add(parent, 'div', 'stick')
    const knob = add(base, 'div', 'knob')
    const push = ({ clientX, clientY }: PointerEvent) => {
      const { left, top, width } = base.getBoundingClientRect()
      const reach = width / 2
      const [x, y] = [(clientX - left - reach) / reach, (top + reach - clientY) / reach]
      const far = Math.max(1, Math.hypot(x, y))
      ;[this.x, this.y] = [x / far, y / far]
      knob.style.translate = `${this.x * reach}px ${-this.y * reach}px`
    }
    follow(base, {
      down: push,
      move: push,
      up: () => {
        this.x = this.y = 0
        knob.style.translate = ''
      },
    })
  }

  /** whether it is pushed out to its rim */
  get rim() {
    return Math.hypot(this.x, this.y) >= RIM
  }
}

/** buttons that press and release their keys, laid out from the bottom right leftward and up, the first the largest */
export function buttons(
  parent: HTMLElement,
  list: readonly Button[],
  press: (code: string) => void,
  release: (code: string) => void,
) {
  const pad = add(parent, 'div', 'buttons')
  for (const { code, label, toggle } of list) {
    const button = add(pad, 'button', 'button')
    button.type = 'button'
    button.textContent = label
    follow(button, {
      down: () => {
        const on = !toggle || !button.classList.contains('on')
        button.classList.toggle('on', on)
        if (on) press(code)
        else release(code)
      },
      move: () => {},
      up: () => {
        if (toggle) return
        button.classList.remove('on')
        release(code)
      },
    })
  }
}

/** a drag on `element`, by a finger or the mouse: how far it moved since it last told (px) */
export function drag(element: HTMLElement, moved: (x: number, y: number) => void) {
  let last = { x: 0, y: 0 }
  follow(element, {
    down: ({ clientX, clientY }) => {
      last = { x: clientX, y: clientY }
    },
    move: ({ clientX, clientY }) => {
      moved(clientX - last.x, clientY - last.y)
      last = { x: clientX, y: clientY }
    },
  })
}
