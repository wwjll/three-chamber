/**
 * @fileoverview Procedural rail-guided parallel gripper used as the robot end-effector.
 *
 * This module provides both:
 * 1) visual geometry (mount + rail + two sliding jaws), and
 * 2) a kinematic physics proxy body with colliders for contact queries and grasping.
 *
 * Node hierarchy (functional vs visual):
 * - `object`: root transform attached to the arm end node.
 * - `toolGroup`: orientation frame for tool semantics (kept solver-compatible).
 * - `rigGroup`: functional nodes (`leftJawRoot`, `rightJawRoot`, `gripPoint`).
 * - `modelGroup`: visible meshes (`mountMesh`, `railMesh`, jaw meshes).
 *
 * Coordinate and grasp conventions:
 * - Local +X is tool-forward / grasp-forward axis.
 * - Jaw opening is symmetric around local Y=0.
 * - `gripPoint` is an explicit functional node used by IK/grasp pose utilities.
 *
 * Key module-scope symbols:
 * - `_INTERACTION_ALL`: 16-bit mask with all collision groups enabled.
 * - `_GRIPPER_GROUP`: dedicated collision group for actuator colliders.
 * - `_encodeInteractionGroups`: packs memberships/filter masks into a uint32.
 * - `_GRIPPER_INTERACTION_GROUPS`: shared group mask applied to actuator colliders.
 * - `_tmp*`: reused math temporaries to avoid per-frame allocations.
 *
 * Key instance fields:
 * - `object`, `toolGroup`, `rigGroup`, `modelGroup`: transform/layout roots.
 * - `_physicsBody`: kinematic rigid body synchronized from `toolGroup`.
 * - `_railCollider`, `_leftJawCollider`, `_rightJawCollider`: active colliders.
 * - `_openRatio`: normalized jaw command in [0, 1].
 * - `_jawInnerGap`: current inner gap used by grasp logic.
 */
import * as THREE from 'three';
import * as RAPIER from '@dimforge/rapier3d-compat';

const _INTERACTION_ALL = 0xffff;
const _GRIPPER_GROUP = 1 << 1;
const _encodeInteractionGroups = (memberships, filters) => ((((memberships & 0xffff) << 16) | (filters & 0xffff)) >>> 0);
const _GRIPPER_INTERACTION_GROUPS = _encodeInteractionGroups(_GRIPPER_GROUP, _INTERACTION_ALL);

const _tmpWorldPosition = new THREE.Vector3();
const _tmpWorldQuaternion = new THREE.Quaternion();
const _tmpMountPos = new THREE.Vector3();
const _tmpMountQuat = new THREE.Quaternion();
const _tmpGripQuatLocal = new THREE.Quaternion();
const _tmpInvMountQuat = new THREE.Quaternion();
const _tmpMountToGripQuat = new THREE.Quaternion();
const _tmpInvMountToGripQuat = new THREE.Quaternion();
const _tmpMountToGripPos = new THREE.Vector3();
const _tmpRotatedMountToGripPos = new THREE.Vector3();
const _graspLocalAxis = new THREE.Vector3(1, 0, 0);
const _worldDownAxis = new THREE.Vector3(0, -1, 0);

export class Actuator {
    constructor({
        scene,
        physicsWorld = null,
        color = 0xbfbfbf,
        size = 0.04,
        visualConfig = {},
        toolEulerDeg = { x: 0, y: -90, z: 0 },
    } = {}) {
        this.scene = scene ?? null;
        this.physicsWorld = physicsWorld ?? null;

        this.object = new THREE.Group();
        this.object.name = 'actuator';
        this.object.matrixAutoUpdate = true;

        this.toolGroup = new THREE.Group();
        this.toolGroup.name = 'actuator_tool';
        this.object.add(this.toolGroup);

        this.rigGroup = new THREE.Group();
        this.rigGroup.name = 'actuator_rig';
        this.toolGroup.add(this.rigGroup);

        this.modelGroup = new THREE.Group();
        this.modelGroup.name = 'actuator_model';
        this.toolGroup.add(this.modelGroup);

        this._openRatio = 0.7;
        this._baseSize = size;
        this._jawInnerGap = 0;
        this._visualConfig = {
            mountColor: 0x8f8f8f,
            railColor: 0x5a5a5a,
            jawColor: color,
            mountRadiusScale: 1,
            mountLengthScale: 1,
            railLengthScale: 1,
            railThicknessScale: 1,
            railDepthScale: 1,
            jawLengthScale: 1.5,
            jawThicknessScale: 1.5,
            gripForwardScale: 1,
            ...visualConfig,
        };

        this._boxGeometry = new THREE.BoxGeometry(1, 1, 1);
        this._cylinderGeometry = new THREE.CylinderGeometry(1, 1, 1, 20);
        this._physicsColliders = [];
        this._railCollider = null;
        this._leftJawCollider = null;
        this._rightJawCollider = null;

        this._mountMaterial = new THREE.MeshBasicMaterial({ color: this._visualConfig.mountColor });
        this._railMaterial = new THREE.MeshBasicMaterial({ color: this._visualConfig.railColor });
        this._jawMaterial = new THREE.MeshBasicMaterial({ color: this._visualConfig.jawColor });

        this._build();
        this._initPhysics();
        this._updateShape();
        this.setToolEulerDeg(toolEulerDeg.x, toolEulerDeg.y, toolEulerDeg.z);

        if (this.scene) {
            this.scene.add(this.object);
        }
    }

    _build() {
        this.leftJawRoot = new THREE.Group();
        this.leftJawRoot.name = 'actuator_left_jaw_root';
        this.rigGroup.add(this.leftJawRoot);

        this.rightJawRoot = new THREE.Group();
        this.rightJawRoot.name = 'actuator_right_jaw_root';
        this.rigGroup.add(this.rightJawRoot);

        this.gripPoint = new THREE.Object3D();
        this.gripPoint.name = 'actuator_grip_point';
        this.rigGroup.add(this.gripPoint);

        this.mountMesh = new THREE.Mesh(this._cylinderGeometry, this._mountMaterial);
        this.mountMesh.name = 'actuator_mount';
        this.mountMesh.rotation.z = Math.PI * 0.5;
        this.modelGroup.add(this.mountMesh);

        this.railMesh = new THREE.Mesh(this._boxGeometry, this._railMaterial);
        this.railMesh.name = 'actuator_rail';
        this.modelGroup.add(this.railMesh);

        this.leftJawMesh = new THREE.Mesh(this._boxGeometry, this._jawMaterial);
        this.leftJawMesh.name = 'actuator_left_jaw';
        this.modelGroup.add(this.leftJawMesh);

        this.rightJawMesh = new THREE.Mesh(this._boxGeometry, this._jawMaterial);
        this.rightJawMesh.name = 'actuator_right_jaw';
        this.modelGroup.add(this.rightJawMesh);
    }

    _initPhysics() {
        if (!this.physicsWorld || this._physicsBody) return;
        this.toolGroup.updateWorldMatrix(true, false);
        this.toolGroup.getWorldPosition(_tmpWorldPosition);
        this.toolGroup.getWorldQuaternion(_tmpWorldQuaternion);
        this._physicsBody = this.physicsWorld.createRigidBody(
            RAPIER.RigidBodyDesc.kinematicPositionBased()
                .setTranslation(_tmpWorldPosition.x, _tmpWorldPosition.y, _tmpWorldPosition.z)
                .setRotation({
                    x: _tmpWorldQuaternion.x,
                    y: _tmpWorldQuaternion.y,
                    z: _tmpWorldQuaternion.z,
                    w: _tmpWorldQuaternion.w,
                }),
        );
    }

    _clearPhysicsColliders() {
        if (!this.physicsWorld || !this._physicsColliders) return;
        for (const collider of this._physicsColliders) {
            this.physicsWorld.removeCollider(collider, true);
        }
        this._physicsColliders.length = 0;
        this._railCollider = null;
        this._leftJawCollider = null;
        this._rightJawCollider = null;
    }

    _rebuildPhysicsColliders(dims) {
        if (!this.physicsWorld || !this._physicsBody) return;
        this._clearPhysicsColliders();
        const build = (hx, hy, hz, tx, ty, tz) => {
            const collider = this.physicsWorld.createCollider(
                RAPIER.ColliderDesc.cuboid(hx, hy, hz)
                    .setTranslation(tx, ty, tz)
                    .setFriction(1.0),
                this._physicsBody,
            );
            collider.setCollisionGroups(_GRIPPER_INTERACTION_GROUPS);
            collider.setSolverGroups(_GRIPPER_INTERACTION_GROUPS);
            return collider;
        };
        this._railCollider = build(dims.railXSize * 0.5, dims.railYSize * 0.5, dims.railZSize * 0.5, dims.railCenterX, 0, 0);
        this._leftJawCollider = build(dims.jawXSize * 0.5, dims.jawYSize * 0.5, dims.jawZSize * 0.5, dims.jawCenterX, dims.jawOffset, 0);
        this._rightJawCollider = build(dims.jawXSize * 0.5, dims.jawYSize * 0.5, dims.jawZSize * 0.5, dims.jawCenterX, -dims.jawOffset, 0);
        this._physicsColliders.push(this._railCollider, this._leftJawCollider, this._rightJawCollider);
    }

    _updateShape() {
        const r = this._baseSize;
        const cfg = this._visualConfig;

        const mountRadiusScale = cfg.mountRadiusScale;
        const mountLengthScale = cfg.mountLengthScale;
        const railLengthScale = cfg.railLengthScale;
        const railThicknessScale = cfg.railThicknessScale;
        const railDepthScale = cfg.railDepthScale;
        const jawLengthScale = cfg.jawLengthScale;
        const jawThicknessScale = cfg.jawThicknessScale;
        const gripForwardScale = cfg.gripForwardScale;

        const mountRadius = r * 0.2 * mountRadiusScale;
        const mountLength = r * 0.55 * mountLengthScale;
        const mountCenterX = 0;

        const railXSize = r * 0.18 * railThicknessScale;
        const railYSize = r * 2.2 * railLengthScale;
        const railZSize = r * 0.2 * railDepthScale;
        const railCenterX = mountCenterX + mountLength * 0.5 + railXSize * 0.5; // Rail touches mount.

        const jawXSize = r * 1.25 * jawLengthScale;
        const jawYSize = r * 0.11 * jawThicknessScale;
        const jawZSize = r * 0.1 * jawThicknessScale;
        const jawCenterX = railCenterX + railXSize * 0.5 + jawXSize * 0.5; // Jaw touches rail.

        const closedGap = Math.max(r * 0.005, r * 0.04);
        const minOffset = jawYSize * 0.5 + closedGap * 0.5;
        const maxOffset = Math.max(minOffset, railYSize * 0.5 - jawYSize * 0.5);
        const jawOffset = THREE.MathUtils.lerp(minOffset, maxOffset, this._openRatio);
        this._jawInnerGap = Math.max(0, 2 * jawOffset - jawYSize);

        this.mountMesh.position.set(mountCenterX, 0, 0);
        this.mountMesh.scale.set(mountRadius, mountLength, mountRadius);

        this.railMesh.position.set(railCenterX, 0, 0);
        this.railMesh.scale.set(railXSize, railYSize, railZSize);

        this.leftJawRoot.position.set(jawCenterX, jawOffset, 0);
        this.rightJawRoot.position.set(jawCenterX, -jawOffset, 0);

        this.leftJawMesh.position.copy(this.leftJawRoot.position);
        this.rightJawMesh.position.copy(this.rightJawRoot.position);
        this.leftJawMesh.scale.set(jawXSize, jawYSize, jawZSize);
        this.rightJawMesh.scale.set(jawXSize, jawYSize, jawZSize);

        this._rebuildPhysicsColliders({
            mountRadius,
            mountLength,
            mountCenterX,
            railXSize,
            railYSize,
            railZSize,
            railCenterX,
            jawXSize,
            jawYSize,
            jawZSize,
            jawCenterX,
            jawOffset,
        });

        // Functional center between two jaws near grasp tips.
        const gripX = (jawCenterX + jawXSize * 0.5 - jawYSize * 0.4) * gripForwardScale;
        this.gripPoint.position.set(gripX, 0, 0);
    }

    _applyMaterialColors() {
        this._mountMaterial.color.set(this._visualConfig.mountColor);
        this._railMaterial.color.set(this._visualConfig.railColor);
        this._jawMaterial.color.set(this._visualConfig.jawColor);
    }

    setOpenRatio(value = 0.7) {
        this._openRatio = THREE.MathUtils.clamp(value, 0, 1);
        this._updateShape();
    }

    open() {
        this.setOpenRatio(1);
    }

    close() {
        this.setOpenRatio(0);
    }

    getOpenRatio() {
        return this._openRatio;
    }

    getJawInnerGap() {
        return this._jawInnerGap;
    }

    getPhysicsBody() {
        return this._physicsBody ?? null;
    }

    getJawColliders() {
        return {
            left: this._leftJawCollider ?? null,
            right: this._rightJawCollider ?? null,
        };
    }

    syncPhysics() {
        if (!this._physicsBody) return;
        this.toolGroup.updateWorldMatrix(true, false);
        this.toolGroup.getWorldPosition(_tmpWorldPosition);
        this.toolGroup.getWorldQuaternion(_tmpWorldQuaternion);
        this._physicsBody.setNextKinematicTranslation({
            x: _tmpWorldPosition.x,
            y: _tmpWorldPosition.y,
            z: _tmpWorldPosition.z,
        });
        this._physicsBody.setNextKinematicRotation({
            x: _tmpWorldQuaternion.x,
            y: _tmpWorldQuaternion.y,
            z: _tmpWorldQuaternion.z,
            w: _tmpWorldQuaternion.w,
        });
    }

    attach(target, { preserveWorld = false } = {}) {
        const endNode = target?.isObject3D
            ? target
            : (target?.getActuatorNode?.() ?? target?.getEndEffectorNode?.());
        if (!endNode) return null;

        endNode.updateWorldMatrix(true, false);
        if (preserveWorld && this.object.parent) {
            endNode.attach(this.object);
        } else {
            endNode.add(this.object);
        }

        this.object.updateWorldMatrix(true, false);
        return this.object;
    }

    setToolEulerDeg(x = 0, y = 0, z = 0) {
        this.toolGroup.rotation.set(
            THREE.MathUtils.degToRad(x),
            THREE.MathUtils.degToRad(y),
            THREE.MathUtils.degToRad(z),
        );
    }

    getToolEulerDeg(out = { x: 0, y: 0, z: 0 }) {
        out.x = THREE.MathUtils.radToDeg(this.toolGroup.rotation.x);
        out.y = THREE.MathUtils.radToDeg(this.toolGroup.rotation.y);
        out.z = THREE.MathUtils.radToDeg(this.toolGroup.rotation.z);
        return out;
    }

    getWorldPosition(out = new THREE.Vector3()) {
        if (this.object.parent) {
            this.object.parent.updateMatrixWorld(true);
        } else {
            this.object.updateMatrixWorld(true, false);
        }
        return this.object.getWorldPosition(out);
    }

    getWorldQuaternion(out = new THREE.Quaternion()) {
        if (this.object.parent) {
            this.object.parent.updateMatrixWorld(true);
        } else {
            this.object.updateMatrixWorld(true, false);
        }
        return this.object.getWorldQuaternion(out);
    }

    getGripWorldPosition(out = new THREE.Vector3()) {
        this.gripPoint.getWorldPosition(_tmpWorldPosition);
        return out.copy(_tmpWorldPosition);
    }

    getGripWorldQuaternion(out = new THREE.Quaternion()) {
        this.gripPoint.getWorldQuaternion(_tmpWorldQuaternion);
        return out.copy(_tmpWorldQuaternion);
    }

    getVerticalGripQuaternion(out = new THREE.Quaternion()) {
        return out.setFromUnitVectors(_graspLocalAxis, _worldDownAxis);
    }

    computeTopDownPickPose(cubeWorldPosition, cubeSize = 0.06, hover = 0.06, outPosition = new THREE.Vector3(), outQuaternion = new THREE.Quaternion()) {
        const size = Math.max(0.001, Number.isFinite(cubeSize) ? cubeSize : 0.06);
        const hoverOffset = Number.isFinite(hover) ? hover : 0;
        outPosition.copy(cubeWorldPosition);
        outPosition.y += size * 0.5 + hoverOffset;
        this.getVerticalGripQuaternion(outQuaternion);
        return { position: outPosition, quaternion: outQuaternion };
    }

    computeEndTargetFromGripTarget(gripTargetPosition, gripTargetQuaternion, outEndPosition = new THREE.Vector3(), outEndQuaternion = new THREE.Quaternion()) {
        const endNode = this.object.parent;
        if (!endNode || !gripTargetPosition || !gripTargetQuaternion) {
            if (gripTargetPosition) outEndPosition.copy(gripTargetPosition);
            if (gripTargetQuaternion) outEndQuaternion.copy(gripTargetQuaternion);
            return { position: outEndPosition, quaternion: outEndQuaternion };
        }

        endNode.updateWorldMatrix(true, false);
        endNode.getWorldPosition(_tmpMountPos);
        endNode.getWorldQuaternion(_tmpMountQuat);
        this.getGripWorldPosition(_tmpWorldPosition);
        this.getGripWorldQuaternion(_tmpGripQuatLocal);
        // Current fixed transform in end frame: T_end_to_grip.
        _tmpInvMountQuat.copy(_tmpMountQuat).invert();
        _tmpMountToGripQuat.copy(_tmpInvMountQuat).multiply(_tmpGripQuatLocal).normalize();
        _tmpMountToGripPos.copy(_tmpWorldPosition).sub(_tmpMountPos).applyQuaternion(_tmpInvMountQuat);
        // Convert grip target to end target:
        // T_end_target = T_grip_target * inverse(T_end_to_grip).
        _tmpInvMountToGripQuat.copy(_tmpMountToGripQuat).invert();
        outEndQuaternion.copy(gripTargetQuaternion).multiply(_tmpInvMountToGripQuat).normalize();
        _tmpRotatedMountToGripPos.copy(_tmpMountToGripPos).applyQuaternion(outEndQuaternion);
        outEndPosition.copy(gripTargetPosition).sub(_tmpRotatedMountToGripPos);
        return { position: outEndPosition, quaternion: outEndQuaternion };
    }

    setLocalPosition(localPosition) {
        this.object.position.copy(localPosition);
    }

    setLocalQuaternion(localQuaternion) {
        this.object.quaternion.copy(localQuaternion);
    }

    dispose() {
        if (this.object.parent) {
            this.object.parent.remove(this.object);
        }
        this._boxGeometry.dispose();
        this._cylinderGeometry.dispose();
        this._mountMaterial.dispose();
        this._railMaterial.dispose();
        this._jawMaterial.dispose();
        if (this.physicsWorld && this._physicsBody) {
            this._clearPhysicsColliders();
            this.physicsWorld.removeRigidBody(this._physicsBody);
            this._physicsBody = null;
        }
    }
}

export default Actuator;
