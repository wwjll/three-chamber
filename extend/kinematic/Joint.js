import {
    AxesHelper,
    Matrix4,
} from 'three';
import { Frame } from './Frame.js';
import { DOFHelper } from './Helper.js';

export class Joint extends Frame {

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

    // Rz(theta) * Tz(d) * Tx(a) * Rx(alpha), Standard DH: Joint applies only the revolute rotation about its local Z.
    applyJointDH(theta, d, a, alpha) {

        const m = new Matrix4().makeRotationZ(theta);
        this.matrix.copy(m);

        this.dh = { theta, d, a, alpha };
        this.mode = 'DH';
    }

    // Rx(alpha) * Tx(a) * Rz(theta) * Tz(d), Modified DH: Rz(theta) * Tz(d) applys to Joint in MDH
    applyJointMDH(theta, d) {
        const m = new Matrix4().makeRotationZ(theta);
        m.setPosition(0, 0, Number.isFinite(d) ? d : 0);
        this.matrix.copy(m);

        this.mdh = { theta, d };
        this.mode = 'MDH';
    }
    getAutoSize() {
        // Heuristic used by helpers for "relative" sizing.
        // Prefer link offset (child Link) if available.
        const child = this.children.find((c) => c && c.isLink);
        if (child && child.matrix && Array.isArray(child.matrix.elements)) {
            const e = child.matrix.elements;
            // Matrix4 elements[12..14] are the translation (tx, ty, tz) in column-major order.
            const tx = e[12] || 0;
            const ty = e[13] || 0;
            const tz = e[14] || 0;
            // Use the translation length as a proxy for link length from this joint to its child.
            const len = Math.sqrt(tx * tx + ty * ty + tz * tz);
            if (Number.isFinite(len) && len > 0) return len;
        }

        if (this.dh && (Number.isFinite(this.dh.a) || Number.isFinite(this.dh.d))) {
            const a = Number.isFinite(this.dh.a) ? this.dh.a : 0;
            const d = Number.isFinite(this.dh.d) ? this.dh.d : 0;
            const len = Math.sqrt(a * a + d * d);
            if (Number.isFinite(len) && len > 0) return len;
        }

        return 1;
    }

    toggleAxisHelper(visible, options = {}) {
        if (!this.helpers) this.helpers = {};

        const requestedSize = Number.isFinite(options.size) ? options.size : null;
        const fallbackSize = this.getAutoSize() * 0.25;
        const nextSize = requestedSize === null ? fallbackSize : requestedSize;

        if (!this.helpers.axis) {
            this.helpers.axis = new AxesHelper(nextSize);
            this.helpers.axis.userData.size = nextSize;
            this.helpers.axis.visible = false;
            this.add(this.helpers.axis);
        } else if (Number.isFinite(nextSize) && this.helpers.axis.userData.size !== nextSize) {
            this.helpers.axis.geometry.dispose();
            this.helpers.axis.material.dispose();
            this.remove(this.helpers.axis);
            this.helpers.axis = new AxesHelper(nextSize);
            this.helpers.axis.userData.size = nextSize;
            this.helpers.axis.visible = false;
            this.add(this.helpers.axis);
        }

        if (typeof visible === 'boolean') {
            this.helpers.axis.visible = visible;
        } else {
            this.helpers.axis.visible = !this.helpers.axis.visible;
        }

        return this.helpers.axis;
    }

    toggleDOFHelper(visible, options = {}) {
        if (!this.helpers) this.helpers = {};

        if (!this.helpers.DOF) {
            if (typeof visible === 'boolean' && visible === false) {
                return null;
            }

            this.helpers.DOF = new DOFHelper(this, options);
            this.helpers.DOF.visible = false;
            this.helpers.DOF.matrixAutoUpdate = false;
            this.add(this.helpers.DOF);
        } else if (options && typeof options === 'object') {
            Object.assign(this.helpers.DOF.config, options);
        }

        const nextVisible =
            typeof visible === 'boolean' ? visible : !this.helpers.DOF.visible;
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


}
