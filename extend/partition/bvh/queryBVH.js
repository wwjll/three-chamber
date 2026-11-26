import { intersectRayBox } from '../aabb.js';
import { intersectTriangle } from '../triangles.js';
import {
    BVH_NODE_WORDS,
    getLeafCount,
    getLeafOffset,
    getRightChild,
    getSplitAxis,
    isLeaf,
} from './BVHLayout.js';
import { defaultBuildOptions } from './buildBVH.js';

/**
 * Ray queries. Every buffer a query writes (stack, ray, hit) is passed in, so
 * queries allocate nothing and can nest: a callback may traverse another tree
 * with its own stack while the outer traversal is suspended.
 *
 * A tree is any object with `float32`, `uint32`, and `primitiveIndices` laid
 * out as in BVHLayout.js with its root at node 0: a buildBVH result or a view
 * returned by packBVHs.
 */

/**
 * Counts nodes popped by the raycast functions, for benchmarks and
 * visualizations. Reset `nodes` before the rays being measured.
 */
const traversalCounters = { nodes: 0 };

/**
 * Expanding a node replaces it with its two children, so a tree of depth d
 * needs at most d + 1 stack entries.
 */
function createTraversalStack(maxDepth = defaultBuildOptions.maxDepth) {
    return new Uint32Array(maxDepth + 1);
}

function intersectsNode(float32, node, ray, tMin, tMax) {
    const word = BVH_NODE_WORDS * node;
    return intersectRayBox(
        ray,
        float32[word],
        float32[word + 1],
        float32[word + 2],
        float32[word + 4],
        float32[word + 5],
        float32[word + 6],
        tMin,
        tMax
    );
}

// Pushes both children so the one on the near side of the split plane pops first.
function pushChildren(uint32, node, ray, stack, top) {
    if (top + 2 > stack.length) {
        throw new Error('[BVH] Traversal stack needs at least tree depth + 1 entries.');
    }
    const left = node + 1;
    const right = getRightChild(uint32, node);
    if (ray[3 + getSplitAxis(uint32, node)] < 0) {
        stack[top] = left;
        stack[top + 1] = right;
    } else {
        stack[top] = right;
        stack[top + 1] = left;
    }
    return top + 2;
}

/**
 * Closest triangle along the ray with distance in (tMin, tMax). Returns the
 * triangle index, or -1 on a miss, and leaves [distance, u, v] of the hit in
 * `hit`. Shading data is left to the caller so traversal only reads positions.
 */
function raycastTriangles(tree, positions, index, ray, stack, hit, tMin = 0, tMax = Infinity) {
    const { float32, uint32, primitiveIndices } = tree;
    let closest = tMax;
    let closestTriangle = -1;
    let top = 0;
    stack[top++] = 0;

    while (top > 0) {
        const node = stack[--top];
        traversalCounters.nodes++;
        if (!intersectsNode(float32, node, ray, tMin, closest)) {
            continue;
        }

        if (!isLeaf(uint32, node)) {
            top = pushChildren(uint32, node, ray, stack, top);
            continue;
        }

        const start = getLeafOffset(uint32, node);
        const end = start + getLeafCount(uint32, node);
        for (let entry = start; entry < end; entry++) {
            const triangle = primitiveIndices[entry];
            if (intersectTriangle(positions, index, triangle, ray, tMin, closest, hit)) {
                closest = hit[0];
                closestTriangle = triangle;
            }
        }
    }

    return closestTriangle;
}

/**
 * The same traversal as raycastTriangles, reporting every popped node as
 * `visit(node, entered)`, where `entered` says whether the ray overlapped its
 * box. For visualizing a single ray; a separate loop keeps the callback out of
 * raycastTriangles. Popped nodes are not added to traversalCounters.
 */
function traceRaycastTriangles(tree, positions, index, ray, stack, hit, visit, tMin = 0, tMax = Infinity) {
    const { float32, uint32, primitiveIndices } = tree;
    let closest = tMax;
    let closestTriangle = -1;
    let top = 0;
    stack[top++] = 0;

    while (top > 0) {
        const node = stack[--top];
        const entered = intersectsNode(float32, node, ray, tMin, closest);
        visit(node, entered);
        if (!entered) {
            continue;
        }

        if (!isLeaf(uint32, node)) {
            top = pushChildren(uint32, node, ray, stack, top);
            continue;
        }

        const start = getLeafOffset(uint32, node);
        const end = start + getLeafCount(uint32, node);
        for (let entry = start; entry < end; entry++) {
            const triangle = primitiveIndices[entry];
            if (intersectTriangle(positions, index, triangle, ray, tMin, closest, hit)) {
                closest = hit[0];
                closestTriangle = triangle;
            }
        }
    }

    return closestTriangle;
}

/**
 * Closest primitive for any primitive type.
 * `intersectPrimitive(primitive, tMin, closest)` returns the hit distance, or
 * Infinity for a miss or a hit outside (tMin, closest). Returns the primitive
 * index, or -1 on a miss, and writes the closest distance to `hit[0]`.
 */
function raycastBVH(tree, ray, stack, hit, intersectPrimitive, tMin = 0, tMax = Infinity) {
    const { float32, uint32, primitiveIndices } = tree;
    let closest = tMax;
    let closestPrimitive = -1;
    let top = 0;
    stack[top++] = 0;

    while (top > 0) {
        const node = stack[--top];
        traversalCounters.nodes++;
        if (!intersectsNode(float32, node, ray, tMin, closest)) {
            continue;
        }

        if (!isLeaf(uint32, node)) {
            top = pushChildren(uint32, node, ray, stack, top);
            continue;
        }

        const start = getLeafOffset(uint32, node);
        const end = start + getLeafCount(uint32, node);
        for (let entry = start; entry < end; entry++) {
            const primitive = primitiveIndices[entry];
            const distance = intersectPrimitive(primitive, tMin, closest);
            if (distance < closest) {
                closest = distance;
                closestPrimitive = primitive;
            }
        }
    }

    if (closestPrimitive !== -1) {
        hit[0] = closest;
    }
    return closestPrimitive;
}

function nodeHalfArea(float32, node) {
    const word = BVH_NODE_WORDS * node;
    const dx = float32[word + 4] - float32[word];
    const dy = float32[word + 5] - float32[word + 1];
    const dz = float32[word + 6] - float32[word + 2];
    return dx * dy + dy * dz + dz * dx;
}

/**
 * Tree shape and SAH cost relative to the root area. The default cost
 * constants are three-mesh-bvh's (traversal 1, intersection 1.25). The build
 * does not use them, so trees from different strategies or leaf thresholds,
 * or a tree before and after refit, are measured alike and compare directly.
 */
function getBVHStats(tree, {
    traversalCost = 1,
    intersectionCost = 1.25,
} = {}) {
    const { float32, uint32, nodeCount } = tree;
    let leafCount = 0;
    let maxLeafSize = 0;
    let maxDepth = 0;
    let weightedCost = 0;

    const nodes = [0];
    const depths = [0];
    while (nodes.length > 0) {
        const node = nodes.pop();
        const depth = depths.pop();
        const area = nodeHalfArea(float32, node);
        if (depth > maxDepth) {
            maxDepth = depth;
        }

        if (isLeaf(uint32, node)) {
            const count = getLeafCount(uint32, node);
            leafCount++;
            if (count > maxLeafSize) {
                maxLeafSize = count;
            }
            weightedCost += intersectionCost * count * area;
        } else {
            weightedCost += traversalCost * area;
            nodes.push(node + 1, getRightChild(uint32, node));
            depths.push(depth + 1, depth + 1);
        }
    }

    const rootArea = nodeHalfArea(float32, 0);
    return {
        nodeCount,
        leafCount,
        maxLeafSize,
        maxDepth,
        sahCost: rootArea > 0 ? weightedCost / rootArea : 0,
    };
}

export {
    createTraversalStack,
    getBVHStats,
    raycastBVH,
    raycastTriangles,
    traceRaycastTriangles,
    traversalCounters,
};
