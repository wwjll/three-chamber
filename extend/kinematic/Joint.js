import {
    AxesHelper,
    Matrix4,
    Object3D,
    Quaternion,
    Vector3,
} from 'three';
import { DOFHelper } from './DOFHelper.js';

const DEFAULT_JOINT_AXIS = new Vector3(0, 0, 1);
const _worldQuat = new Quaternion();

class Joint extends Object3D {

    constructor(options = {}) {

        super();
        this.isJoint = true;
        this.matrixAutoUpdate = false;

        const { minAngle = 0, maxAngle = 360 } = options;
        this.minAngle = minAngle;
        this.maxAngle = maxAngle;

        this.helpers = {};
        this.dh = null;
        this.mdh = null;
        this.mode = 'DH';

    }

    setLimit(minAngle, maxAngle) {
        if (minAngle !== undefined) this.minAngle = minAngle;
        if (maxAngle !== undefined) this.maxAngle = maxAngle;
    }

    applyJointDH(theta, d, a, alpha, thetaOffset = 0) {
        // Standard DH decomposition:
        // full transform is Rz(theta) * Tz(d) * Tx(a) * Rx(alpha),
        // while this joint node applies only Rz(theta) about local Z.

        const m = new Matrix4().makeRotationZ(theta);
        this.matrix.copy(m);

        this.dh = { theta, d, a, alpha, thetaOffset };
        this.mode = 'DH';
    }

    applyJointMDH(theta, d) {
        // Modified DH decomposition:
        // full transform is Rx(alpha) * Tx(a) * Rz(theta) * Tz(d),
        // while this joint node applies Rz(theta) and Tz(d).
        const m = new Matrix4().makeRotationZ(theta);
        m.setPosition(0, 0, d ?? 0);
        this.matrix.copy(m);

        this.mdh = { theta, d };
        this.mode = 'MDH';
    }
    getAutoSize() {
        // Heuristic used by helpers for "relative" sizing.
        // Prefer link offset (child Link) if available.
        const child = this.children.find((c) => c && c.isLink);
        if (child) {
            const e = child.matrix.elements;
            // Matrix4 elements[12..14] are the translation (tx, ty, tz) in column-major order.
            const tx = e[12];
            const ty = e[13];
            const tz = e[14];
            // Use the translation length as a proxy for link length from this joint to its child.
            const len = Math.sqrt(tx * tx + ty * ty + tz * tz);
            if (len > 0) return len;
        }

        if (this.dh) {
            const a = this.dh.a ?? 0;
            const d = this.dh.d ?? 0;
            const len = Math.sqrt(a * a + d * d);
            if (len > 0) return len;
        }

        return 1;
    }

    toggleAxisHelper(visible, options = {}) {
        if (!this.helpers) this.helpers = {};

        const requestedSize = options.size ?? null;
        const fallbackSize = this.getAutoSize() * 0.25;
        const nextSize = requestedSize === null ? fallbackSize : requestedSize;

        if (!this.helpers.axis) {
            this.helpers.axis = new AxesHelper(nextSize);
            this.helpers.axis.userData.size = nextSize;
            this.helpers.axis.visible = false;
            this.add(this.helpers.axis);
        } else if (this.helpers.axis.userData.size !== nextSize) {
            this.helpers.axis.geometry.dispose();
            this.helpers.axis.material.dispose();
            this.remove(this.helpers.axis);
            this.helpers.axis = new AxesHelper(nextSize);
            this.helpers.axis.userData.size = nextSize;
            this.helpers.axis.visible = false;
            this.add(this.helpers.axis);
        }

        if (visible !== undefined) {
            this.helpers.axis.visible = visible;
        } else {
            this.helpers.axis.visible = !this.helpers.axis.visible;
        }

        return this.helpers.axis;
    }

    toggleDOFHelper(visible, options = {}) {
        if (!this.helpers) this.helpers = {};

        if (!this.helpers.DOF) {
            if (visible === false) {
                return null;
            }

            this.helpers.DOF = new DOFHelper(this, options);
            this.helpers.DOF.visible = false;
            this.helpers.DOF.matrixAutoUpdate = false;
            this.add(this.helpers.DOF);
        } else {
            Object.assign(this.helpers.DOF.config, options);
        }

        const nextVisible = visible ?? !this.helpers.DOF.visible;
        this.helpers.DOF.visible = nextVisible;

        if (nextVisible) {
            this.helpers.DOF.update();
            if (this.mode === 'MDH') {
                const rotOnly = new Matrix4().extractRotation(this.matrix).invert();
                this.helpers.DOF.matrix.copy(rotOnly);
            } else {
                this.helpers.DOF.matrix.copy(this.matrix).invert();
            }
            this.helpers.DOF.matrixWorldNeedsUpdate = true;
        }

        return this.helpers.DOF;
    }

    setChild(child) {

        if (child.isLink && this.children.length == 0) {

            this.add(child);
        }

    }

    getWorldPosition(out = new Vector3()) {
        this.updateWorldMatrix(true, false);
        return super.getWorldPosition(out);
    }

    getLocalPosition(out = new Vector3()) {
        const e = this.matrix.elements;
        return out.set(e[12] || 0, e[13] || 0, e[14] || 0);
    }

    getWorldAxis(out = new Vector3()) {
        this.updateWorldMatrix(true, false);
        this.getWorldQuaternion(_worldQuat);
        return out.copy(DEFAULT_JOINT_AXIS).applyQuaternion(_worldQuat).normalize();
    }

    getLocalAxis(out = new Vector3()) {
        // Local axis is always the joint's +Z in its own space.
        return out.copy(DEFAULT_JOINT_AXIS);
    }


}

export { Joint };
