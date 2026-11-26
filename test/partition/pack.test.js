import assert from 'node:assert/strict';
import test from 'node:test';

import { computeTriangleBounds } from '../../extend/partition/triangles.js';
import { BVH_NODE_BYTES } from '../../extend/partition/bvh/BVHLayout.js';
import { buildBVH } from '../../extend/partition/bvh/buildBVH.js';
import { packBVHs } from '../../extend/partition/bvh/packBVHs.js';
import { refitTriangles } from '../../extend/partition/bvh/refitBVH.js';
import { createGrid, createRandom, createTriangleSoup, validateTree } from './helpers.js';

const random = createRandom(31);
const objects = [
    { positions: createTriangleSoup(500, random), index: null },
    createGrid(12),
    { positions: createTriangleSoup(80, random, { offset: [4, 0, 0] }), index: null },
];
const bounds = objects.map(({ positions, index }) => computeTriangleBounds(positions, index));
const trees = bounds.map((primitiveBounds) => buildBVH(primitiveBounds));

test('packed trees keep their bytes and get a root table', () => {
    const packed = packBVHs(trees);
    let nodeOffset = 0;
    let primitiveOffset = 0;

    trees.forEach((tree, i) => {
        assert.deepEqual(packed.roots[i], {
            nodeOffset,
            nodeCount: tree.nodeCount,
            primitiveOffset,
            primitiveCount: tree.primitiveCount,
        });
        const view = packed.trees[i];
        assert.deepEqual(view.uint32, tree.uint32);
        assert.deepEqual(view.primitiveIndices, tree.primitiveIndices);
        assert.equal(view.uint32.buffer, packed.buffer);
        validateTree(view, bounds[i], { exact: true });
        nodeOffset += tree.nodeCount;
        primitiveOffset += tree.primitiveCount;
    });

    assert.equal(packed.nodeCount, nodeOffset);
    assert.equal(packed.primitiveCount, primitiveOffset);
    assert.equal(packed.buffer.byteLength, nodeOffset * BVH_NODE_BYTES);
});

test('refitting one packed tree only rewrites its node range', () => {
    const packed = packBVHs(trees);
    const before = new Uint8Array(packed.buffer.slice(0));

    const { positions, index } = objects[1];
    const moved = positions.map((value, i) => (i % 3 === 2 ? value + 0.25 * Math.sin(positions[i - 2] * 5) : value));
    refitTriangles(packed.trees[1], moved, index);
    validateTree(packed.trees[1], computeTriangleBounds(moved, index), { exact: true });

    const after = new Uint8Array(packed.buffer);
    const begin = packed.roots[1].nodeOffset * BVH_NODE_BYTES;
    const end = begin + packed.roots[1].nodeCount * BVH_NODE_BYTES;
    assert.deepEqual(after.subarray(0, begin), before.subarray(0, begin));
    assert.deepEqual(after.subarray(end), before.subarray(end));
    assert.notDeepEqual(after.subarray(begin, end), before.subarray(begin, end));
});
