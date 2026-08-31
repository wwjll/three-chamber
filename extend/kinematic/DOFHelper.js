import {
    MeshBasicMaterial,
    Mesh,
    DoubleSide,
    MathUtils,
    Object3D,
    RingGeometry,
} from 'three';

function clampMinSize(value, minValue) {
    return Math.max(minValue, value ?? minValue);
}

function normalizeSpanDeg(minAngleDeg, maxAngleDeg) {
    const min = minAngleDeg ?? 0;
    const max = maxAngleDeg ?? 360;
    const rawSpan = max - min;
    if (rawSpan >= 360 || rawSpan <= -360) return 360;

    let span = ((rawSpan % 360) + 360) % 360;
    if (span === 0 && max !== min) span = 360;
    return span;
}

class DOFHelper extends Object3D {
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

        const thetaStart = MathUtils.degToRad(minAngle ?? 0);
        const thetaLength = MathUtils.degToRad(spanDeg);

        const outerRadius = this.config.radius === null
            ? clampMinSize(
                this.joint.getAutoSize() * this.config.radiusScale,
                1e-4,
            )
            : clampMinSize(this.config.radius, 0);

        const thicknessRatio = MathUtils.clamp(
            this.config.thicknessRatio ?? 0.3,
            0,
            1,
        );

        const innerRadius = Math.max(0, outerRadius * (1 - thicknessRatio));

        const segments = Math.max(3, Math.floor(this.config.segments ?? 64));

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
        this._mesh.position.set(0, 0, this.config.offsetZ ?? 0);

        this._material.color.set(this.config.color);
        this._material.opacity = this.config.opacity ?? 0.25;
        this._material.transparent = this._material.opacity < 1;

        return this;
    }

    dispose() {
        this._mesh.geometry.dispose();
        this._material.dispose();
    }
}

export { DOFHelper };
