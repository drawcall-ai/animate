/** sizes of a person seen side on (m); a foot is a mass at the ankle */
export const SIZE = { thigh: 0.44, shin: 0.44, ankle: 0.07, foot: 0.2, trunk: 0.56, neck: 0.2, head: 0.11, upper: 0.29, fore: 0.3 }
export const LEG = SIZE.thigh + SIZE.shin
/** how high the hips ride, standing */
export const STAND = SIZE.ankle + LEG - 0.05
/** kilograms, 70 in all: a knee carries the thigh and half the shin, a foot the rest of the leg */
export const KG = { hips: 16, chest: 23, head: 5, elbow: 2, hand: 1.5, knee: 7, foot: 2.5 }
export const BODY = 70
