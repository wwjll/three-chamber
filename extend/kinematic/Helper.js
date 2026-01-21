import {
    TubeGeometry,
    CatmullRomCurve3,
    Vector3,
    MeshBasicMaterial,
    Mesh,
    CylinderGeometry,
    AxesHelper,
    DoubleSide,
    MathUtils,
    Object3D,
    RingGeometry,
} from 'three';

import { HALF_PI } from './Constants.js';
import { clampMinSize, normalizeSpanDeg } from './Utils.js';

const AXIS_NAMES = {
    X: 'x',
    Y: 'y',
    Z: 'z',
};

const COLOR = 0x0092ff;
const LINK_SIZE = {
    tubularSegments: 64,
    radius: 0.001,
    radialSegments: 8,
};
const JOINT_SIZE = {
    radius: 0.01,
    height: 0.05,
    radialSegments: 8,
};

export class DOFHelper extends Object3D {
    constructor(joint, options = {}) {
        super();

        this.isDOFHelper = true;
        this.joint = joint;

        this.config = {
            color: 0xffa500,
            opacity: 0.25,
            radius: null,
            radiusScale: 0.25,
            thicknessRatio: 0.3,
            segments: 64,
            offsetZ: 1e-4,
            ...options,
        };

        this._material = new MeshBasicMaterial({
            color: this.config.color,
            transparent: true,
            opacity: this.config.opacity,
            side: DoubleSide,
            depthWrite: false,
        });

        this._mesh = new Mesh(new RingGeometry(0, 1, 3), this._material);
        this.add(this._mesh);

        this.update();
    }

    update() {
        const { minAngle, maxAngle } = this.joint;
        const spanDeg = normalizeSpanDeg(minAngle, maxAngle);

        const thetaStart = MathUtils.degToRad(Number.isFinite(minAngle) ? minAngle : 0);
        const thetaLength = MathUtils.degToRad(spanDeg);

        const outerRadius =
            Number.isFinite(this.config.radius) && this.config.radius !== null
                ? clampMinSize(this.config.radius, 0)
                : clampMinSize(this.joint.getAutoSize() * this.config.radiusScale, 1e-4);

        const thicknessRatio = Number.isFinite(this.config.thicknessRatio)
            ? MathUtils.clamp(this.config.thicknessRatio, 0, 1)
            : 0.3;

        const innerRadius = Math.max(0, outerRadius * (1 - thicknessRatio));

        const segments = Number.isFinite(this.config.segments)
            ? Math.max(3, Math.floor(this.config.segments))
            : 64;

        const geometry = new RingGeometry(
            innerRadius,
            outerRadius,
            segments,
            1,
            thetaStart,
            thetaLength
        );

        this._mesh.geometry.dispose();
        this._mesh.geometry = geometry;
        this._mesh.position.set(0, 0, Number.isFinite(this.config.offsetZ) ? this.config.offsetZ : 0);

        this._material.color.set(this.config.color);
        this._material.opacity = Number.isFinite(this.config.opacity) ? this.config.opacity : 0.25;
        this._material.transparent = this._material.opacity < 1;

        return this;
    }

    dispose() {
        this._mesh.geometry.dispose();
        this._material.dispose();
    }
}

class IKHelper {
    constructor(ikChain, config = {}) {
        this.ikJoints = ikChain.ikJoints;
        this.config = config;
        this.linkMaterial = this._createLinkMaterial();
        this.jointMaterial = this._createJointMaterial();
    }

    visualizeIKChain() {
        const jointGeometry = this._createJointGeometry();

        let parent = this.ikJoints[0].parent;

        for (let idx = 0; idx < this.ikJoints.length; idx++) {
            const ikJoint = this.ikJoints[idx];

            const linkGeometry = this._createLinkGeometry(ikJoint.position);
            const link = new Mesh(linkGeometry, this.linkMaterial);
            parent.add(link);

            parent = ikJoint;

            if (idx === 0 || idx === this.ikJoints.length - 1) {
                continue;
            }

            const joint = new Mesh(jointGeometry, this.jointMaterial);

            if (ikJoint.axisName === AXIS_NAMES.Z) {
                joint.rotateX(HALF_PI);
            }

            const axesHelper = new AxesHelper(0.1);
            ikJoint.add(axesHelper);

            ikJoint.add(joint);
        }
    }

    _createLinkGeometry(endPoint) {
        const startPoint = new Vector3(0, 0, 0);
        const linkPathPoints = [startPoint, endPoint];
        const linkPath = new CatmullRomCurve3(linkPathPoints);
        const radius = this.config.linkWidth / 2 || LINK_SIZE.radius;
        const radialSegments =
            this.config.linkRoundness || LINK_SIZE.radialSegments;
        return new TubeGeometry(
            linkPath,
            LINK_SIZE.tubularSegments,
            radius,
            radialSegments
        );
    }

    _createLinkMaterial() {
        const material = new MeshBasicMaterial({
            color: this.config.linkColor || COLOR,
        });
        return material;
    }

    _createJointGeometry() {
        const radiusTop = this.config.jointRadius || JOINT_SIZE.radius;
        const radiusBottom = radiusTop;
        const height = this.config.jointHeight || JOINT_SIZE.height;
        const radialSegments =
            this.config.jointRoundness || JOINT_SIZE.radialSegments;
        return new CylinderGeometry(
            radiusTop,
            radiusBottom,
            height,
            radialSegments
        );
    }

    _createJointMaterial() {
        const material = new MeshBasicMaterial({
            color: this.config.JointColor || COLOR,
        });
        return material;
    }
}

export default IKHelper;
