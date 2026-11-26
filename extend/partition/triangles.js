/**
 * Triangle helpers for the generic BVH.
 *
 * `positions` holds xyz per vertex. When `index` is null, vertices 3t, 3t + 1,
 * and 3t + 2 form triangle t; otherwise `index` lists three vertex indices per
 * triangle. Pass Float32Array positions when the results feed BVH bounds, so
 * the bounds are exact float32 values and never round inward.
 */

function getTriangleCount(positions, index = null) {
    return index === null ? positions.length / 9 : index.length / 3;
}

/**
 * Writes [min.xyz, max.xyz] for every triangle into `target`.
 */
function computeTriangleBounds(
    positions,
    index = null,
    target = new Float32Array(6 * getTriangleCount(positions, index))
) {
    const triangleCount = target.length / 6;
    for (let triangle = 0; triangle < triangleCount; triangle++) {
        let a = 3 * triangle;
        let b = a + 1;
        let c = a + 2;
        if (index !== null) {
            a = index[a];
            b = index[b];
            c = index[c];
        }
        a *= 3;
        b *= 3;
        c *= 3;

        const offset = 6 * triangle;
        for (let axis = 0; axis < 3; axis++) {
            const pa = positions[a + axis];
            const pb = positions[b + axis];
            const pc = positions[c + axis];
            let min = pa;
            let max = pa;
            if (pb < min) {
                min = pb;
            }
            if (pb > max) {
                max = pb;
            }
            if (pc < min) {
                min = pc;
            }
            if (pc > max) {
                max = pc;
            }
            target[offset + axis] = min;
            target[offset + axis + 3] = max;
        }
    }
    return target;
}

/**
 * Two-sided Moller-Trumbore intersection. On a hit with distance in
 * (tMin, tMax) it writes [distance, u, v] into `hit` and returns true, where
 * u and v weight the second and third vertices. Otherwise `hit` is untouched.
 */
function intersectTriangle(positions, index, triangle, ray, tMin, tMax, hit) {
    let a = 3 * triangle;
    let b = a + 1;
    let c = a + 2;
    if (index !== null) {
        a = index[a];
        b = index[b];
        c = index[c];
    }
    a *= 3;
    b *= 3;
    c *= 3;

    const ax = positions[a];
    const ay = positions[a + 1];
    const az = positions[a + 2];
    const e1x = positions[b] - ax;
    const e1y = positions[b + 1] - ay;
    const e1z = positions[b + 2] - az;
    const e2x = positions[c] - ax;
    const e2y = positions[c + 1] - ay;
    const e2z = positions[c + 2] - az;

    const dx = ray[3];
    const dy = ray[4];
    const dz = ray[5];
    const px = dy * e2z - dz * e2y;
    const py = dz * e2x - dx * e2z;
    const pz = dx * e2y - dy * e2x;
    const determinant = e1x * px + e1y * py + e1z * pz;
    if (determinant === 0) {
        return false;
    }

    const inverseDeterminant = 1 / determinant;
    const tx = ray[0] - ax;
    const ty = ray[1] - ay;
    const tz = ray[2] - az;
    const u = (tx * px + ty * py + tz * pz) * inverseDeterminant;
    if (u < 0 || u > 1) {
        return false;
    }

    const qx = ty * e1z - tz * e1y;
    const qy = tz * e1x - tx * e1z;
    const qz = tx * e1y - ty * e1x;
    const v = (dx * qx + dy * qy + dz * qz) * inverseDeterminant;
    if (v < 0 || u + v > 1) {
        return false;
    }

    const distance = (e2x * qx + e2y * qy + e2z * qz) * inverseDeterminant;
    if (!(distance > tMin && distance < tMax)) {
        return false;
    }

    hit[0] = distance;
    hit[1] = u;
    hit[2] = v;
    return true;
}

export {
    computeTriangleBounds,
    getTriangleCount,
    intersectTriangle,
};
