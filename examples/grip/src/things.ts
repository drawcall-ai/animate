// Things to grip: plain three.js meshes. The hand grips whatever triangles a thing has.

import { PROP } from "@drawcall/example-stage"
import { BoxGeometry, type BufferGeometry, CylinderGeometry, Group, Mesh, SphereGeometry, TorusGeometry } from "three"

const thing = (...parts: [BufferGeometry, [number, number, number]?][]) => {
  const group = new Group()
  for (const [geometry, at = [0, 0, 0]] of parts) group.add(new Mesh(geometry, PROP).translateX(at[0]).translateY(at[1]).translateZ(at[2]))
  return group
}

export const THINGS: Record<string, () => Group> = {
  Handle: () => thing([new CylinderGeometry(0.017, 0.017, 0.26, 24)]),
  Ball: () => thing([new SphereGeometry(0.033, 24, 16)]),
  Bottle: () => thing([new CylinderGeometry(0.034, 0.034, 0.2, 24)], [new CylinderGeometry(0.014, 0.02, 0.05, 16), [0, 0.125, 0]]),
  Box: () => thing([new BoxGeometry(0.07, 0.11, 0.05)]),
  "Big box": () => thing([new BoxGeometry(0.3, 0.22, 0.2)]), // too big to close round: the hand lies on it
  Phone: () => thing([new BoxGeometry(0.072, 0.15, 0.009)]),
  Mug: () => thing([new CylinderGeometry(0.04, 0.04, 0.095, 24)], [new TorusGeometry(0.03, 0.007, 8, 16, Math.PI).rotateZ(-Math.PI / 2), [0.04, 0, 0]]),
}
