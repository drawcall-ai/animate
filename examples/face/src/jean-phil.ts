import { CachedRigLoader } from "@drawcall/rig"

// Jean Phil, rigged by @drawcall/rig on a skeleton with the VRM bone names a Humanoid takes, his face with it. His model faces +X
// and is 0.98 units tall: `object` turns him to face +Z and scales him to 1.76 m, his soles on the floor, and the skeleton and
// landmarks are where that places him.

export const jeanPhil = () =>
  new CachedRigLoader().loadAsync({
    object: async (loader) => {
      const { scene } = await loader.loadAsync("jean-phil.glb").catch((error: unknown) => {
        throw new Error("jean-phil.glb did not load: copy it into public/ with `pnpm data <dir>`", { cause: error })
      })
      scene.rotation.y = -Math.PI / 2
      scene.scale.setScalar(1.8)
      scene.position.y = 0.49 * 1.8
      return scene
    },
    skeleton: [
      { name: "hips", position: [0, 0.774, -0.009] },
      { name: "spine", parent: "hips", position: [0, 0.99, -0.0126] },
      { name: "chest", parent: "spine", position: [0, 1.224, -0.027] },
      { name: "neck", parent: "chest", position: [0, 1.422, -0.036] },
      { name: "head", parent: "neck", position: [0, 1.53, -0.009] },
      { name: "head_end", parent: "head", position: [0, 1.764, 0] },
      { name: "leftShoulder", parent: "chest", position: [0.054, 1.395, -0.036] },
      { name: "leftUpperArm", parent: "leftShoulder", position: [0.1764, 1.3536, -0.036] },
      { name: "leftLowerArm", parent: "leftUpperArm", position: [0.3096, 1.107, -0.0216] },
      { name: "leftHand", parent: "leftLowerArm", position: [0.423, 0.9, 0.0144] },
      { name: "leftHand_end", parent: "leftHand", position: [0.486, 0.7308, 0.054] },
      { name: "rightShoulder", parent: "chest", position: [-0.054, 1.395, -0.036] },
      { name: "rightUpperArm", parent: "rightShoulder", position: [-0.1764, 1.3536, -0.036] },
      { name: "rightLowerArm", parent: "rightUpperArm", position: [-0.3096, 1.107, -0.0216] },
      { name: "rightHand", parent: "rightLowerArm", position: [-0.423, 0.9, 0.0144] },
      { name: "rightHand_end", parent: "rightHand", position: [-0.486, 0.7308, 0.054] },
      { name: "leftUpperLeg", parent: "hips", position: [0.099, 0.684, -0.0144] },
      { name: "leftLowerLeg", parent: "leftUpperLeg", position: [0.1026, 0.396, -0.0432] },
      { name: "leftFoot", parent: "leftLowerLeg", position: [0.1026, 0.081, -0.081] },
      { name: "leftToes", parent: "leftFoot", position: [0.1116, 0.018, 0.036] },
      { name: "leftToes_end", parent: "leftToes", position: [0.1116, 0.009, 0.1044] },
      { name: "rightUpperLeg", parent: "hips", position: [-0.099, 0.684, -0.0144] },
      { name: "rightLowerLeg", parent: "rightUpperLeg", position: [-0.1026, 0.396, -0.0432] },
      { name: "rightFoot", parent: "rightLowerLeg", position: [-0.1026, 0.081, -0.081] },
      { name: "rightToes", parent: "rightFoot", position: [-0.1116, 0.018, 0.036] },
      { name: "rightToes_end", parent: "rightToes", position: [-0.1116, 0.009, 0.1044] },
    ],
    resolution: 384,
    face: {
      head: "head",
      landmarks: {
        eyeInnerLeft: [0.0191, 1.6384, 0.0867],
        eyeInnerRight: [-0.0191, 1.6384, 0.0864],
        eyeOuterLeft: [0.0439, 1.6391, 0.0777],
        eyeOuterRight: [-0.0439, 1.6391, 0.0786],
        lidUpperLeft: [0.0315, 1.6429, 0.0886],
        lidUpperRight: [-0.0315, 1.6429, 0.0884],
        lidLowerLeft: [0.0315, 1.6339, 0.0883],
        lidLowerRight: [-0.0315, 1.6339, 0.088],
        browInnerLeft: [0.0144, 1.6497, 0.0975],
        browInnerRight: [-0.0144, 1.6497, 0.0983],
        browMidLeft: [0.0315, 1.6524, 0.0917],
        browMidRight: [-0.0315, 1.6524, 0.0919],
        browOuterLeft: [0.0486, 1.6492, 0.0726],
        browOuterRight: [-0.0486, 1.6492, 0.0743],
        noseWingLeft: [0.0166, 1.6002, 0.1046],
        noseWingRight: [-0.0166, 1.6002, 0.1057],
        cheekLeft: [0.0468, 1.6155, 0.0761],
        cheekRight: [-0.0468, 1.6155, 0.0764],
        jawLeft: [0.0468, 1.5444, 0.0253],
        jawRight: [-0.0468, 1.5444, 0.0267],
        mouthCornerLeft: [0.0243, 1.5705, 0.0986],
        mouthCornerRight: [-0.0243, 1.5705, 0.0977],
        mouthCenter: [0, 1.5723, 0.1042],
        lowerLip: [0, 1.5633, 0.1073],
        chin: [0, 1.539, 0.1013],
        noseTip: [0, 1.6065, 0.1209],
        subnasale: [0, 1.5952, 0.1082],
        noseBridge: [0, 1.6308, 0.1055],
        glabella: [0, 1.6479, 0.1006],
        hairline: [0, 1.6623, 0.0992],
      },
    },
  })
