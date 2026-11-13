import { Vector3 } from 'three'

/** a panel standing across his way with a button on it, facing him: where the face of the button is, and whether it is pressed */
export type Panel = { button: Vector3; pressed: boolean }

/** how wide and high the panel is and how thick, how thick the button is: its radius, and how far it stands out of the panel and goes in (m) */
export const PANEL = { wide: 0.5, high: 0.4, thick: 0.03, button: 0.015, proud: 0.012, travel: 0.008 }

/** a panel `ahead` of the origin, its button at chest height in the line of a right hand (m) */
export const panelAt = (ahead: number): Panel => ({ button: new Vector3(-0.2, 1.25, ahead), pressed: false })
