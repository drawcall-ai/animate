import { RigidBody, type PhysicsWorld } from '@drawcall/physics';
import { Box3, BoxGeometry, Matrix4, Vector3 } from 'three';
import {
  addOffMeshConnection, DEFAULT_QUERY_FILTER, findPath, FindPathResultFlags,
  OffMeshConnectionDirection, StraightPathPointFlags, type NavMesh, type Vec3,
} from 'navcat';
import { generateSoloNavMesh } from 'navcat/blocks';
import { CROUCH_HEIGHT, GRAVITY, HEIGHT, JUMP_SPEED, RADIUS, SPEED } from './movement';

export interface Waypoint {
  position: Vector3;
  /** Take off here; the next waypoint is the landing. */
  jump: boolean;
  crouch: boolean;
}

export interface Route {
  points: Waypoint[];
  complete: boolean;
}

const CLIMB = 0.3, CELL = 0.1, CELL_HEIGHT = 0.05;
const DOWN = new Vector3(0, -1, 0);
const vector = (point: Readonly<Vector3>): Vec3 => [point.x, point.y, point.z];

/** NavCat plans over the same static colliders that the capsule moves against. */
export class Navigation {
  readonly covers: readonly Box3[];
  private readonly mesh: NavMesh;
  private readonly moving: RigidBody[] = [];
  private readonly pose = new Matrix4();

  constructor(private readonly world: PhysicsWorld) {
    const positions: number[] = [], indices: number[] = [], boxes: Box3[] = [], covers: Box3[] = [];
    world.scene.updateMatrixWorld(true);
    world.scene.traverse((body) => {
      if (!(body instanceof RigidBody)) return;
      if (body.bodyType !== 'static') { this.moving.push(body); return; }
      for (const collider of body.getColliders()) {
        const shape = collider.shape();
        if (shape.kind !== 'box') throw new Error('The shooter navigation requires box colliders');
        const geometry = new BoxGeometry(...shape.size).applyMatrix4(collider.matrixWorld);
        const vertices = geometry.getAttribute('position'), triangles = geometry.index;
        if (!triangles) throw new Error('A box collider has no triangles');
        const offset = positions.length / 3;
        for (let i = 0; i < vertices.count; i++) positions.push(vertices.getX(i), vertices.getY(i), vertices.getZ(i));
        for (let i = 0; i < triangles.count; i++) indices.push(offset + triangles.getX(i));
        geometry.computeBoundingBox();
        if (!geometry.boundingBox) throw new Error('A box collider has no bounds');
        const bounds = geometry.boundingBox.clone();
        if (body.name === 'Cover') covers.push(bounds);
        // Jump links need a horizontal landing large enough for the whole capsule.
        const up = new Vector3(0, 1, 0).transformDirection(collider.matrixWorld);
        if (up.y > 0.999) boxes.push(bounds);
        geometry.dispose();
      }
    });
    if (!indices.length) throw new Error('Navigation needs static collision geometry');
    this.covers = covers;
    this.mesh = generateSoloNavMesh({ positions, indices }, {
      cellSize: CELL, cellHeight: CELL_HEIGHT,
      walkableRadiusWorld: RADIUS, walkableRadiusVoxels: Math.ceil(RADIUS / CELL),
      walkableHeightWorld: CROUCH_HEIGHT, walkableHeightVoxels: Math.ceil(CROUCH_HEIGHT / CELL_HEIGHT),
      walkableClimbWorld: CLIMB, walkableClimbVoxels: Math.round(CLIMB / CELL_HEIGHT),
      walkableSlopeAngleDegrees: 45, borderSize: 0,
      minRegionArea: 8, mergeRegionArea: 20, maxSimplificationError: 0.5,
      maxEdgeLength: 12, maxVerticesPerPoly: 6,
      detailSampleDistance: 0.2, detailSampleMaxError: CELL_HEIGHT / 2,
    }).navMesh;
    for (const box of boxes) this.connect(box);
  }

  path(from: Readonly<Vector3>, to: Readonly<Vector3>): Route | null {
    const route = findPath(this.mesh, vector(from), vector(to), [0.5, CLIMB, 0.5], DEFAULT_QUERY_FILTER);
    if (!route.success) return null;
    const end = route.path.at(-1)?.position;
    if (!end) return null;
    return {
      // Nearest-polygon projection can choose the floor below an edge; reaching that floor does not reach the requested ledge.
      complete: (route.flags & FindPathResultFlags.COMPLETE_PATH) !== 0 && Math.abs(end[1] - to.y) <= CLIMB,
      points: route.path.map((point) => {
        const position = new Vector3(...point.position);
        return { position, jump: (point.flags & StraightPathPointFlags.OFFMESH) !== 0, crouch: this.requiresCrouch(position) };
      }),
    };
  }

  /** Check half a metre ahead while following: a straight path may cross a low ceiling between corners. */
  requiresCrouch(position: Readonly<Vector3>): boolean {
    return !this.clear(position, HEIGHT);
  }

  private clear(feet: Readonly<Vector3>, height: number): boolean {
    this.pose.makeTranslation(feet.x, feet.y + height / 2 + 0.01, feet.z);
    return this.world.capsuleContacts({ radius: RADIUS, height: height - 2 * RADIUS }, this.pose, 0,
      { excludeBodies: this.moving }).every((contact) => contact.distance >= -0.005);
  }

  private connect(box: Box3) {
    const size = box.getSize(new Vector3()), top = box.getCenter(new Vector3()).setY(box.max.y);
    if (size.x < 2 * (RADIUS + CELL) || size.z < 2 * (RADIUS + CELL)) return;
    // Only low blocks need a jump. Stairs and ramps already connect through the navmesh.
    if (size.y <= CLIMB || size.y > JUMP_SPEED ** 2 / (-2 * GRAVITY)) return;
    for (const axis of ['x', 'z'] as const) for (const sign of [-1, 1]) {
      const edge = sign > 0 ? box.max[axis] : box.min[axis];
      const from = top.clone(), to = top.clone();
      from[axis] = edge + sign * (RADIUS + 0.2);
      to[axis] = edge - sign * (RADIUS + CELL);
      const ground = this.world.raycast(from.clone().add(new Vector3(0, 0.1, 0)), DOWN, 1.1, { excludeBodies: this.moving });
      if (!ground || ground.normal.y < Math.SQRT1_2) continue;
      from.y = ground.point.y;
      const rise = to.y - from.y, discriminant = JUMP_SPEED ** 2 + 2 * GRAVITY * rise;
      if (rise <= CLIMB || discriminant < 0) continue;
      // Leave room to clear the riser's face while rising, including the capsule's radius.
      const ascending = (-JUMP_SPEED + Math.sqrt(discriminant)) / GRAVITY;
      from[axis] += sign * SPEED.sprint * ascending;
      const takeoff = this.world.raycast(from.clone().setY(top.y + 0.1), DOWN, 1.1, { excludeBodies: this.moving });
      if (!takeoff || takeoff.normal.y < Math.SQRT1_2) continue;
      from.y = takeoff.point.y;
      if (!this.canJump(from, to)) continue;
      addOffMeshConnection(this.mesh, {
        start: vector(from), end: vector(to), radius: 0.2,
        direction: this.canJump(to, from) ? OffMeshConnectionDirection.BIDIRECTIONAL : OffMeshConnectionDirection.START_TO_END,
        flags: 1, area: 0,
      });
    }
  }

  private canJump(from: Vector3, to: Vector3): boolean {
    const discriminant = JUMP_SPEED ** 2 + 2 * GRAVITY * (to.y - from.y);
    if (discriminant < 0) return false;
    const time = (-JUMP_SPEED - Math.sqrt(discriminant)) / GRAVITY;
    if (Math.hypot(to.x - from.x, to.z - from.z) > SPEED.sprint * time) return false;
    const at = new Vector3();
    for (let i = 0; i <= 24; i++) {
      const t = time * i / 24;
      at.lerpVectors(from, to, i / 24).setY(from.y + JUMP_SPEED * t + GRAVITY * t * t / 2);
      if (!this.clear(at, HEIGHT)) return false;
    }
    return true;
  }
}
