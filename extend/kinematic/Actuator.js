import * as THREE from 'three';

const Y_AXIS = new THREE.Vector3(0, 1, 0);
const _tmpWorldPosition = new THREE.Vector3();
const _tmpWorldQuaternion = new THREE.Quaternion();
const _tmpMid = new THREE.Vector3();
const _tmpDir = new THREE.Vector3();
const _tmpQuat = new THREE.Quaternion();
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
        color = 0xbfbfbf,
        size = 0.04,
        toolEulerDeg = { x: 0, y: -90, z: 0 },
    } = {}) {
        this.scene = scene ?? null;

        this.object = new THREE.Group();
        this.object.name = 'actuator';
        this.object.matrixAutoUpdate = true;

        this.toolGroup = new THREE.Group();
        this.toolGroup.name = 'actuator_tool';
        this.object.add(this.toolGroup);

        this.modelGroup = new THREE.Group();
        this.modelGroup.name = 'actuator_model';
        this.toolGroup.add(this.modelGroup);

        this._openRatio = 0.7;
        this._baseSize = THREE.MathUtils.clamp(Number.isFinite(size) ? size : 0.04, 0.01, 0.2);

        this._sphereGeometry = new THREE.SphereGeometry(1, 20, 16);
        this._segmentGeometry = new THREE.CylinderGeometry(1, 1, 1, 12);
        this._bodyMaterial = new THREE.MeshBasicMaterial({ color: 0x7a7a7a });
        this._linkMaterial = new THREE.MeshBasicMaterial({ color });
        this._jointMaterial = new THREE.MeshBasicMaterial({ color: 0x7a7a7a });

        this._buildMeshes();
        this._updateShape();
        this.setToolEulerDeg(toolEulerDeg.x, toolEulerDeg.y, toolEulerDeg.z);

        if (this.scene) {
            this.scene.add(this.object);
        }
    }

    _buildMeshes() {
        this.body = new THREE.Mesh(this._sphereGeometry, this._bodyMaterial);
        this.modelGroup.add(this.body);

        this.upperSeg1 = new THREE.Mesh(this._segmentGeometry, this._linkMaterial);
        this.upperElbow = new THREE.Mesh(this._sphereGeometry, this._jointMaterial);
        this.upperSeg2 = new THREE.Mesh(this._segmentGeometry, this._linkMaterial);
        this.modelGroup.add(this.upperSeg1, this.upperElbow, this.upperSeg2);

        this.lowerSeg1 = new THREE.Mesh(this._segmentGeometry, this._linkMaterial);
        this.lowerElbow = new THREE.Mesh(this._sphereGeometry, this._jointMaterial);
        this.lowerSeg2 = new THREE.Mesh(this._segmentGeometry, this._linkMaterial);
        this.modelGroup.add(this.lowerSeg1, this.lowerElbow, this.lowerSeg2);

        this.gripPoint = new THREE.Object3D();
        this.modelGroup.add(this.gripPoint);
    }

    _applySegment(mesh, ax, ay, az, bx, by, bz, radius) {
        _tmpMid.set((ax + bx) * 0.5, (ay + by) * 0.5, (az + bz) * 0.5);
        _tmpDir.set(bx - ax, by - ay, bz - az);
        const len = _tmpDir.length();
        if (len < 1e-8) {
            mesh.visible = false;
            return;
        }

        mesh.visible = true;
        _tmpDir.multiplyScalar(1 / len);
        _tmpQuat.setFromUnitVectors(Y_AXIS, _tmpDir);
        mesh.position.copy(_tmpMid);
        mesh.quaternion.copy(_tmpQuat);
        mesh.scale.set(radius, len, radius);
    }

    _updateShape() {
        const r = this._baseSize;
        const segmentRadius = r * 0.15;
        const segmentDiameter = segmentRadius * 2;
        // Core sphere diameter = 2 * claw cylinder diameter.
        const bodyRadius = segmentDiameter;
        const elbowRadius = r * 0.30;
        const seg1Length = r * 1.7;
        const seg2Length = r * 1.5;
        const closedSpread = r * 0.30;
        const openSpread = r * 1.00;
        const spread = THREE.MathUtils.lerp(closedSpread, openSpread, this._openRatio);
        const elbowX = r * 0.65 + seg1Length * 0.55;
        const tipX = elbowX + seg2Length;

        this.body.position.set(0, 0, 0);
        this.body.scale.set(bodyRadius, bodyRadius, bodyRadius);

        const ux = elbowX;
        const uy = spread;
        const lx = elbowX;
        const ly = -spread;
        const tx = tipX;

        this.upperElbow.position.set(ux, uy, 0);
        this.upperElbow.scale.set(elbowRadius, elbowRadius, elbowRadius);
        this.lowerElbow.position.set(lx, ly, 0);
        this.lowerElbow.scale.set(elbowRadius, elbowRadius, elbowRadius);

        this._applySegment(this.upperSeg1, 0, 0, 0, ux, uy, 0, segmentRadius);
        this._applySegment(this.upperSeg2, ux, uy, 0, tx, uy, 0, segmentRadius);
        this._applySegment(this.lowerSeg1, 0, 0, 0, lx, ly, 0, segmentRadius);
        this._applySegment(this.lowerSeg2, lx, ly, 0, tx, ly, 0, segmentRadius);

        this.gripPoint.position.set(tx, 0, 0);
        this.modelGroup.position.set(0, 0, 0);
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

    setBaseSize(size = 0.04) {
        this._baseSize = THREE.MathUtils.clamp(Number.isFinite(size) ? size : 0.04, 0.01, 0.2);
        this._updateShape();
    }

    getBaseSize() {
        return this._baseSize;
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
            THREE.MathUtils.degToRad(Number.isFinite(x) ? x : 0),
            THREE.MathUtils.degToRad(Number.isFinite(y) ? y : 0),
            THREE.MathUtils.degToRad(Number.isFinite(z) ? z : 0),
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
        // Align the actuator local grasp axis (+X) to world down (0,-1,0),
        // so the generated target pose performs a top-down vertical grasp.
        return out.setFromUnitVectors(_graspLocalAxis, _worldDownAxis);
    }

    computeTopDownPickPose(cubeWorldPosition, cubeSize = 0.06, hover = 0.06, outPosition = new THREE.Vector3(), outQuaternion = new THREE.Quaternion()) {
        // Build a top-down grasp target above a cube center:
        // position = cube center + Y * (half size + hover)
        // rotation = local grasp axis aligned with world down.
        const size = Math.max(0.001, Number.isFinite(cubeSize) ? cubeSize : 0.06);
        const hoverOffset = Math.max(0, Number.isFinite(hover) ? hover : 0);
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
        this._sphereGeometry.dispose();
        this._segmentGeometry.dispose();
        this._bodyMaterial.dispose();
        this._linkMaterial.dispose();
        this._jointMaterial.dispose();
    }
}

export default Actuator;
