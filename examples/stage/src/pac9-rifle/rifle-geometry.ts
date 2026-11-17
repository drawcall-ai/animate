// From the Drawcall market asset pac9-rifle.
// Geometry of the PAC-9 "Longshore" rifle, in metres, muzzle towards -Z (see geometry-tools.ts).
//
// The rifle is not one mesh: its parts are grouped by finish, merged per finish and later given one material each
// (anodized aluminium, parkerized steel, black polymer, rubber, the bolt, the tan magazine and the brass rounds).
// Everything is built from a handful of primitives: bevelled boxes, revolved profiles, side-view plates and
// cross-section extrusions.
import * as THREE from "three"
import type { Rgb } from "./surface-kit"
import { box, extrudeSection, extrudeSide, mergeParts, paintVertexColors, pin, revolve, slotOutline, chamferedRectangle } from "./geometry-tools"

/** Fixed dimensions the rest of the rifle is built around. */
export const RIFLE = {
  /** The muzzle's end, on the barrel's axis. */
  muzzle: [0, 0, -0.531] as [number, number, number],
  /** Height of the red-dot window's centre line. */
  sightY: 0.069,
  /** Outline of the sight window, [x, y] in the front view. */
  sightWindow: [
    [-0.016, 0.057],
    [0.016, 0.057],
    [0.016, 0.0772],
    [0.0122, 0.081],
    [-0.0122, 0.081],
    [-0.016, 0.0772],
  ] as [number, number][],
  /** Where the magazine group sits. */
  magazineOffset: [0, -0.02, -0.0665] as [number, number, number],
  /** Radius of the handguard's flats from the barrel axis. */
  handguardRadius: 0.021,
  /** The receiver and body are narrowed to this fraction of their width below the rail and aft of the handguard. */
  bodySqueeze: 0.86,
}

// Per-finish colour multipliers (the materials hold the real base colours) and the edge-wear amount of each finish.
const ANODIZED: Rgb = [1, 1, 1]
const STEEL: Rgb = [1, 1, 1]
const BRIGHT_STEEL: Rgb = [5.5, 5.5, 5.7] // bare, polished steel details on dark parts
const DARK_STEEL: Rgb = [0.4, 0.4, 0.42]
const POLYMER: Rgb = [1, 1, 1]
const RUBBER: Rgb = [0.022, 0.022, 0.023]
const SIGHT_FRAME: Rgb = [0.012, 0.012, 0.013]
const ANODIZED_WEAR = 9
const STEEL_WEAR = 5
const POLYMER_WEAR = 0.6

export interface RifleParts {
  anodized: THREE.BufferGeometry
  steel: THREE.BufferGeometry
  polymer: THREE.BufferGeometry
  rubber: THREE.BufferGeometry
  bolt: THREE.BufferGeometry
  magazine: THREE.BufferGeometry
  rounds: THREE.BufferGeometry
}

type PartLists = Record<keyof RifleParts, THREE.BufferGeometry[]>

// Profile of one rail tooth (x right, y up): a trapezoid on the top rail.
const RAIL_TOOTH: [number, number][] = [
  [-0.0102, 0.0398],
  [0.0102, 0.0398],
  [0.0106, 0.0408],
  [0.0084, 0.0435],
  [-0.0084, 0.0435],
  [-0.0106, 0.0408],
]
// the same tooth shape, 16 mm lower, for the side and bottom rails
const LOWER_RAIL_TOOTH = RAIL_TOOTH.map(([x, y]): [number, number] => [x, y - 0.016])
/** Trapezoid cross-section of a rail base: narrower at `top`, wider at `bottom` (both heights). */
function railBase(top: number, bottom: number): [number, number][] {
  return [
    [-0.0078, top],
    [0.0078, top],
    [0.0106, bottom],
    [-0.0106, bottom],
  ]
}

// ---------------------------------------------------------------------------------------------------------------
// Receiver, top rail and rear
// ---------------------------------------------------------------------------------------------------------------

function addReceiver(parts: PartLists) {
  const { anodized, steel } = parts
  // Side profile of the receiver (x towards the muzzle, y up), two half-shells with a cut-out each: the ejection
  // port on the right and the charging-handle slot on the left.
  const receiverProfile: [number, number][] = [
    [-0.1, -0.02],
    [0.1, -0.02],
    [0.1, 0.027],
    [0.093, 0.034],
    [-0.088, 0.034],
    [-0.1, 0.024],
  ]
  anodized.push(extrudeSide(receiverProfile, 0, 0.0205, 0.0014, ANODIZED, ANODIZED_WEAR, [chamferedRectangle(-0.012, -0.01, 0.06, 0.012, 0.003)]))
  anodized.push(extrudeSide(receiverProfile, -0.0205, 0, 0.0014, ANODIZED, ANODIZED_WEAR, [slotOutline(0.032, 0.007, 0.112, 0.0075, 4)]))

  // dark liner strips inside the receiver, and the chamber seen through the ejection port
  steel.push(box(0.004, 0.036, 0.19, 0.0005, -0.0135, 0.006, 0, DARK_STEEL))
  steel.push(box(0.004, 0.012, 0.19, 0.0005, 0.0145, 0.022, 0, DARK_STEEL))
  steel.push(box(0.004, 0.008, 0.19, 0.0005, 0.0145, -0.014, 0, DARK_STEEL))
  steel.push(
    revolve(
      [
        [0, 0.058],
        [0.0128, 0.058],
        [0.0128, 0.099],
        [0, 0.099],
      ],
      16,
      [0.8, 0.8, 0.82],
    ),
  )

  // ejection-port deflector, the rear take-down pin and small side bosses
  anodized.push(box(0.009, 0.02, 0.018, 0.003, 0.0225, 0.004, -0.026, ANODIZED, ANODIZED_WEAR, [0, -0.35, 0]))
  anodized.push(
    revolve(
      [
        [0, -0.086],
        [0.0062, -0.086],
        [0.0072, -0.084],
        [0.0072, -0.06],
        [0.0045, -0.057],
        [0, -0.057],
      ],
      12,
      ANODIZED,
      ANODIZED_WEAR,
      0.0215,
      0.012,
    ),
  )
  steel.push(
    revolve(
      [
        [0, -0.094],
        [0.0048, -0.094],
        [0.0055, -0.092],
        [0.0055, -0.086],
        [0, -0.086],
      ],
      12,
      BRIGHT_STEEL,
      0,
      0.0215,
      0.012,
    ),
  )
  anodized.push(box(0.004, 0.012, 0.05, 0.0015, -0.0212, -0.006, -0.055, ANODIZED, ANODIZED_WEAR))
  anodized.push(box(0.004, 0.006, 0.15, 0.0015, -0.0212, 0.0215, 0.012, ANODIZED, ANODIZED_WEAR))
  anodized.push(box(0.003, 0.01, 0.03, 0.001, 0.0212, 0.022, 0.075, ANODIZED, ANODIZED_WEAR))

  // top rail: a base strip with a tooth every centimetre
  anodized.push(extrudeSection(railBase(0.0335, 0.0402), -0.096, 0.397, 0.0005, ANODIZED, 0))
  for (let i = 0; i < 49; i++) {
    const z = i * 0.01 - 0.094
    anodized.push(extrudeSection(RAIL_TOOTH, z, z + 0.0048, 0.0008, ANODIZED, ANODIZED_WEAR))
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Lower receiver: magazine well, trigger, pistol grip
// ---------------------------------------------------------------------------------------------------------------

function addLowerReceiver(parts: PartLists) {
  const { steel, polymer } = parts
  // lower receiver shell, side profile
  polymer.push(
    extrudeSide(
      [
        [-0.1, -0.021],
        [0.099, -0.021],
        [0.101, -0.03],
        [0.098, -0.088],
        [0.036, -0.082],
        [0.031, -0.058],
        [-0.03, -0.058],
        [-0.04, -0.066],
        [-0.078, -0.055],
        [-0.1, -0.044],
      ],
      -0.019,
      0.019,
      0.0014,
      POLYMER,
      POLYMER_WEAR,
    ),
  )
  // sloped rear plate and two thin front/back covers
  polymer.push(box(0.043, 0.01, 0.066, 0.002, 0, -0.0835, 0.0668, POLYMER, POLYMER_WEAR, [-0.095, 0, 0]))
  polymer.push(box(0.0405, 0.052, 0.005, 0.0008, 0, -0.052, 0.0975, POLYMER, POLYMER_WEAR))
  polymer.push(box(0.0405, 0.04, 0.005, 0.0008, 0, -0.048, 0.0345, POLYMER, POLYMER_WEAR))
  // cross pins through the lower receiver
  steel.push(pin(0.0038, 0.0396, 0, -0.031, -0.086, BRIGHT_STEEL, 12))
  steel.push(pin(0.0038, 0.0396, 0, -0.029, 0.087, BRIGHT_STEEL, 12))
  steel.push(pin(0.0022, 0.0392, 0, -0.04, -0.012, BRIGHT_STEEL, 8))
  steel.push(pin(0.0022, 0.0392, 0, -0.032, -0.032, BRIGHT_STEEL, 8))

  // fire-selector levers on both sides (mirrored), with their pivots
  for (const side of [-1, 1]) {
    steel.push(pin(0.0068, 0.004, side * 0.0205, -0.036, -0.048, STEEL, 14, STEEL_WEAR))
    steel.push(box(0.004, 0.006, 0.024, 0.0015, side * 0.0228, -0.036, -0.036, STEEL, STEEL_WEAR, [0.5, 0, 0]))
  }
  // left-side safety lever with its grip ridges
  steel.push(box(0.0045, 0.024, 0.013, 0.0015, -0.0212, -0.03, 0.022, STEEL, STEEL_WEAR))
  for (let i = 0; i < 4; i++) steel.push(box(0.0012, 0.002, 0.012, 0.0005, -0.0238, -0.021 - i * 0.0045, 0.022, STEEL, STEEL_WEAR))
  // magazine release
  steel.push(pin(0.0058, 0.005, 0.0205, -0.042, 0.016, STEEL, 12, STEEL_WEAR))
  polymer.push(box(0.004, 0.004, 0.026, 0.0008, 0.0205, -0.051, 0.016, POLYMER, POLYMER_WEAR))
  polymer.push(box(0.004, 0.02, 0.004, 0.0008, 0.0205, -0.043, 0.027, POLYMER, POLYMER_WEAR))

  // magazine well: a hollow polymer sleeve
  polymer.push(
    extrudeSide(
      [
        [0.033, -0.056],
        [0.033, -0.093],
        [0.024, -0.1005],
        [-0.031, -0.1005],
        [-0.041, -0.09],
        [-0.041, -0.06],
      ],
      -0.0085,
      0.0085,
      0.0008,
      POLYMER,
      POLYMER_WEAR,
      [
        [
          [0.028, -0.059],
          [0.028, -0.091],
          [0.022, -0.096],
          [-0.029, -0.096],
          [-0.036, -0.088],
          [-0.036, -0.061],
        ],
      ],
    ),
  )
  // trigger
  steel.push(
    extrudeSide(
      [
        [-0.006, -0.057],
        [0.004, -0.057],
        [0.003, -0.069],
        [0.0065, -0.079],
        [0.01, -0.086],
        [0.0065, -0.088],
        [0.001, -0.081],
        [-0.004, -0.07],
      ],
      -0.0032,
      0.0032,
      0.0008,
      BRIGHT_STEEL,
      0,
    ),
  )
  // pistol grip
  polymer.push(
    extrudeSide(
      [
        [-0.038, -0.05],
        [-0.045, -0.074],
        [-0.049, -0.086],
        [-0.049, -0.1],
        [-0.054, -0.112],
        [-0.057, -0.13],
        [-0.064, -0.158],
        [-0.11, -0.152],
        [-0.102, -0.112],
        [-0.096, -0.082],
        [-0.095, -0.064],
        [-0.103, -0.046],
        [-0.08, -0.044],
      ],
      -0.0165,
      0.0165,
      0.005,
      POLYMER,
      POLYMER_WEAR,
    ),
  )
  // grip texture: ribs down the front and back of the grip
  for (let i = 0; i < 9; i++) {
    const y = -0.078 - i * 0.0082
    const z = (y + 0.078) * 0.26 - 0.073
    polymer.push(box(0.0345, 0.0028, 0.03, 0.001, 0, y, z, POLYMER, POLYMER_WEAR, [-0.25, 0, 0]))
  }
  for (let i = 0; i < 7; i++) {
    const y = -0.078 - i * 0.01
    const z = (y + 0.078) * 0.14 - 0.098
    polymer.push(box(0.022, 0.0045, 0.006, 0.0015, 0, y, z, POLYMER, POLYMER_WEAR, [-0.14, 0, 0]))
  }
  // grip cap and its screw
  polymer.push(box(0.035, 0.006, 0.05, 0.002, 0, -0.157, -0.087, POLYMER, POLYMER_WEAR, [0.13, 0, 0]))
  steel.push(pin(0.003, 0.034, 0, -0.15, -0.085, BRIGHT_STEEL, 8))
}

// ---------------------------------------------------------------------------------------------------------------
// Handguard (an eight-sided perforated tube with rails) and the lower accessories
// ---------------------------------------------------------------------------------------------------------------

function addHandguard(parts: PartLists) {
  const { anodized, steel, polymer } = parts
  const radius = RIFLE.handguardRadius
  const halfWidth = 0.00885 // each flat is this wide / 2 ...
  const wall = 0.0028 // ... and this thick
  const start = 0.101
  const end = 0.398
  const flat: [number, number][] = [
    [start, -halfWidth],
    [end, -halfWidth],
    [end, halfWidth],
    [start, halfWidth],
  ]
  for (let side = 0; side < 8; side++) {
    // ventilation slots: long ones on three flats, small ones on most of the others
    const slots: [number, number][][] = []
    if (side === 0 || side === 4 || side === 6) for (let i = 0; i < 6; i++) slots.push(slotOutline(0.13 + i * 0.047, 0, 0.032, 0.007, 4))
    else if (side !== 2)
      for (let i = 0; i < 10; i++) {
        const x = 0.124 + i * 0.027
        if (!(side === 3 && x > 0.3)) slots.push(slotOutline(x, 0, 0.013, 0.0052, 3))
      }
    const plate = extrudeSide(flat, radius - wall, radius, 0.0009, ANODIZED, ANODIZED_WEAR, slots)
    plate.rotateZ((side * Math.PI) / 4)
    anodized.push(plate)

    // thin spine between neighbouring flats
    const angle = ((side + 0.5) * Math.PI) / 4
    anodized.push(
      revolve(
        [
          [0, start],
          [0.003, start],
          [0.003, end],
          [0, end],
        ],
        8,
        ANODIZED,
        0,
        Math.cos(angle) * 0.0197,
        Math.sin(angle) * 0.0197,
      ),
    )
  }

  // handguard top rail, barrel nut and muzzle-end cap
  anodized.push(
    extrudeSection(
      [
        [-0.0088, 0.02],
        [0.0088, 0.02],
        [0.0106, 0.029],
        [0.0082, 0.0338],
        [-0.0082, 0.0338],
        [-0.0106, 0.029],
      ],
      0.1012,
      0.3978,
      0.0012,
      ANODIZED,
      ANODIZED_WEAR,
    ),
  )
  anodized.push(
    revolve(
      [
        [0.016, 0.096],
        [0.0238, 0.096],
        [0.0243, 0.0966],
        [0.0243, 0.106],
        [0.0232, 0.1075],
        [0.016, 0.1075],
      ],
      24,
      ANODIZED,
      ANODIZED_WEAR,
    ),
  )
  anodized.push(
    revolve(
      [
        [0.018, 0.3985],
        [0.0224, 0.3985],
        [0.0224, 0.4003],
        [0.0218, 0.401],
        [0.018, 0.401],
        [0.018, 0.3985],
      ],
      8,
      ANODIZED,
      ANODIZED_WEAR,
    ),
  )
  // screws on both sides of the barrel nut
  for (const side of [-1, 1]) for (const z of [0.112, 0.126]) steel.push(pin(0.0024, 0.0024, side * 0.0212, -0.004, z, BRIGHT_STEEL, 10))
  // rivets along the top rail
  for (const z of [0.115, 0.215, 0.3, 0.385])
    for (const side of [-1, 1])
      steel.push(
        revolve(
          [
            [0, -0.0008],
            [0.0017, -0.0008],
            [0.002, -0.0004],
            [0.002, 0.0006],
            [0, 0.0006],
          ],
          8,
          BRIGHT_STEEL,
        )
          .rotateX(Math.PI / 2)
          .translate(side * 0.0098, 0.0312, -z),
      )

  // side rail at 45 degrees: base strip and eight teeth (the rail is modelled on top, then turned)
  const sideRail = [extrudeSection(railBase(0.0206, 0.0242), 0.318, 0.396, 0.0005, ANODIZED, 0)]
  for (let i = 0; i < 8; i++) {
    const z = 0.319 + i * 0.01
    sideRail.push(extrudeSection(LOWER_RAIL_TOOTH, z, z + 0.0048, 0.0005, ANODIZED, ANODIZED_WEAR))
  }
  for (const part of sideRail) {
    part.rotateZ(Math.PI / 4)
    anodized.push(part)
  }
  // bottom rail (turned 180 degrees)
  const bottomRail: THREE.BufferGeometry[] = []
  for (let i = 0; i < 4; i++) {
    const z = 0.352 + i * 0.01
    bottomRail.push(extrudeSection(LOWER_RAIL_TOOTH, z, z + 0.0048, 0.0005, ANODIZED, ANODIZED_WEAR))
  }
  bottomRail.push(extrudeSection(railBase(0.0206, 0.0242), 0.35, 0.392, 0.0005, ANODIZED, 0))
  for (const part of bottomRail) {
    part.rotateZ(Math.PI)
    anodized.push(part)
  }

  // polymer hand stop and the angled foregrip block under the handguard
  polymer.push(
    extrudeSide(
      [
        [0.35, -0.026],
        [0.392, -0.026],
        [0.388, -0.036],
        [0.372, -0.05],
        [0.362, -0.05],
        [0.354, -0.036],
      ],
      -0.011,
      0.011,
      0.003,
      POLYMER,
      POLYMER_WEAR,
    ),
  )
  polymer.push(
    extrudeSide(
      [
        [0.2395, -0.0215],
        [0.2725, -0.0215],
        [0.2725, -0.03],
        [0.27, -0.092],
        [0.2665, -0.0965],
        [0.2455, -0.0975],
        [0.242, -0.093],
        [0.2395, -0.03],
      ],
      -0.014,
      0.014,
      0.0045,
      POLYMER,
      POLYMER_WEAR,
    ),
  )
  for (let i = 0; i < 6; i++) polymer.push(box(0.0292, 0.0022, 0.0315, 0.0008, 0, -0.04 - i * 0.0085, 0.256 - i * 0.0003, POLYMER, POLYMER_WEAR))
  polymer.push(box(0.03, 0.005, 0.04, 0.0015, 0, -0.024, 0.256, POLYMER, POLYMER_WEAR))
  steel.push(pin(0.003, 0.031, 0, -0.025, 0.256, BRIGHT_STEEL, 10))
}

// ---------------------------------------------------------------------------------------------------------------
// Barrel, gas block and muzzle device
// ---------------------------------------------------------------------------------------------------------------

function addBarrel(parts: PartLists) {
  const { steel } = parts
  // barrel with its stepped profile (radius, distance from the origin)
  steel.push(
    revolve(
      [
        [0.0115, 0.095],
        [0.0115, 0.15],
        [0.0095, 0.153],
        [0.0095, 0.285],
        [0.009, 0.288],
        [0.009, 0.322],
        [0.0086, 0.326],
        [0.0086, 0.435],
        [0.0092, 0.437],
        [0.0092, 0.453],
        [0.0075, 0.455],
        [0.0075, 0.461],
      ],
      20,
      STEEL,
      STEEL_WEAR,
    ),
  )
  // gas block, gas tube and the pin that holds it
  steel.push(
    revolve(
      [
        [0.0092, 0.286],
        [0.0135, 0.286],
        [0.0142, 0.2875],
        [0.0142, 0.3165],
        [0.0135, 0.318],
        [0.0092, 0.318],
      ],
      16,
      STEEL,
      STEEL_WEAR,
    ),
  )
  steel.push(box(0.014, 0.009, 0.03, 0.002, 0, 0.0145, 0.302, STEEL, STEEL_WEAR))
  steel.push(
    revolve(
      [
        [0, 0.1],
        [0.0026, 0.1],
        [0.0026, 0.3],
        [0, 0.3],
      ],
      8,
      BRIGHT_STEEL,
      0,
      0,
      0.0172,
    ),
  )
  steel.push(pin(0.002, 0.0145, 0, 0.012, 0.308, BRIGHT_STEEL, 6))
  // muzzle device: body, three grooves, a dark bore with a bright rim
  steel.push(
    revolve(
      [
        [0.0075, 0.459],
        [0.0108, 0.459],
        [0.0116, 0.4605],
        [0.0116, 0.477],
        [0.011, 0.478],
        [0.0052, 0.478],
      ],
      20,
      STEEL,
      STEEL_WEAR,
    ),
  )
  steel.push(
    revolve(
      [
        [0.0052, 0.477],
        [0.0052, 0.517],
      ],
      12,
      DARK_STEEL,
    ),
  )
  for (const z of [0.4865, 0.4965, 0.5065])
    steel.push(
      revolve(
        [
          [0.0052, z - 0.0019],
          [0.011, z - 0.0019],
          [0.0116, z - 0.0012],
          [0.0116, z + 0.0012],
          [0.011, z + 0.0019],
          [0.0052, z + 0.0019],
        ],
        20,
        STEEL,
        STEEL_WEAR,
      ),
    )
  // flash hider tip: the inner bore (radius < 0.0047) is dark grey
  steel.push(
    revolve(
      [
        [0.0052, 0.5145],
        [0.011, 0.5145],
        [0.0116, 0.5155],
        [0.0116, 0.527],
        [0.0102, 0.5305],
        [0.0048, 0.5305],
        [0.0036, 0.526],
        [0.0036, 0.495],
      ],
      20,
      STEEL,
      STEEL_WEAR,
      0,
      0,
      (radius, _distance, color) => (radius < 0.0047 ? [0.25, 0.25, 0.25] : color),
    ),
  )
  for (const side of [-1, 1]) steel.push(box(0.0125, 0.0042, 0.042, 0.0012, 0, side * 0.0096, 0.496, STEEL, STEEL_WEAR))
  for (let i = 0; i < 3; i++) steel.push(pin(0.0016, 0.0236, 0, 0, 0.4675 + i * 0.0035, DARK_STEEL, 6))
}

// ---------------------------------------------------------------------------------------------------------------
// Bolt and charging handle
// ---------------------------------------------------------------------------------------------------------------

function addBolt(parts: PartLists) {
  const { bolt } = parts
  // bolt carrier, with a bright steel colour
  bolt.push(
    revolve(
      [
        [0, -0.058],
        [0.0118, -0.058],
        [0.0124, -0.057],
        [0.0124, -0.01],
        [0.0116, -0.008],
        [0.0116, -0.002],
        [0.0124, 0],
        [0.0124, 0.046],
        [0.0105, 0.048],
        [0.0105, 0.056],
        [0.0062, 0.056],
        [0.0062, 0.06],
        [0, 0.06],
      ],
      16,
      [7, 7, 7.2],
      0,
      0,
      0.001,
    ),
  )
  // cocking serrations on the right side
  for (let i = 0; i < 5; i++) bolt.push(box(0.0015, 0.008, 0.003, 0.0005, 0.0122, 0.001, 0.01 + i * 0.007, [1.2, 1.2, 1.2], 0))
  // charging handle: foot and a knurled knob pointing left
  bolt.push(box(0.012, 0.0055, 0.014, 0.0015, -0.0165, 0.007, 0.078, STEEL, STEEL_WEAR))
  const knob = revolve(
    [
      [0, -0.009],
      [0.0045, -0.009],
      [0.0056, -0.0078],
      [0.0056, -0.003],
      [0.0048, -0.002],
      [0.0048, 0.002],
      [0.0056, 0.003],
      [0.0056, 0.0078],
      [0.0045, 0.009],
      [0, 0.009],
    ],
    12,
    STEEL,
    STEEL_WEAR,
  )
  knob.rotateY(Math.PI / 2)
  knob.translate(-0.031, 0.007, -0.078)
  bolt.push(knob)
}

// ---------------------------------------------------------------------------------------------------------------
// Stock (a telescoping skeleton stock with a rubber butt pad) and sling attachments
// ---------------------------------------------------------------------------------------------------------------

function addStock(parts: PartLists) {
  const { anodized, steel, polymer, rubber } = parts
  // buffer tube behind the receiver, and its end ring
  anodized.push(
    revolve(
      [
        [0, -0.292],
        [0.0142, -0.292],
        [0.0148, -0.2905],
        [0.0148, -0.1],
      ],
      20,
      ANODIZED,
      ANODIZED_WEAR,
    ),
  )
  anodized.push(
    revolve(
      [
        [0.0148, -0.122],
        [0.0185, -0.122],
        [0.0195, -0.1205],
        [0.0195, -0.1115],
        [0.0185, -0.11],
        [0.0148, -0.11],
      ],
      12,
      ANODIZED,
      ANODIZED_WEAR * 1.5,
    ),
  )
  // sling plate behind the receiver with its hole
  steel.push(
    extrudeSection(
      [
        [-0.019, -0.024],
        [0.019, -0.024],
        [0.021, -0.018],
        [0.021, 0.018],
        [0.016, 0.024],
        [-0.016, 0.024],
        [-0.021, 0.018],
        [-0.021, 0.006],
        [-0.036, 0.004],
        [-0.04, -0.002],
        [-0.04, -0.014],
        [-0.034, -0.02],
        [-0.021, -0.02],
      ],
      -0.1095,
      -0.1045,
      0.0008,
      [1.6, 1.6, 1.65],
      STEEL_WEAR,
      [
        [
          [-0.025, -0.014],
          [-0.025, -0.002],
          [-0.033, -0.0005],
          [-0.036, -0.004],
          [-0.036, -0.012],
          [-0.032, -0.016],
        ],
      ],
    ),
  )
  // the stock body (side profile with a cut-out) and its cheek riser
  polymer.push(
    extrudeSide(
      [
        [-0.146, 0.024],
        [-0.3, 0.024],
        [-0.331, 0.014],
        [-0.334, -0.086],
        [-0.318, -0.101],
        [-0.29, -0.096],
        [-0.232, -0.04],
        [-0.146, -0.024],
      ],
      -0.019,
      0.019,
      0.004,
      POLYMER,
      POLYMER_WEAR,
      [
        [
          [-0.262, -0.036],
          [-0.306, -0.036],
          [-0.306, -0.074],
          [-0.292, -0.074],
        ],
      ],
    ),
  )
  polymer.push(box(0.033, 0.016, 0.118, 0.006, 0, 0.031, -0.232, POLYMER, POLYMER_WEAR))
  for (const z of [-0.196, -0.268]) steel.push(pin(0.0032, 0.035, 0, 0.03, z, BRIGHT_STEEL, 8))
  polymer.push(box(0.012, 0.012, 0.04, 0.003, 0, -0.033, -0.19, POLYMER, POLYMER_WEAR, [0.2, 0, 0]))
  // rubber butt pad with horizontal grooves
  rubber.push(box(0.037, 0.12, 0.011, 0.004, 0, -0.04, -0.3395, RUBBER, 0))
  for (let i = 0; i < 9; i++) rubber.push(box(0.031, 0.004, 0.003, 0.001, 0, 0.004 - i * 0.011, -0.3455, RUBBER, 0))
  // sling studs on both sides
  for (const side of [-1, 1]) steel.push(pin(0.0065, 0.003, side * 0.0195, -0.06, -0.318, BRIGHT_STEEL, 12))
}

// ---------------------------------------------------------------------------------------------------------------
// Red-dot sight on the rail
// ---------------------------------------------------------------------------------------------------------------

function addSight(parts: PartLists) {
  const { anodized, steel, rubber } = parts
  const centerY = RIFLE.sightY
  const window = RIFLE.sightWindow
  const scaleAround = (points: [number, number][], factor: number): [number, number][] =>
    points.map(([x, y]) => [x * factor, factor * (y - centerY) + centerY])

  // mounting base on the rail and the hood
  anodized.push(box(0.03, 0.0092, 0.04, 0.0016, 0, 0.048, 0.021, ANODIZED, ANODIZED_WEAR))
  anodized.push(box(0.0045, 0.0085, 0.034, 0.001, -0.0162, 0.0452, 0.021, ANODIZED, ANODIZED_WEAR))
  for (const z of [0.009, 0.033]) {
    steel.push(pin(0.004, 0.0042, -0.02, 0.0452, z, BRIGHT_STEEL, 6))
    steel.push(pin(0.003, 0.0022, 0.016, 0.0452, z, BRIGHT_STEEL, 10))
  }
  // the sight's housing: a shell around the window
  anodized.push(
    extrudeSection(
      [
        [-0.0192, 0.0525],
        [0.0192, 0.0525],
        [0.0192, 0.0788],
        [0.0138, 0.0842],
        [-0.0138, 0.0842],
        [-0.0192, 0.0788],
      ],
      0.008,
      0.034,
      0.001,
      ANODIZED,
      ANODIZED_WEAR,
      [window],
    ),
  )
  // dark rim around the window (a frame between two slightly scaled copies of the window outline)
  rubber.push(extrudeSection(scaleAround(window, 1.004), 0.0078, 0.0342, 0, SIGHT_FRAME, 0, [scaleAround(window, 0.982)]))
  // front hood ring
  anodized.push(
    extrudeSection(
      [
        [-0.0204, 0.06],
        [-0.0204, 0.0792],
        [-0.0143, 0.0854],
        [0.0143, 0.0854],
        [0.0204, 0.0792],
        [0.0204, 0.06],
        [0.0193, 0.06],
        [0.0193, 0.0788],
        [0.0138, 0.0843],
        [-0.0138, 0.0843],
        [-0.0193, 0.0788],
        [-0.0193, 0.06],
      ],
      0.029,
      0.038,
      0.0003,
      ANODIZED,
      ANODIZED_WEAR,
    ),
  )
  // right-hand brightness knob
  steel.push(
    revolve(
      [
        [0, -0.006],
        [0.0052, -0.006],
        [0.0058, -0.0054],
        [0.0058, 0.0036],
        [0.0052, 0.0042],
        [0, 0.0042],
      ],
      14,
      STEEL,
      STEEL_WEAR,
      0,
      0,
    )
      .rotateY(Math.PI / 2)
      .translate(0.0222, 0.0625, -0.021),
  )
  for (const z of [0.0165, 0.0245]) rubber.push(box(0.0022, 0.0055, 0.0055, 0.0009, -0.0196, 0.064, z, RUBBER, 0))
  for (const z of [0.012, 0.03]) for (const side of [-1, 1]) steel.push(pin(0.0016, 0.0012, side * 0.0195, 0.0555, z, BRIGHT_STEEL, 8))
  rubber.push(box(0.009, 0.0026, 0.006, 0.0006, 0, 0.058, 0.0115, SIGHT_FRAME))
  // two small screws on the front of the housing
  for (const [x, y] of [
    [0.0128, 0.0548],
    [-0.0128, 0.0548],
  ])
    steel.push(
      revolve(
        [
          [0, -0.0006],
          [0.0019, -0.0006],
          [0.0022, -0.0002],
          [0.0022, 0.0007],
          [0, 0.0007],
        ],
        10,
        BRIGHT_STEEL,
        0,
        x,
        y,
      )
        .translate(0, 0, -0.0079),
    )
  // windage screw and a tiny emitter cover
  steel.push(
    revolve(
      [
        [0, -0.001],
        [0.0026, -0.001],
        [0.003, -0.0005],
        [0.003, 0.0012],
        [0, 0.0012],
      ],
      12,
      BRIGHT_STEEL,
      0,
      0,
      0,
    )
      .rotateX(Math.PI / 2)
      .translate(0.009, 0.0842, -0.014),
  )
  rubber.push(box(0.0012, 0.0002, 0.0044, 0.00005, 0.009, 0.0855, 0.014, SIGHT_FRAME))
  // thin dark lens retaining plate inside the housing
  rubber.push(extrudeSection(window, 0.0304, 0.0318, 0, SIGHT_FRAME, 0, [scaleAround(window, 0.955)]))
}

// ---------------------------------------------------------------------------------------------------------------
// Flip-up backup sights at both ends of the top rail and a few small details on the receiver
// ---------------------------------------------------------------------------------------------------------------

function addIronSights(parts: PartLists) {
  const { anodized, steel } = parts
  // one flip-up sight at the rear (z = -0.03) and one at the front (z = 0.372); `facing` says which way each is oriented
  for (const [z, facing] of [
    [-0.03, 1],
    [0.372, -1],
  ]) {
    steel.push(box(0.021, 0.0075, 0.03, 0.0015, 0, 0.0472, z, STEEL, STEEL_WEAR))
    steel.push(box(0.0125, 0.004, 0.036, 0.001, 0, 0.0527, z + facing * 0.004, STEEL, STEEL_WEAR))
    steel.push(pin(0.0028, 0.024, 0, 0.0505, z - facing * 0.013, STEEL, 8))
    steel.push(box(0.004, 0.006, 0.006, 0.001, facing * 0.0125, 0.0475, z, STEEL, STEEL_WEAR))
    steel.push(pin(0.0042, 0.0045, -0.0125, 0.0475, z + 0.006, BRIGHT_STEEL, 8))
  }
  // adjustment dial and its detents
  steel.push(
    revolve(
      [
        [0.0016, -0.0012],
        [0.0034, -0.0012],
        [0.0038, -0.0008],
        [0.0038, 0.0008],
        [0.0034, 0.0012],
        [0.0016, 0.0012],
        [0.0016, -0.0012],
      ],
      12,
      STEEL,
      STEEL_WEAR,
      0,
      0,
    )
      .rotateX(Math.PI / 2)
      .translate(0, 0.0553, 0.016),
  )
  steel.push(pin(0.0048, 0.005, 0.015, 0.049, -0.036, STEEL, 12, STEEL_WEAR))
  for (let i = 0; i < 6; i++)
    steel.push(box(0.0044, 0.001, 0.001, 0.0003, 0.015, 0.049 + Math.sin(i * 1.047) * 0.0046, Math.cos(i * 1.047) * 0.0046 - 0.036, STEEL, STEEL_WEAR))
  // small block and cover plate on the rail behind the sight
  anodized.push(box(0.016, 0.005, 0.02, 0.0012, 0, 0.0355, -0.098, ANODIZED, ANODIZED_WEAR))
  steel.push(box(0.01, 0.003, 0.008, 0.0008, 0, 0.0392, -0.0985, STEEL, STEEL_WEAR))
  for (let i = 0; i < 4; i++) steel.push(box(0.0092, 0.0008, 0.001, 0.0003, 0, 0.0409, -0.0958 - i * 0.0018, STEEL, STEEL_WEAR))
}

// ---------------------------------------------------------------------------------------------------------------
// Weapon light at 10:30 on the handguard, its mount, a rubber rail cover and the cable between them
// ---------------------------------------------------------------------------------------------------------------

function addWeaponLight(parts: PartLists) {
  const { steel, rubber } = parts
  const centerX = -0.0267
  const centerY = 0.0267
  // light body: a stepped cylinder with a bezel, lens and cooling rings, on an axis offset from the barrel
  steel.push(
    revolve(
      [
        [0, 0.308],
        [0.0095, 0.308],
        [0.0108, 0.3095],
        [0.0108, 0.322],
        [0.0118, 0.323],
        [0.0118, 0.378],
        [0.0128, 0.38],
        [0.0142, 0.382],
        [0.0142, 0.404],
        [0.0136, 0.406],
        [0.0142, 0.408],
        [0.0142, 0.412],
        [0.0128, 0.4135],
        [0.0118, 0.4135],
        [0.0112, 0.409],
      ],
      18,
      STEEL,
      STEEL_WEAR,
      centerX,
      centerY,
    ),
  )
  steel.push(
    revolve(
      [
        [0.0112, 0.409],
        [0, 0.409],
      ],
      18,
      [0.35, 0.4, 0.45],
      0,
      centerX,
      centerY,
    ),
  )
  for (let i = 0; i < 5; i++)
    steel.push(
      revolve(
        [
          [0.0118, 0.33 + i * 0.008],
          [0.0124, 0.3305 + i * 0.008],
          [0.0124, 0.3335 + i * 0.008],
          [0.0118, 0.334 + i * 0.008],
        ],
        18,
        STEEL,
        STEEL_WEAR,
        centerX,
        centerY,
      ),
    )
  // mount block and screw, turned 45 degrees about the barrel axis
  const mount = box(0.02, 0.008, 0.04, 0.0012, 0, 0.028, 0.352, STEEL, STEEL_WEAR)
  mount.rotateZ(Math.PI / 4)
  steel.push(mount)
  const mountScrew = pin(0.004, 0.006, 0.0135, 0.028, 0.352, BRIGHT_STEEL, 8)
  mountScrew.rotateZ(Math.PI / 4)
  steel.push(mountScrew)

  // rubber: a pressure switch and a cable from the light back along the handguard
  rubber.push(box(0.0185, 0.0065, 0.07, 0.0025, 0, 0.0468, 0.214, RUBBER, 0))
  for (let i = 0; i < 6; i++) rubber.push(box(0.014, 0.0012, 0.004, 0.0005, 0, 0.0503, 0.192 + i * 0.009, RUBBER, 0))
  const cablePath = new THREE.CatmullRomCurve3(
    [
      [centerX, centerY, -0.308],
      [centerX - 0.001, centerY + 0.002, -0.296],
      [-0.0265, 0.0235, -0.284],
      [-0.0255, 0.0215, -0.272],
      [-0.0235, 0.027, -0.262],
      [-0.016, 0.04, -0.256],
      [-0.007, 0.0465, -0.252],
      [-0.002, 0.047, -0.247],
    ].map(([x, y, z]) => new THREE.Vector3(x, y, z)),
    false,
    "catmullrom",
    0,
  )
  const cableSegments = Math.min(400, Math.max(2, Math.ceil(cablePath.getLength() / 0.08)))
  const cable = new THREE.TubeGeometry(cablePath, cableSegments, 0.0018, 6, false)
  paintVertexColors(cable, RUBBER, 0)
  rubber.push(cable)
  // two small black clips on the cable
  for (const [x, y, z] of [
    [-0.0262, 0.0228, 0.28],
    [-0.0242, 0.0255, 0.265],
  ]) {
    const clip = box(0.0065, 0.0026, 0.0035, 0.0008, 0, 0, 0, [0.03, 0.03, 0.03], 0)
    clip.rotateZ(Math.PI / 4)
    clip.translate(x, y, -z)
    rubber.push(clip)
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Magazine (tan polymer with a curved body) and the rounds visible in its mouth
// ---------------------------------------------------------------------------------------------------------------

function addMagazine(parts: PartLists) {
  const { magazine, rounds } = parts
  const white: Rgb = [1, 1, 1]
  const curve = (x: number) => 1.5 * Math.pow(Math.max(0, x - 0.07), 2) // how far the magazine bends forward
  const slope = (x: number) => 3 * Math.max(0, x - 0.07)
  const length = 0.212
  const steps = 12

  // curved magazine body: a side outline that bends, extruded between its walls
  const outline: [number, number][] = []
  for (let i = 0; i <= steps; i++) {
    const x = ((length + 0.004) * i) / steps - 0.004
    outline.push([curve(x) + 0.0298, -x])
  }
  for (let i = steps; i >= 0; i--) {
    const x = ((length + 0.004) * i) / steps - 0.004
    outline.push([curve(x) - 0.0298, -x])
  }
  magazine.push(extrudeSide(outline, -0.0113, 0.0113, 0.002, white, 0.25))
  // horizontal ribs down the front, tilted with the curve
  for (let i = 0; i < 8; i++) {
    const y = 0.082 + i * 0.0155
    magazine.push(box(0.0246, 0.0058, 0.05, 0.0016, 0, -y, curve(y), white, 0.3, [Math.atan(slope(y)), 0, 0]))
  }
  // vertical grip ribs
  for (let i = 0; i < 10; i++) {
    const y = 0.078 + i * 0.013
    magazine.push(box(0.012, 0.011, 0.004, 0.001, 0, -y, curve(y) + 0.0302, white, 0.3, [Math.atan(slope(y)), 0, 0]))
  }
  // base plate and its pull tab, plus two side lugs
  magazine.push(box(0.027, 0.009, 0.068, 0.003, 0, -length - 0.003, curve(length) + 0.001, white, 0.3, [Math.atan(slope(length)), 0, 0]))
  magazine.push(box(0.01, 0.004, 0.012, 0.001, 0, -length - 0.008, curve(length) - 0.01, [0.6, 0.6, 0.6], 0, [Math.atan(slope(length)), 0, 0]))
  magazine.push(box(0.003, 0.006, 0.04, 0.001, -0.0085, 0.0045, 0.004, white, 0.3))
  magazine.push(box(0.003, 0.006, 0.04, 0.001, 0.0085, 0.0045, 0.004, white, 0.3))

  // rounds in the mouth of the magazine: a brass casing, a copper-coloured bullet and a dark base
  rounds.push(
    revolve(
      [
        [0, -0.02],
        [0.004, -0.02],
        [0.0047, -0.019],
        [0.0047, 0.01],
        [0.0034, 0.014],
        [0.0034, 0.018],
      ],
      12,
      [1, 1, 1],
      0,
      0.002,
      0.0062,
    ),
  )
  rounds.push(
    revolve(
      [
        [0.003, 0.018],
        [0.0029, 0.024],
        [0.0022, 0.03],
        [0.001, 0.0345],
        [0, 0.0352],
      ],
      12,
      [1.25, 0.72, 0.5],
      0,
      0.002,
      0.0062,
    ),
  )
  rounds.push(
    revolve(
      [
        [0, -0.02],
        [0.004, -0.02],
        [0.0047, -0.019],
        [0.0047, 0.01],
      ],
      10,
      [0.8, 0.8, 0.8],
      0,
      -0.003,
      0.0005,
    ),
  )
}

// ---------------------------------------------------------------------------------------------------------------

/** Builds every rifle part and merges them into one geometry per finish. */
export function buildRifleParts(): RifleParts {
  const lists: PartLists = { anodized: [], steel: [], polymer: [], rubber: [], bolt: [], magazine: [], rounds: [] }
  addReceiver(lists)
  addLowerReceiver(lists)
  addHandguard(lists)
  addBarrel(lists)
  addStock(lists)
  addSight(lists)
  addIronSights(lists)
  addWeaponLight(lists)
  addBolt(lists)
  addMagazine(lists)

  const merged: RifleParts = {
    anodized: mergeParts(lists.anodized),
    steel: mergeParts(lists.steel),
    polymer: mergeParts(lists.polymer),
    rubber: mergeParts(lists.rubber),
    bolt: mergeParts(lists.bolt),
    magazine: mergeParts(lists.magazine),
    rounds: mergeParts(lists.rounds),
  }
  // the receiver and everything around the magwell is narrower than its profile says: squeeze the lower half
  for (const geometry of [merged.anodized, merged.steel, merged.polymer, merged.rubber, merged.bolt]) {
    const position = geometry.attributes.position
    for (let i = 0; i < position.count; i++) {
      if (position.getZ(i) > -0.1002 && position.getY(i) < 0.0341) position.setX(i, position.getX(i) * RIFLE.bodySqueeze)
    }
  }
  return merged
}
