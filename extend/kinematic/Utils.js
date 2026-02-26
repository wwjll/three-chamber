import { Matrix4 } from "three";

export function AlignBaseMatrix(container, offset = {}) {
    // Align robot frame (Z-up) to Three.js frame (Y-up) via Rx(-90deg),
    // then apply base translation offset in the aligned frame.
    // Rotate robot Z-up frame to three.js Y-up: R = Rx(-90deg)
    const A = new Matrix4().set(
        1, 0, 0, 0,
        0, 0, 1, 0,
        0, -1, 0, 0,
        0, 0, 0, 1
    );
    const tx = Number.isFinite(offset.x) ? offset.x : 0;
    const ty = Number.isFinite(offset.y) ? offset.y : 0;
    const tz = Number.isFinite(offset.z) ? offset.z : 0;
    const T = new Matrix4().makeTranslation(tx, ty, tz);
    container.matrixAutoUpdate = false;
    container.matrix.copy(A).multiply(T);
}

export function normalizeSpanDeg(minAngleDeg, maxAngleDeg) {
    const min = Number.isFinite(minAngleDeg) ? minAngleDeg : 0;
    const max = Number.isFinite(maxAngleDeg) ? maxAngleDeg : 360;

    const rawSpan = max - min;
    if (rawSpan >= 360 || rawSpan <= -360) return 360;

    let span = ((rawSpan % 360) + 360) % 360;
    if (span === 0 && max !== min) span = 360;

    return span;
}

export function clampMinSize(value, minValue) {
    return Number.isFinite(value) ? Math.max(minValue, value) : minValue;
}

function normalizeDhParam(item) {
    if (Array.isArray(item)) {
        const [
            theta = 0,
            d = 0,
            a = 0,
            alpha = 0,
            thetaOffset = 0,
            minAngle = -185,
            maxAngle = 185
        ] = item;
        return { theta, d, a, alpha, thetaOffset, minAngle, maxAngle };
    }
    if (item && typeof item === 'object') {
        return {
            theta: Number.isFinite(item.theta) ? item.theta : 0,
            d: Number.isFinite(item.d) ? item.d : 0,
            a: Number.isFinite(item.a) ? item.a : 0,
            alpha: Number.isFinite(item.alpha) ? item.alpha : 0,
            thetaOffset: Number.isFinite(item.thetaOffset) ? item.thetaOffset : 0,
            minAngle: Number.isFinite(item.minAngle) ? item.minAngle : -185,
            maxAngle: Number.isFinite(item.maxAngle) ? item.maxAngle : 185
        };
    }
    return { theta: 0, d: 0, a: 0, alpha: 0, thetaOffset: 0, minAngle: -185, maxAngle: 185 };
}

export function ConvertMDH(params) {
    const dhParams = Array.isArray(params) ? params : [];
    const result = [];
    const n = dhParams.length;

    for (let i = 0; i < n; i++) {
        const cur = normalizeDhParam(dhParams[i]);
        const prev = i > 0 ? normalizeDhParam(dhParams[i - 1]) : null;
        const a = i === 0 ? 0 : prev.a;
        const alpha = i === 0 ? 0 : prev.alpha;
        result.push([cur.theta, cur.d, a, alpha, cur.thetaOffset, cur.minAngle, cur.maxAngle]);
    }

    if (n > 0) {
        const last = normalizeDhParam(dhParams[n - 1]);
        result.push([0, 0, last.a, last.alpha, 0, -185, 185]);
    }

    return result;
}

export function ConvertDH(params) {
    const mdhParams = Array.isArray(params) ? params : [];
    const m = mdhParams.length;
    const result = [];
    const n = Math.max(0, m - 1);

    for (let i = 0; i < n; i++) {
        const cur = normalizeDhParam(mdhParams[i]);
        const next = normalizeDhParam(mdhParams[i + 1]);
        result.push([cur.theta, cur.d, next.a, next.alpha, cur.thetaOffset, cur.minAngle, cur.maxAngle]);
    }

    return result;
}
