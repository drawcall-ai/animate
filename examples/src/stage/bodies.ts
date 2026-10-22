import { AnimationMixer, Mesh, type Scene } from 'three';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { CharacterModel } from '@pmndrs/viverse';
import type { Posed } from '../joints';
import { OpenPoseSkeleton } from '../openpose';
import type { Skin } from './skin';

/** the BODY_25 keypoints of the head: nose, eyes, ears */
const HEAD_KEYPOINTS = [0, 15, 16, 17, 18];

/**
 * Another instance of viverse's `character` (its scene cloned with the hidden rest copy, bones
 * rebound; geometry and materials shared), under a thin OpenPose skeleton when `overlay` (a mannequin's).
 */
export function instance(character: CharacterModel, overlay: boolean): CharacterModel {
  const scene = clone(character.scene);
  const model = { scene, mixer: new AnimationMixer(scene), currentAnimations: new Map(), height: character.height };
  if (overlay) scene.add(new OpenPoseSkeleton(model, { opacity: 0.55, limbRadius: 0.012, jointRadius: 0.014 }));
  return model;
}

/** the OpenPose skeletons drawn over a model */
const skeletonsOf = (model: CharacterModel) => model.scene.children.filter((c) => c instanceof OpenPoseSkeleton);

/** The actors' character models in the scene. */
export class Bodies {
  private models: CharacterModel[] = [];
  private skins: Skin[] = [];

  constructor(private readonly scene: Scene) {}

  /** replaces the bodies with the actors' and the skins the other bodies wear */
  cast(actors: readonly Posed[], skins: readonly (Skin | null)[] = []) {
    for (const s of this.skins) this.scene.remove(s.scene);
    this.skins = skins.filter((s) => s !== null);
    if (this.skins.length) this.scene.add(...this.skins.map((s) => s.scene));
    for (const m of this.models) {
      this.scene.remove(m.scene);
      // (a mannequin's mesh is shared with the loaded character: only the skeletons are its own)
      for (const s of skeletonsOf(m)) s.dispose();
    }
    this.models = actors.map((a) => a.model);
    this.scene.add(...this.models.map((m) => m.scene));
  }

  /** the models (to project them) */
  get all(): readonly CharacterModel[] {
    return this.models;
  }

  /** the skeletons ground themselves with contact shadows (in lit surroundings) */
  castShadows(on: boolean) {
    for (const m of this.models) for (const s of skeletonsOf(m)) s.traverse((o) => (o.castShadow = on));
    for (const m of [...this.models, ...this.skins]) m.scene.traverse((o) => {
      if (o instanceof Mesh) o.castShadow = on;
    });
  }

  /** the bodies hidden (the 2D overlay draws the poses instead) */
  set hidden(hidden: boolean) {
    for (const m of [...this.models, ...this.skins]) m.scene.visible = !hidden;
  }

  /** hides the first actor's head (a camera inside it, as FPS games do) */
  hideHead(hide: boolean) {
    const first = this.models[0];
    if (!first) return;
    const skeletons = skeletonsOf(first);
    for (const s of skeletons) s.setHidden(hide ? HEAD_KEYPOINTS : []);
    // (a skinned body's head collapses into its neck, as an FPS body's is: the camera is not inside it)
    const head = skeletons.length ? null : first.scene.getObjectByName('head');
    if (head) head.scale.setScalar(hide ? 1e-3 : 1);
  }
}
