import { Intent, legend } from '@drawcall/debug'
import type { Object3D } from 'three'
import { touching } from './touch'

/**
 * The view of what the bodies in a scene mean to do, drawn over it with its legend: shown from the start with `?debug`
 * in the address, and switched on and off by the I key, or played by fingers, a button at the top.
 */
export function intent(scene: Object3D) {
  const view = new Intent(scene)
  const key = legend()
  const show = (on: boolean) => {
    view.visible = on
    key.hidden = !on
    if (button) button.style.background = on ? 'rgb(255 225 77 / 70%)' : 'rgb(0 0 0 / 50%)'
  }
  scene.add(view)
  document.body.append(key)
  addEventListener('keydown', (event) => {
    if (event.code === 'KeyI' && !event.repeat) show(!view.visible)
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
      show(!view.visible)
    })
    document.body.append(button)
  }
  show(new URLSearchParams(location.search).has('debug'))
}
