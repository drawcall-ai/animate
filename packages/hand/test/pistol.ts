import { BoxGeometry, Group, Mesh } from "three"

// A pistol to grip: the barrel along +z, up is +y, the right of the gun is -x; the origin is the top of the grip's rear.
export function pistol() {
  const part = (size: [number, number, number], shift: [number, number, number] = [0, 0, 0]) => new Mesh(new BoxGeometry(...size).translate(...shift))
  const handle = part([0.03, 0.11, 0.04], [0, -0.055, 0.02])
  handle.rotation.x = 0.2
  const slide = part([0.03, 0.035, 0.18], [0, 0.0175, 0.08])
  const front = part([0.006, 0.03, 0.006])
  front.position.set(0, -0.015, 0.078)
  const under = part([0.006, 0.006, 0.04])
  under.position.set(0, -0.03, 0.058)
  const trigger = part([0.006, 0.022, 0.006])
  trigger.position.set(0, -0.016, 0.052)
  return new Group().add(handle, slide, front, under, trigger)
}
