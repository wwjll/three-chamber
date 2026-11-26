/**
 * Axis-aligned box and ray helpers over typed arrays.
 *
 * A box is six consecutive values [min.x, min.y, min.z, max.x, max.y, max.z]
 * starting at an offset. A ray is a Float64Array(9) holding its origin,
 * direction, and component-wise inverse direction, so box tests never divide.
 */

function resetBounds(bounds, offset = 0) {
    bounds[offset] = Infinity;
    bounds[offset + 1] = Infinity;
    bounds[offset + 2] = Infinity;
    bounds[offset + 3] = -Infinity;
    bounds[offset + 4] = -Infinity;
    bounds[offset + 5] = -Infinity;
}

function expandBounds(target, targetOffset, source, sourceOffset) {
    for (let axis = 0; axis < 3; axis++) {
        const min = source[sourceOffset + axis];
        const max = source[sourceOffset + axis + 3];
        if (min < target[targetOffset + axis]) {
            target[targetOffset + axis] = min;
        }
        if (max > target[targetOffset + axis + 3]) {
            target[targetOffset + axis + 3] = max;
        }
    }
}

// Half of the surface area. SAH only compares area ratios, so the factor of two cancels.
function halfSurfaceArea(bounds, offset = 0) {
    const dx = bounds[offset + 3] - bounds[offset];
    const dy = bounds[offset + 4] - bounds[offset + 1];
    const dz = bounds[offset + 5] - bounds[offset + 2];
    return dx * dy + dy * dz + dz * dx;
}

function createRay() {
    return new Float64Array(9);
}

function setRay(ray, originX, originY, originZ, directionX, directionY, directionZ) {
    ray[0] = originX;
    ray[1] = originY;
    ray[2] = originZ;
    ray[3] = directionX;
    ray[4] = directionY;
    ray[5] = directionZ;
    ray[6] = 1 / directionX;
    ray[7] = 1 / directionY;
    ray[8] = 1 / directionZ;
    return ray;
}

/**
 * Ray from a perspective camera through a point in normalized device
 * coordinates. `unproject` is the camera's column-major
 * matrixWorld * projectionMatrixInverse and `origin` its world position.
 */
function setRayFromCamera(ray, unproject, origin, ndcX, ndcY) {
    const [originX, originY, originZ] = origin;
    const w = unproject[3] * ndcX + unproject[7] * ndcY + unproject[11] * 0.5 + unproject[15];
    const directionX = (unproject[0] * ndcX + unproject[4] * ndcY + unproject[8] * 0.5 + unproject[12]) / w - originX;
    const directionY = (unproject[1] * ndcX + unproject[5] * ndcY + unproject[9] * 0.5 + unproject[13]) / w - originY;
    const directionZ = (unproject[2] * ndcX + unproject[6] * ndcY + unproject[10] * 0.5 + unproject[14]) / w - originZ;
    const length = Math.hypot(directionX, directionY, directionZ);
    return setRay(ray, originX, originY, originZ, directionX / length, directionY / length, directionZ / length);
}

/**
 * Slab test. Returns whether the ray overlaps the box anywhere in
 * [tMin, tMax]. When a direction component is zero and the origin lies on that
 * slab plane, the slab distance is NaN; NaN fails both comparisons, so that
 * slab does not narrow the interval and the origin counts as inside it.
 */
function intersectRayBox(ray, minX, minY, minZ, maxX, maxY, maxZ, tMin, tMax) {
    let near = tMin;
    let far = tMax;
    let entry;
    let exit;

    if (ray[6] >= 0) {
        entry = (minX - ray[0]) * ray[6];
        exit = (maxX - ray[0]) * ray[6];
    } else {
        entry = (maxX - ray[0]) * ray[6];
        exit = (minX - ray[0]) * ray[6];
    }
    if (entry > near) {
        near = entry;
    }
    if (exit < far) {
        far = exit;
    }

    if (ray[7] >= 0) {
        entry = (minY - ray[1]) * ray[7];
        exit = (maxY - ray[1]) * ray[7];
    } else {
        entry = (maxY - ray[1]) * ray[7];
        exit = (minY - ray[1]) * ray[7];
    }
    if (entry > near) {
        near = entry;
    }
    if (exit < far) {
        far = exit;
    }

    if (ray[8] >= 0) {
        entry = (minZ - ray[2]) * ray[8];
        exit = (maxZ - ray[2]) * ray[8];
    } else {
        entry = (maxZ - ray[2]) * ray[8];
        exit = (minZ - ray[2]) * ray[8];
    }
    if (entry > near) {
        near = entry;
    }
    if (exit < far) {
        far = exit;
    }

    return near <= far;
}

export {
    createRay,
    expandBounds,
    halfSurfaceArea,
    intersectRayBox,
    resetBounds,
    setRay,
    setRayFromCamera,
};
