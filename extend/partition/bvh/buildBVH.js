import { expandBounds, halfSurfaceArea, resetBounds } from '../aabb.js';
import {
    BVH_MAX_LEAF_SIZE,
    BVH_NODE_BYTES,
    createNodeArrays,
    setRightChild,
    writeInternal,
    writeLeaf,
    writeNodeBounds,
} from './BVHLayout.js';

const SAH = 'sah';
const CENTER = 'center';

const strategies = [SAH, CENTER];
const buildModes = ['auto', 'recursive', 'iterative'];

const defaultBuildOptions = Object.freeze({
    strategy: SAH,
    buildMode: 'auto',
    recursionDepthLimit: 1000,
    binCount: 16,
    leafThreshold: 8,
    maxDepth: 64,
});

/**
 * Builds a binary BVH over primitive bounds.
 *
 * `primitiveBounds` is a Float32Array with [min.xyz, max.xyz] per primitive.
 * Node bounds are unions of these values, so no node is smaller than a
 * primitive it contains. The input is copied and never modified; the returned
 * `primitiveIndices` maps leaf entries back to input primitives.
 *
 * Centroids are min + max, twice the true centroid, and never multiplied by
 * 0.5. Bin origins and scales come from centroid bounds in the same units, so
 * the factor cancels.
 *
 * Options:
 * - `strategy` chooses where a node is split: `sah` evaluates `binCount`
 *   planes per axis and takes the one with the lowest surface area
 *   heuristic cost; `center` halves the longest centroid axis.
 * - `leafThreshold` decides when splitting stops, for both strategies. A
 *   node with at most this many primitives becomes a leaf, and a larger
 *   node is always split, so every leaf holds 1 to `leafThreshold`
 *   primitives. SAH never splits a node that fits or ends a larger one
 *   early (docs/decisions/2026-11-25-bvh-leaf-threshold.md).
 * - `buildMode`: `recursive`, `iterative` (explicit stack), or `auto`. Both
 *   builders write byte-identical results. `auto` takes the worst-case depth,
 *   min(maxDepth, primitiveCount - 1), reached when every split peels off a
 *   single primitive, and uses the explicit stack only when it exceeds
 *   `recursionDepthLimit`. A balanced estimate such as log2(n / leafThreshold)
 *   is not used because SAH splits can be very uneven. With the default
 *   maxDepth of 64, `auto` always recurses; the switch is a fallback for
 *   callers that raise maxDepth or lower the limit. An explicit `recursive`
 *   or `iterative` is always honoured, for benchmarks.
 * - `maxDepth` is a hard limit; the build throws when a node at that depth
 *   still holds more than `leafThreshold` primitives.
 *
 * Returns a plain object whose buffers can be transferred to a worker:
 * `{ buffer, float32, uint32, nodeCount, primitiveIndices, primitiveCount,
 * buildMode }`, where `buildMode` is the builder actually used.
 */
function buildBVH(primitiveBounds, options = {}) {
    const settings = { ...defaultBuildOptions, ...options };
    validateInput(primitiveBounds, settings);

    const buildMode = resolveBuildMode(settings, primitiveBounds.length / 6);
    const builder = createBuilder(primitiveBounds, settings);
    if (buildMode === 'recursive') {
        buildRecursive(builder, 0, builder.primitiveCount, 0);
    } else {
        buildIterative(builder);
    }

    const { nodeCount, primitiveIndices, primitiveCount } = builder;
    const buffer = builder.buffer.slice(0, nodeCount * BVH_NODE_BYTES);
    return {
        buffer,
        float32: new Float32Array(buffer),
        uint32: new Uint32Array(buffer),
        nodeCount,
        primitiveIndices,
        primitiveCount,
        buildMode,
    };
}

function resolveBuildMode({ buildMode, maxDepth, recursionDepthLimit }, primitiveCount) {
    if (buildMode !== 'auto') {
        return buildMode;
    }
    const worstDepth = Math.min(maxDepth, primitiveCount - 1);
    return worstDepth > recursionDepthLimit ? 'iterative' : 'recursive';
}

function validateInput(primitiveBounds, settings) {
    const { strategy, buildMode, recursionDepthLimit, binCount, leafThreshold, maxDepth } = settings;
    if (!strategies.includes(strategy)) {
        throw new Error(`[BVH] Unknown split strategy "${strategy}".`);
    }
    if (!buildModes.includes(buildMode)) {
        throw new Error(`[BVH] Unknown buildMode "${buildMode}".`);
    }
    if (!Number.isInteger(recursionDepthLimit) || recursionDepthLimit < 0) {
        throw new Error('[BVH] recursionDepthLimit must be a non-negative integer.');
    }
    if (!Number.isInteger(binCount) || binCount < 2) {
        throw new Error('[BVH] binCount must be an integer of at least 2.');
    }
    if (!Number.isInteger(leafThreshold) || leafThreshold < 1 || leafThreshold > BVH_MAX_LEAF_SIZE) {
        throw new Error(`[BVH] leafThreshold must be an integer from 1 to ${BVH_MAX_LEAF_SIZE}.`);
    }
    if (!Number.isInteger(maxDepth) || maxDepth < 0) {
        throw new Error('[BVH] maxDepth must be a non-negative integer.');
    }
    if (!(primitiveBounds instanceof Float32Array) || primitiveBounds.length === 0 || primitiveBounds.length % 6 !== 0) {
        throw new Error('[BVH] primitiveBounds must be a non-empty Float32Array with six values per primitive.');
    }
    for (let i = 0; i < primitiveBounds.length; i += 6) {
        for (let axis = 0; axis < 3; axis++) {
            const min = primitiveBounds[i + axis];
            const max = primitiveBounds[i + axis + 3];
            if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) {
                throw new Error(`[BVH] Primitive ${i / 6} has invalid bounds.`);
            }
        }
    }
}

function createBuilder(primitiveBounds, settings) {
    const primitiveCount = primitiveBounds.length / 6;
    const primitiveIndices = new Uint32Array(primitiveCount);
    for (let primitive = 0; primitive < primitiveCount; primitive++) {
        primitiveIndices[primitive] = primitive;
    }

    // A binary tree with at least one primitive per leaf has at most 2n - 1 nodes.
    const { buffer, float32, uint32 } = createNodeArrays(2 * primitiveCount - 1);
    const { binCount } = settings;

    return {
        settings,
        primitiveCount,
        primitiveIndices,
        work: primitiveBounds.slice(),
        buffer,
        float32,
        uint32,
        nodeCount: 0,
        nodeBounds: new Float64Array(6),
        centroidBounds: new Float64Array(6),
        binCounts: new Uint32Array(binCount),
        binBounds: new Float64Array(6 * binCount),
        rightCounts: new Uint32Array(binCount),
        rightAreas: new Float64Array(binCount),
        sweepBounds: new Float64Array(6),
        // Split chosen for the node being built, in doubled centroid units.
        split: { axis: -1, origin: 0, scale: 0, binCount: 0, lastLeftBin: 0, cost: Infinity },
    };
}

function binIndex(centroid, origin, scale, binCount) {
    const bin = Math.floor((centroid - origin) * scale);
    return bin < binCount ? bin : binCount - 1;
}

function computeRangeBounds(work, start, count, nodeBounds, centroidBounds) {
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    let centroidMinX = Infinity;
    let centroidMinY = Infinity;
    let centroidMinZ = Infinity;
    let centroidMaxX = -Infinity;
    let centroidMaxY = -Infinity;
    let centroidMaxZ = -Infinity;

    for (let i = 6 * start, end = 6 * (start + count); i < end; i += 6) {
        const lowX = work[i];
        const lowY = work[i + 1];
        const lowZ = work[i + 2];
        const highX = work[i + 3];
        const highY = work[i + 4];
        const highZ = work[i + 5];

        if (lowX < minX) {
            minX = lowX;
        }
        if (lowY < minY) {
            minY = lowY;
        }
        if (lowZ < minZ) {
            minZ = lowZ;
        }
        if (highX > maxX) {
            maxX = highX;
        }
        if (highY > maxY) {
            maxY = highY;
        }
        if (highZ > maxZ) {
            maxZ = highZ;
        }

        const centroidX = lowX + highX;
        const centroidY = lowY + highY;
        const centroidZ = lowZ + highZ;
        if (centroidX < centroidMinX) {
            centroidMinX = centroidX;
        }
        if (centroidX > centroidMaxX) {
            centroidMaxX = centroidX;
        }
        if (centroidY < centroidMinY) {
            centroidMinY = centroidY;
        }
        if (centroidY > centroidMaxY) {
            centroidMaxY = centroidY;
        }
        if (centroidZ < centroidMinZ) {
            centroidMinZ = centroidZ;
        }
        if (centroidZ > centroidMaxZ) {
            centroidMaxZ = centroidZ;
        }
    }

    nodeBounds[0] = minX;
    nodeBounds[1] = minY;
    nodeBounds[2] = minZ;
    nodeBounds[3] = maxX;
    nodeBounds[4] = maxY;
    nodeBounds[5] = maxZ;
    centroidBounds[0] = centroidMinX;
    centroidBounds[1] = centroidMinY;
    centroidBounds[2] = centroidMinZ;
    centroidBounds[3] = centroidMaxX;
    centroidBounds[4] = centroidMaxY;
    centroidBounds[5] = centroidMaxZ;
}

// The bin box update is written out rather than calling expandBounds: the
// call in this per-primitive loop made SAH builds 8-18% slower.
function binRange(work, start, count, axis, origin, scale, binCount, binCounts, binBounds) {
    for (let i = 6 * start, end = 6 * (start + count); i < end; i += 6) {
        const bin = binIndex(work[i + axis] + work[i + axis + 3], origin, scale, binCount);
        binCounts[bin]++;

        const offset = 6 * bin;
        for (let component = 0; component < 3; component++) {
            const low = work[i + component];
            const high = work[i + component + 3];
            if (low < binBounds[offset + component]) {
                binBounds[offset + component] = low;
            }
            if (high > binBounds[offset + component + 3]) {
                binBounds[offset + component + 3] = high;
            }
        }
    }
}

function swapEntries(work, primitiveIndices, a, b) {
    const primitive = primitiveIndices[a];
    primitiveIndices[a] = primitiveIndices[b];
    primitiveIndices[b] = primitive;

    const offsetA = 6 * a;
    const offsetB = 6 * b;
    for (let component = 0; component < 6; component++) {
        const value = work[offsetA + component];
        work[offsetA + component] = work[offsetB + component];
        work[offsetB + component] = value;
    }
}

// Uses the same bin expression as binRange, so a partition always reproduces
// the split that SAH evaluated.
function partitionRange(work, primitiveIndices, start, count, axis, origin, scale, binCount, lastLeftBin) {
    let left = start;
    let right = start + count - 1;
    while (left <= right) {
        const i = 6 * left;
        if (binIndex(work[i + axis] + work[i + axis + 3], origin, scale, binCount) <= lastLeftBin) {
            left++;
        } else {
            swapEntries(work, primitiveIndices, left, right);
            right--;
        }
    }
    return left;
}

function createNode(builder, start, count) {
    const node = builder.nodeCount++;
    computeRangeBounds(builder.work, start, count, builder.nodeBounds, builder.centroidBounds);
    writeNodeBounds(builder.float32, node, builder.nodeBounds);
    return node;
}

/**
 * Bins every axis and stores the split with the lowest SAH cost in
 * `builder.split`. The node is split whatever the cost, so only candidates
 * are compared. The traversal cost and the division by the node area are the
 * same for every candidate and the intersection cost scales all of them
 * equally, so a candidate costs leftArea * leftCount + rightArea * rightCount.
 */
function findSahSplit(builder, start, count) {
    const {
        settings: { binCount },
        work,
        centroidBounds,
        binCounts,
        binBounds,
        rightCounts,
        rightAreas,
        sweepBounds,
        split,
    } = builder;
    split.axis = -1;
    split.cost = Infinity;

    for (let axis = 0; axis < 3; axis++) {
        const origin = centroidBounds[axis];
        const extent = centroidBounds[axis + 3] - origin;
        if (!(extent > 0)) {
            continue;
        }

        const scale = binCount / extent;
        binCounts.fill(0);
        for (let bin = 0; bin < binCount; bin++) {
            resetBounds(binBounds, 6 * bin);
        }
        binRange(work, start, count, axis, origin, scale, binCount, binCounts, binBounds);

        resetBounds(sweepBounds);
        let rightCount = 0;
        for (let bin = binCount - 1; bin > 0; bin--) {
            expandBounds(sweepBounds, 0, binBounds, 6 * bin);
            rightCount += binCounts[bin];
            rightCounts[bin] = rightCount;
            rightAreas[bin] = rightCount > 0 ? halfSurfaceArea(sweepBounds) : 0;
        }

        resetBounds(sweepBounds);
        let leftCount = 0;
        for (let bin = 0; bin < binCount - 1; bin++) {
            expandBounds(sweepBounds, 0, binBounds, 6 * bin);
            leftCount += binCounts[bin];
            const binRightCount = rightCounts[bin + 1];
            if (leftCount === 0 || binRightCount === 0) {
                continue;
            }

            const cost = halfSurfaceArea(sweepBounds) * leftCount + rightAreas[bin + 1] * binRightCount;
            if (cost < split.cost) {
                split.axis = axis;
                split.origin = origin;
                split.scale = scale;
                split.binCount = binCount;
                split.lastLeftBin = bin;
                split.cost = cost;
            }
        }
    }
}

// A center split is a two-bin split of the longest centroid axis, so both
// strategies share one partition rule.
function findCenterSplit(builder) {
    const { centroidBounds, split } = builder;
    split.axis = -1;
    let longestExtent = 0;
    for (let axis = 0; axis < 3; axis++) {
        const extent = centroidBounds[axis + 3] - centroidBounds[axis];
        if (extent > longestExtent) {
            longestExtent = extent;
            split.axis = axis;
        }
    }
    if (split.axis !== -1) {
        split.origin = centroidBounds[split.axis];
        split.scale = 2 / longestExtent;
        split.binCount = 2;
        split.lastLeftBin = 0;
    }
}

/**
 * Either writes a leaf and returns -1, or partitions the range, marks the
 * node internal, and returns the first entry of the right child.
 */
function splitOrLeaf(builder, node, start, count, depth) {
    const { settings: { strategy, leafThreshold, maxDepth }, split, uint32 } = builder;

    if (count <= leafThreshold) {
        writeLeaf(uint32, node, start, count);
        return -1;
    }
    if (depth >= maxDepth) {
        throw new Error(
            `[BVH] Reached maxDepth ${maxDepth} with ${count} primitives in one node; ` +
            'increase maxDepth or leafThreshold.'
        );
    }

    if (strategy === SAH) {
        findSahSplit(builder, start, count);
    } else {
        findCenterSplit(builder);
    }

    // Without a separating plane every centroid coincides and any split is as
    // good as another, so halve the range to honour leafThreshold.
    let middle = start;
    if (split.axis !== -1) {
        middle = partitionRange(
            builder.work,
            builder.primitiveIndices,
            start,
            count,
            split.axis,
            split.origin,
            split.scale,
            split.binCount,
            split.lastLeftBin
        );
    }
    if (middle === start || middle === start + count) {
        middle = start + (count >> 1);
    }

    writeInternal(uint32, node, split.axis === -1 ? 0 : split.axis);
    return middle;
}

function buildRecursive(builder, start, count, depth) {
    const node = createNode(builder, start, count);
    const middle = splitOrLeaf(builder, node, start, count, depth);
    if (middle === -1) {
        return;
    }

    buildRecursive(builder, start, middle - start, depth + 1);
    setRightChild(builder.uint32, node, builder.nodeCount);
    buildRecursive(builder, middle, start + count - middle, depth + 1);
}

/**
 * Same visiting order as buildRecursive. Each task is (start, count, depth,
 * parent); parent is -1 for left children, whose index is implied. Pushing the
 * right task before the left one keeps nodes in depth-first order. An internal
 * node at depth d leaves at most d pending right tasks plus its two children,
 * and internal nodes are shallower than maxDepth, so maxDepth + 2 tasks fit.
 */
function buildIterative(builder) {
    const stack = new Int32Array(4 * (builder.settings.maxDepth + 2));
    stack[0] = 0;
    stack[1] = builder.primitiveCount;
    stack[2] = 0;
    stack[3] = -1;
    let top = 4;

    while (top > 0) {
        top -= 4;
        const start = stack[top];
        const count = stack[top + 1];
        const depth = stack[top + 2];
        const parent = stack[top + 3];

        const node = createNode(builder, start, count);
        if (parent !== -1) {
            setRightChild(builder.uint32, parent, node);
        }

        const middle = splitOrLeaf(builder, node, start, count, depth);
        if (middle === -1) {
            continue;
        }

        stack[top] = middle;
        stack[top + 1] = start + count - middle;
        stack[top + 2] = depth + 1;
        stack[top + 3] = node;
        stack[top + 4] = start;
        stack[top + 5] = middle - start;
        stack[top + 6] = depth + 1;
        stack[top + 7] = -1;
        top += 8;
    }
}

export {
    CENTER,
    SAH,
    buildBVH,
    defaultBuildOptions,
};
