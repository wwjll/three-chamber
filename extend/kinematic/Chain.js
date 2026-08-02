import { BoxGeometry, CylinderGeometry, Group, MathUtils, Matrix4, Mesh, MeshBasicMaterial, Object3D, Quaternion, Vector3 } from 'three';
import { ColliderDesc, RigidBodyDesc } from '@dimforge/rapier3d-compat';
import ChainGenerator from './ChainGenerator.js';

const _INTERACTION_ALL = 0xffff;
const _GRIPPER_GROUP = 1 << 1;
const _encodeInteractionGroups = (memberships, filters) => ((((memberships & 0xffff) << 16) | (filters & 0xffff)) >>> 0);
const _GRIPPER_INTERACTION_GROUPS = _encodeInteractionGroups(_GRIPPER_GROUP, _INTERACTION_ALL);

const _tmpWorldPosition = new Vector3();
const _tmpParentQuat = new Quaternion();
const _tmpWorldQuat = new Quaternion();
const _tmpMountPos = new Vector3();
const _tmpMountQuat = new Quaternion();
const _tmpGripQuatLocal = new Quaternion();
const _tmpInvMountQuat = new Quaternion();
const _tmpMountToGripQuat = new Quaternion();
const _tmpInvMountToGripQuat = new Quaternion();
const _tmpMountToGripPos = new Vector3();
const _tmpRotatedMountToGripPos = new Vector3();
const _graspLocalAxis = new Vector3(1, 0, 0);
const _worldDownAxis = new Vector3(0, -1, 0);

class Actuator {
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

        this.object = new Group();
        this.object.name = 'actuator';
        this.object.matrixAutoUpdate = true;

        this.toolGroup = new Group();
        this.toolGroup.name = 'actuator_tool';
        this.object.add(this.toolGroup);

        this.rigGroup = new Group();
        this.rigGroup.name = 'actuator_rig';
        this.toolGroup.add(this.rigGroup);

        this.modelGroup = new Group();
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

        this._boxGeometry = new BoxGeometry(1, 1, 1);
        this._cylinderGeometry = new CylinderGeometry(1, 1, 1, 20);
        this._physicsColliders = [];
        this._physicsColliderBoxes = [];
        this._customPhysicsColliderBoxes = null;
        this._railCollider = null;
        this._leftJawCollider = null;
        this._rightJawCollider = null;

        this._mountMaterial = new MeshBasicMaterial({ color: this._visualConfig.mountColor });
        this._railMaterial = new MeshBasicMaterial({ color: this._visualConfig.railColor });
        this._jawMaterial = new MeshBasicMaterial({ color: this._visualConfig.jawColor });

        this._build();
        this._initPhysics();
        this._updateShape();
        this.setToolEulerDeg(toolEulerDeg.x, toolEulerDeg.y, toolEulerDeg.z);

        if (this.scene) {
            this.scene.add(this.object);
        }
    }

    _build() {
        this.leftJawRoot = new Group();
        this.leftJawRoot.name = 'actuator_left_jaw_root';
        this.rigGroup.add(this.leftJawRoot);

        this.rightJawRoot = new Group();
        this.rightJawRoot.name = 'actuator_right_jaw_root';
        this.rigGroup.add(this.rightJawRoot);

        this.gripPoint = new Object3D();
        this.gripPoint.name = 'actuator_grip_point';
        this.rigGroup.add(this.gripPoint);

        this.mountMesh = new Mesh(this._cylinderGeometry, this._mountMaterial);
        this.mountMesh.name = 'actuator_mount';
        this.mountMesh.rotation.z = Math.PI * 0.5;
        this.modelGroup.add(this.mountMesh);

        this.railMesh = new Mesh(this._boxGeometry, this._railMaterial);
        this.railMesh.name = 'actuator_rail';
        this.modelGroup.add(this.railMesh);

        this.leftJawMesh = new Mesh(this._boxGeometry, this._jawMaterial);
        this.leftJawMesh.name = 'actuator_left_jaw';
        this.modelGroup.add(this.leftJawMesh);

        this.rightJawMesh = new Mesh(this._boxGeometry, this._jawMaterial);
        this.rightJawMesh.name = 'actuator_right_jaw';
        this.modelGroup.add(this.rightJawMesh);
    }

    _initPhysics() {
        if (!this.physicsWorld || this._physicsBody) return;
        this.toolGroup.updateWorldMatrix(true, false);
        this.toolGroup.getWorldPosition(_tmpWorldPosition);
        this.toolGroup.getWorldQuaternion(_tmpWorldQuat);
        this._physicsBody = this.physicsWorld.createRigidBody(
            RigidBodyDesc.kinematicPositionBased()
                .setTranslation(_tmpWorldPosition.x, _tmpWorldPosition.y, _tmpWorldPosition.z)
                .setRotation({
                    x: _tmpWorldQuat.x,
                    y: _tmpWorldQuat.y,
                    z: _tmpWorldQuat.z,
                    w: _tmpWorldQuat.w,
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

    _applyPhysicsColliderBoxes(boxes) {
        if (!this.physicsWorld || !this._physicsBody) return;
        this._clearPhysicsColliders();
        this._physicsColliderBoxes = boxes.map((box) => ({
            name: box.name ?? 'collider',
            role: box.role ?? 'body',
            halfExtents: { ...box.halfExtents },
            position: { ...box.position },
            quaternion: {
                x: box.quaternion?.x ?? 0,
                y: box.quaternion?.y ?? 0,
                z: box.quaternion?.z ?? 0,
                w: box.quaternion?.w ?? 1,
            },
        }));
        const build = (box) => {
            const { halfExtents, position, quaternion } = box;
            const collider = this.physicsWorld.createCollider(
                ColliderDesc.cuboid(
                    halfExtents.x,
                    halfExtents.y,
                    halfExtents.z,
                )
                    .setTranslation(position.x, position.y, position.z)
                    .setRotation(quaternion)
                    .setFriction(1.0),
                this._physicsBody,
            );
            collider.setCollisionGroups(_GRIPPER_INTERACTION_GROUPS);
            collider.setSolverGroups(_GRIPPER_INTERACTION_GROUPS);
            return collider;
        };
        for (const box of this._physicsColliderBoxes) {
            const collider = build(box);
            this._physicsColliders.push(collider);
            if (box.role === 'rail') {
                this._railCollider = collider;
            } else if (box.role === 'leftJaw') {
                this._leftJawCollider = collider;
            } else if (box.role === 'rightJaw') {
                this._rightJawCollider = collider;
            }
        }
    }

    _rebuildPhysicsColliders(dims) {
        const defaultBoxes = [
            {
                name: 'rail',
                role: 'rail',
                halfExtents: {
                    x: dims.railXSize * 0.5,
                    y: dims.railYSize * 0.5,
                    z: dims.railZSize * 0.5,
                },
                position: { x: dims.railCenterX, y: 0, z: 0 },
                quaternion: { x: 0, y: 0, z: 0, w: 1 },
            },
            {
                name: 'leftJaw',
                role: 'leftJaw',
                halfExtents: {
                    x: dims.jawXSize * 0.5,
                    y: dims.jawYSize * 0.5,
                    z: dims.jawZSize * 0.5,
                },
                position: {
                    x: dims.jawCenterX,
                    y: dims.jawOffset,
                    z: 0,
                },
                quaternion: { x: 0, y: 0, z: 0, w: 1 },
            },
            {
                name: 'rightJaw',
                role: 'rightJaw',
                halfExtents: {
                    x: dims.jawXSize * 0.5,
                    y: dims.jawYSize * 0.5,
                    z: dims.jawZSize * 0.5,
                },
                position: {
                    x: dims.jawCenterX,
                    y: -dims.jawOffset,
                    z: 0,
                },
                quaternion: { x: 0, y: 0, z: 0, w: 1 },
            },
        ];
        this._applyPhysicsColliderBoxes(
            this._customPhysicsColliderBoxes ?? defaultBoxes,
        );
    }

    _updateShape() {
        const r = this._baseSize;
        const cfg = this._visualConfig;

        const mountRadius = r * 0.2 * cfg.mountRadiusScale;
        const mountLength = r * 0.55 * cfg.mountLengthScale;
        const mountCenterX = 0;

        const railXSize = r * 0.18 * cfg.railThicknessScale;
        const railYSize = r * 2.2 * cfg.railLengthScale;
        const railZSize = r * 0.2 * cfg.railDepthScale;
        const railCenterX = mountCenterX + mountLength * 0.5 + railXSize * 0.5;

        const jawXSize = r * 1.25 * cfg.jawLengthScale;
        const jawYSize = r * 0.11 * cfg.jawThicknessScale;
        const jawZSize = r * 0.1 * cfg.jawThicknessScale;
        const jawCenterX = railCenterX + railXSize * 0.5 + jawXSize * 0.5;

        const closedGap = Math.max(r * 0.005, r * 0.04);
        const minOffset = jawYSize * 0.5 + closedGap * 0.5;
        const maxOffset = Math.max(minOffset, railYSize * 0.5 - jawYSize * 0.5);
        const jawOffset = MathUtils.lerp(minOffset, maxOffset, this._openRatio);
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

        const gripX = (jawCenterX + jawXSize * 0.5 - jawYSize * 0.4) * cfg.gripForwardScale;
        this.gripPoint.position.set(gripX, 0, 0);
    }

    setOpenRatio(value = 0.7) {
        this._openRatio = MathUtils.clamp(value, 0, 1);
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

    setPhysicsColliderBoxes(boxes = null) {
        this._customPhysicsColliderBoxes = Array.isArray(boxes)
            ? boxes.map((box) => ({
                name: box.name,
                role: box.role,
                halfExtents: { ...box.halfExtents },
                position: { ...box.position },
                quaternion: {
                    x: box.quaternion?.x ?? 0,
                    y: box.quaternion?.y ?? 0,
                    z: box.quaternion?.z ?? 0,
                    w: box.quaternion?.w ?? 1,
                },
            }))
            : null;
        if (this._customPhysicsColliderBoxes) {
            this._applyPhysicsColliderBoxes(this._customPhysicsColliderBoxes);
        } else {
            this._updateShape();
        }
    }

    getPhysicsColliderBoxes() {
        return this._physicsColliderBoxes;
    }

    syncPhysics() {
        if (!this._physicsBody) return;
        this.toolGroup.updateWorldMatrix(true, false);
        this.toolGroup.getWorldPosition(_tmpWorldPosition);
        this.toolGroup.getWorldQuaternion(_tmpWorldQuat);
        this._physicsBody.setNextKinematicTranslation({
            x: _tmpWorldPosition.x,
            y: _tmpWorldPosition.y,
            z: _tmpWorldPosition.z,
        });
        this._physicsBody.setNextKinematicRotation({
            x: _tmpWorldQuat.x,
            y: _tmpWorldQuat.y,
            z: _tmpWorldQuat.z,
            w: _tmpWorldQuat.w,
        });
    }

    setToolEulerDeg(x = 0, y = 0, z = 0) {
        this.toolGroup.rotation.set(
            MathUtils.degToRad(x),
            MathUtils.degToRad(y),
            MathUtils.degToRad(z),
        );
    }

    getToolEulerDeg(out = { x: 0, y: 0, z: 0 }) {
        out.x = MathUtils.radToDeg(this.toolGroup.rotation.x);
        out.y = MathUtils.radToDeg(this.toolGroup.rotation.y);
        out.z = MathUtils.radToDeg(this.toolGroup.rotation.z);
        return out;
    }

    getWorldPosition(out = new Vector3()) {
        if (this.object.parent) {
            this.object.parent.updateMatrixWorld(true);
        } else {
            this.object.updateMatrixWorld(true, false);
        }
        return this.object.getWorldPosition(out);
    }

    getWorldQuaternion(out = new Quaternion()) {
        if (this.object.parent) {
            this.object.parent.updateMatrixWorld(true);
        } else {
            this.object.updateMatrixWorld(true, false);
        }
        return this.object.getWorldQuaternion(out);
    }

    getGripWorldPosition(out = new Vector3()) {
        this.gripPoint.getWorldPosition(_tmpWorldPosition);
        return out.copy(_tmpWorldPosition);
    }

    getGripWorldQuaternion(out = new Quaternion()) {
        this.gripPoint.getWorldQuaternion(_tmpWorldQuat);
        return out.copy(_tmpWorldQuat);
    }

    getVerticalGripQuaternion(out = new Quaternion()) {
        return out.setFromUnitVectors(_graspLocalAxis, _worldDownAxis);
    }

    computeTopDownPickPose(cubeWorldPosition, cubeSize = 0.06, hover = 0.06, outPosition = new Vector3(), outQuaternion = new Quaternion()) {
        const size = Math.max(0.001, Number.isFinite(cubeSize) ? cubeSize : 0.06);
        const hoverOffset = Number.isFinite(hover) ? hover : 0;
        outPosition.copy(cubeWorldPosition);
        outPosition.y += size * 0.5 + hoverOffset;
        this.getVerticalGripQuaternion(outQuaternion);
        return { position: outPosition, quaternion: outQuaternion };
    }

    computeEndTargetFromGripTarget(gripTargetPosition, gripTargetQuaternion, outEndPosition = new Vector3(), outEndQuaternion = new Quaternion()) {
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
        _tmpInvMountQuat.copy(_tmpMountQuat).invert();
        _tmpMountToGripQuat.copy(_tmpInvMountQuat).multiply(_tmpGripQuatLocal).normalize();
        _tmpMountToGripPos.copy(_tmpWorldPosition).sub(_tmpMountPos).applyQuaternion(_tmpInvMountQuat);
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

class Chain {
    constructor(scene) {
        this.scene = scene;
        this.robotContainer = null;
        this.roboticArm = null;
        this.joints = [];
        this.actuator = null;
        this._actuatorMountNode = null;
        this.randomJointColors = [];
        this.randomJointColorEnabled = false;
    }

    generate(dhParameters, styleParams, baseParams = {}) {
        this._actuatorMountNode = null;
        ChainGenerator.build(this, dhParameters, styleParams, baseParams);
    }

    update(dhParameters, styleParams, baseParams) {
        this.generate(dhParameters, styleParams, baseParams);
    }

    getActuatorNode() {
        if (this._actuatorMountNode) {
            this._actuatorMountNode.updateWorldMatrix(true, false);
            return this._actuatorMountNode;
        }
        if (!this.robotContainer) return null;
        this.robotContainer.updateMatrixWorld(true);

        let root = null;
        this.robotContainer.traverse((node) => {
            if (node && node.isRoot) root = node;
        });
        if (!root) {
            this.robotContainer.traverse((node) => {
                if (!root && node && (node.isJoint || node.isLink)) root = node;
            });
        }
        if (!root) return null;

        let current = root;
        while (true) {
            const next = current.children.find((child) => child && (child.isJoint || child.isLink));
            if (!next) break;
            current = next;
        }

        current.updateWorldMatrix(true, false);
        this._actuatorMountNode = current;
        return current;
    }

    attachActuator(actuator, { preserveWorld = false } = {}) {
        this.actuator = actuator ?? null;
        const mountNode = this.getActuatorNode();
        if (this.actuator?.object && mountNode) {
            mountNode.updateWorldMatrix(true, false);
            if (preserveWorld && this.actuator.object.parent) {
                mountNode.attach(this.actuator.object);
            } else {
                mountNode.add(this.actuator.object);
            }
            this.actuator.object.updateWorldMatrix(true, false);
        }
        return this.actuator;
    }

    detachActuator() {
        this.actuator = null;
    }

    getActuator() {
        return this.actuator;
    }

    openActuator() {
        this.actuator?.open?.();
    }

    getActuatorWorldPosition(out = new Vector3()) {
        const node = this.getActuatorNode();
        if (!node) return null;
        return node.getWorldPosition(out);
    }

    getActuatorWorldQuaternion(out = new Quaternion()) {
        const node = this.getActuatorNode();
        if (!node) return null;
        return node.getWorldQuaternion(out);
    }

    getActuatorLocalPosition(out = new Vector3()) {
        if (!this.robotContainer) return null;
        const worldPos = this.getActuatorWorldPosition(out);
        if (!worldPos) return null;
        return this.robotContainer.worldToLocal(worldPos);
    }

    getActuatorLocalQuaternion(out = new Quaternion()) {
        if (!this.robotContainer) return null;
        const worldQuat = this.getActuatorWorldQuaternion(_tmpWorldQuat);
        if (!worldQuat) return null;
        this.robotContainer.updateMatrixWorld(true);
        this.robotContainer.getWorldQuaternion(_tmpParentQuat);
        return out.copy(_tmpParentQuat).invert().multiply(worldQuat).normalize();
    }

    getEndEffectorNode() {
        return this.getActuatorNode();
    }

    getEndEffectorWorldPosition(out = new Vector3()) {
        return this.getActuatorWorldPosition(out);
    }

    getEndEffectorWorldQuaternion(out = new Quaternion()) {
        return this.getActuatorWorldQuaternion(out);
    }

    getEndEffectorLocalPosition(out = new Vector3()) {
        return this.getActuatorLocalPosition(out);
    }

    getEndEffectorLocalQuaternion(out = new Quaternion()) {
        return this.getActuatorLocalQuaternion(out);
    }

    updateJoint(q = []) {
        if (!this.robotContainer) return;
        const joints = Array.isArray(this.joints) && this.joints.length > 0
            ? this.joints
            : [];

        if (joints.length === 0) {
            this.robotContainer.traverse((node) => {
                if (node && node.isJoint) joints.push(node);
            });
            this.joints = joints;
        }

        for (let i = 0; i < joints.length; i++) {
            const joint = joints[i];
            if (!joint) continue;
            const thetaBase = Number.isFinite(q[i]) ? q[i] : 0;
            const dh = joint.dh || {};
            const thetaOffset = Number.isFinite(dh.thetaOffset) ? dh.thetaOffset : 0;
            const theta = thetaBase + thetaOffset;

            if (joint.mode === 'MDH' || joint.mdh) {
                const d = Number.isFinite(joint.mdh?.d)
                    ? joint.mdh.d
                    : (Number.isFinite(dh.d) ? dh.d : 0);
                const m = new Matrix4().makeRotationZ(theta);
                m.setPosition(0, 0, d);
                joint.matrix.copy(m);
                if (joint.mdh) joint.mdh.theta = theta;
                if (joint.dh) joint.dh.theta = theta;
                joint.mode = 'MDH';
            } else {
                const m = new Matrix4().makeRotationZ(theta);
                joint.matrix.copy(m);
                if (joint.dh) joint.dh.theta = theta;
                joint.mode = 'DH';
            }
        }

        this.robotContainer.updateMatrixWorld(true);
    }

    syncAxis(styleParams = {}, baseOffset = {}) {
        ChainGenerator.syncBase(this, styleParams, baseOffset);
    }
}

export { Actuator, Chain };
