import assert from 'node:assert/strict';

import { createRay, setRay } from '../../extend/partition/aabb.js';
import { getTriangleCount, intersectTriangle } from '../../extend/partition/triangles.js';
import {
    BVH_LEAF_FLAG,
    BVH_NODE_WORDS,
    getLeafCount,
    getLeafOffset,
    getRightChild,
    isLeaf,
} from '../../extend/partition/bvh/BVHLayout.js';

const strategies = ['sah', 'center'];
const buildModes = ['recursive', 'iterative'];

// Mulberry32: small seeded generator so every run builds the same trees.
function createRandom(seed) {
    let state = seed >>> 0;
    return function random() {
        state = (state + 0x6d2b79f5) >>> 0;
        let value = state;
        value = Math.imul(value ^ (value >>> 15), value | 1);
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Non-indexed triangles. Uniform soups spread small triangles over [-1, 1]^3;
 * clustered soups put most of them in a few dense clumps plus a few large
 * triangles, where SAH and center splits differ the most.
 */
function createTriangleSoup(count, random, { clustered = false, size = 0.08, offset = [0, 0, 0] } = {}) {
    const positions = new Float32Array(9 * count);
    const clusters = [
        [-0.8, -0.7, 0.6],
        [0.7, 0.2, -0.5],
        [0.1, 0.9, 0.3],
    ];
    for (let triangle = 0; triangle < count; triangle++) {
        const center = [0, 0, 0];
        let triangleSize = size;
        if (clustered && triangle % 50 === 0) {
            triangleSize = 1;
        }
        for (let axis = 0; axis < 3; axis++) {
            if (clustered) {
                center[axis] = clusters[triangle % clusters.length][axis] + 0.1 * (random() - 0.5);
            } else {
                center[axis] = 2 * random() - 1;
            }
        }
        for (let corner = 0; corner < 3; corner++) {
            for (let axis = 0; axis < 3; axis++) {
                positions[9 * triangle + 3 * corner + axis] =
                    offset[axis] + center[axis] + triangleSize * (random() - 0.5);
            }
        }
    }
    return positions;
}

// Indexed height field of cells x cells quads in [-1, 1]^2.
function createGrid(cells, height = (_x, _y) => 0) {
    const side = cells + 1;
    const positions = new Float32Array(3 * side * side);
    for (let row = 0; row < side; row++) {
        for (let column = 0; column < side; column++) {
            const vertex = 3 * (row * side + column);
            const x = 2 * column / cells - 1;
            const y = 2 * row / cells - 1;
            positions[vertex] = x;
            positions[vertex + 1] = y;
            positions[vertex + 2] = height(x, y);
        }
    }

    const index = new Uint32Array(6 * cells * cells);
    let entry = 0;
    for (let row = 0; row < cells; row++) {
        for (let column = 0; column < cells; column++) {
            const a = row * side + column;
            const b = a + 1;
            const c = a + side;
            const d = c + 1;
            index.set([a, b, d, a, d, c], entry);
            entry += 6;
        }
    }
    return { positions, index };
}

// Rays from a sphere of radius 3 toward random points of [-1.2, 1.2]^3.
function createRandomRays(count, random, offset = [0, 0, 0]) {
    const rays = [];
    for (let i = 0; i < count; i++) {
        const theta = 2 * Math.PI * random();
        const cosPhi = 2 * random() - 1;
        const sinPhi = Math.sqrt(1 - cosPhi * cosPhi);
        const origin = [3 * sinPhi * Math.cos(theta), 3 * sinPhi * Math.sin(theta), 3 * cosPhi];
        const target = [2.4 * random() - 1.2, 2.4 * random() - 1.2, 2.4 * random() - 1.2];
        const direction = [target[0] - origin[0], target[1] - origin[1], target[2] - origin[2]];
        const length = Math.hypot(...direction);
        rays.push(setRay(
            createRay(),
            offset[0] + origin[0],
            offset[1] + origin[1],
            offset[2] + origin[2],
            direction[0] / length,
            direction[1] / length,
            direction[2] / length
        ));
    }
    return rays;
}

function raycastBruteForce(positions, index, ray, hit, tMin = 0, tMax = Infinity) {
    let closest = tMax;
    let closestTriangle = -1;
    const triangleCount = getTriangleCount(positions, index);
    for (let triangle = 0; triangle < triangleCount; triangle++) {
        if (intersectTriangle(positions, index, triangle, ray, tMin, closest, hit)) {
            closest = hit[0];
            closestTriangle = triangle;
        }
    }
    return closestTriangle;
}

function cloneTree(tree) {
    const buffer = tree.buffer.slice(0);
    return {
        ...tree,
        buffer,
        float32: new Float32Array(buffer),
        uint32: new Uint32Array(buffer),
        primitiveIndices: tree.primitiveIndices.slice(),
    };
}

function nodeBox(float32, node) {
    const word = BVH_NODE_WORDS * node;
    return [
        float32[word], float32[word + 1], float32[word + 2],
        float32[word + 4], float32[word + 5], float32[word + 6],
    ];
}

function assertContains(outer, inner, message) {
    for (let axis = 0; axis < 3; axis++) {
        assert.ok(
            outer[axis] <= inner[axis] && outer[axis + 3] >= inner[axis + 3],
            `${message}: [${outer}] does not contain [${inner}]`
        );
    }
}

function union(a, b) {
    return [
        Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2]),
        Math.max(a[3], b[3]), Math.max(a[4], b[4]), Math.max(a[5], b[5]),
    ];
}

/**
 * Checks every layout and build invariant of a tree and returns its depth.
 * With `exact`, every node must equal the union of its contents, which holds
 * for minmax builds and after any refit.
 */
function validateTree(tree, primitiveBounds, { leafThreshold = 8, maxDepth = 64, exact = false } = {}) {
    const { float32, uint32, nodeCount, primitiveIndices, primitiveCount } = tree;
    assert.equal(primitiveIndices.length, primitiveCount);
    assert.equal(primitiveBounds.length, 6 * primitiveCount);
    assert.ok(nodeCount >= 1 && nodeCount <= 2 * primitiveCount - 1, `nodeCount ${nodeCount}`);

    const sorted = Array.from(primitiveIndices).sort((a, b) => a - b);
    sorted.forEach((primitive, i) => assert.equal(primitive, i, 'primitiveIndices is not a permutation'));

    let nextPrimitive = 0;
    let treeDepth = 0;

    // Returns [first node after the subtree, union of the subtree's primitive bounds].
    function visit(node, depth) {
        assert.ok(node < nodeCount, `node ${node} is outside the tree`);
        assert.ok(depth <= maxDepth, `depth ${depth} exceeds ${maxDepth}`);
        treeDepth = Math.max(treeDepth, depth);
        const box = nodeBox(float32, node);
        const flags = uint32[BVH_NODE_WORDS * node + 7];

        if (isLeaf(uint32, node)) {
            assert.equal(flags & 0x7fff0000, 0, 'leaf reserved bits must be zero');
            const offset = getLeafOffset(uint32, node);
            const count = getLeafCount(uint32, node);
            assert.equal(offset, nextPrimitive, 'leaf offsets must be contiguous in depth-first order');
            assert.ok(count >= 1 && count <= leafThreshold, `leaf size ${count}`);
            nextPrimitive += count;

            let contents = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
            for (let entry = offset; entry < offset + count; entry++) {
                const i = 6 * primitiveIndices[entry];
                const primitive = Array.from(primitiveBounds.subarray(i, i + 6));
                assertContains(box, primitive, `leaf ${node} primitive ${primitiveIndices[entry]}`);
                contents = union(contents, primitive);
            }
            if (exact) {
                assert.deepEqual(box, contents, `leaf ${node} is not tight`);
            }
            return [node + 1, contents];
        }

        assert.equal(flags & BVH_LEAF_FLAG, 0);
        assert.equal(flags & 0x7ffffffc, 0, 'internal reserved bits must be zero');
        assert.ok((flags & 3) <= 2, 'split axis must be 0, 1, or 2');
        assert.ok(depth < maxDepth, 'internal node at maxDepth');

        const right = getRightChild(uint32, node);
        const [leftEnd, leftContents] = visit(node + 1, depth + 1);
        assert.equal(right, leftEnd, `right child of ${node} must follow its left subtree`);
        assert.equal(right - node - 1, leftEnd - (node + 1), 'relative offset - 1 is the left subtree size');
        const [end, rightContents] = visit(right, depth + 1);

        assertContains(box, nodeBox(float32, node + 1), `node ${node} left child`);
        assertContains(box, nodeBox(float32, right), `node ${node} right child`);
        const contents = union(leftContents, rightContents);
        if (exact) {
            assert.deepEqual(box, contents, `node ${node} is not tight`);
        }
        return [end, contents];
    }

    const [end] = visit(0, 0);
    assert.equal(end, nodeCount, 'every node must be reachable');
    assert.equal(nextPrimitive, primitiveCount, 'leaves must cover every primitive');
    return treeDepth;
}

export {
    buildModes,
    cloneTree,
    createGrid,
    createRandom,
    createRandomRays,
    createTriangleSoup,
    raycastBruteForce,
    strategies,
    validateTree,
};
