import { Body } from '@drawcall/animate'
import { Grips, Intent, legend, shown } from '@drawcall/debug'
import type { Object3D } from 'three'
import { touching } from './touch'

// (`?gait=frames` has the bodies walk and run by the frame gait)
Body.frames = new URLSearchParams(location.search).get('gait') === 'frames'

/**
 * The views of what the bodies in a scene mean to do, with its legend, and of how the hands hold what they hold: shown
 * from the start with `?debug` in the address (`?debug=hand`: the hands' alone), and switched on and off by the I key,
 * or played by fingers, a button at the top.
 */
export function intent(scene: Object3D) {
  const [view, hands, key] = [new Intent(scene), new Grips(scene), legend()]
  // (the layers `?debug=…` names; the I key shows all of them where none was named)
  const asked = shown(location.search)
  const layers = asked.size ? asked : shown('?debug')
  let showing = false
  const show = (on: boolean) => {
    showing = on
    hands.visible = on && layers.has('hand')
    view.visible = on && (layers.has('plan') || layers.has('gait') || layers.has('body'))
    key.hidden = !view.visible
    if (button) button.style.background = on ? 'rgb(255 225 77 / 70%)' : 'rgb(0 0 0 / 50%)'
  }
  scene.add(view, hands)
  document.body.append(key)
  addEventListener('keydown', (event) => {
    if (event.code === 'KeyI' && !event.repeat) show(!showing)
  })
  const button = touching ? document.createElement('button') : undefined
  if (button) {
    button.type = 'button'
    button.textContent = 'plan'
    Object.assign(button.style, {
      position: 'fixed',
      top: '8px',
      left: '50%',
      translate: '-50% 0',
      padding: '8px 14px',
      font: 'inherit',
      color: '#fff',
      border: '1px solid rgb(255 255 255 / 40%)',
      borderRadius: '6px',
      zIndex: '6',
      touchAction: 'none',
    })
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault()
      show(!showing)
    })
    document.body.append(button)
  }
  show(asked.size > 0)
}
