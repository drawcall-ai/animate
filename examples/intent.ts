import { Debug, shown } from '@drawcall/debug'
import type { Object3D } from 'three'
import { touching } from './touch'

/**
 * The debug view of the bodies in a scene, a layer at a time: shown from the start with `?debug` in the address (every
 * layer) or `?debug=plan,gait,hand,body` (those named), and switched on and off by the I key, or by fingers, a button
 * at the top.
 */
export function intent(scene: Object3D) {
  // (the layers `?debug=…` names; the I key shows all of them where none was named)
  const asked = shown(location.search)
  const view = new Debug(scene, asked.size ? asked : shown('?debug'))
  let showing = false
  const show = (on: boolean) => {
    showing = on
    view.visible = on
    if (button) button.style.background = on ? 'rgb(255 225 77 / 70%)' : 'rgb(0 0 0 / 50%)'
  }
  scene.add(view)
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
