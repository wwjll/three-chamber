import assert from 'node:assert/strict';
import test from 'node:test';

import {
    BVH_LEAF_FLAG,
    BVH_MAX_LEAF_SIZE,
    BVH_NODE_BYTES,
    BVH_NODE_WORDS,
    createNodeArrays,
    getLeafCount,
    getLeafOffset,
    getRightChild,
    getSplitAxis,
    isLeaf,
    readNodeBounds,
    setRightChild,
    writeInternal,
    writeLeaf,
    writeNodeBounds,
} from '../../extend/partition/bvh/BVHLayout.js';
import { buildBVH } from '../../extend/partition/bvh/buildBVH.js';

test('node is 32 bytes and fields sit at the WGSL struct offsets in little endian', () => {
    assert.equal(BVH_NODE_BYTES, 32);
    assert.equal(BVH_NODE_WORDS, 8);

    const { buffer, float32, uint32 } = createNodeArrays(4);
    writeNodeBounds(float32, 2, new Float32Array([-1, -2, -3, 4, 5, 6]));
    writeLeaf(uint32, 2, 1234, 7);

    const view = new DataView(buffer);
    const base = 2 * BVH_NODE_BYTES;
    assert.equal(view.getFloat32(base, true), -1);
    assert.equal(view.getFloat32(base + 8, true), -3);
    assert.equal(view.getUint32(base + 12, true), 1234);
    assert.equal(view.getFloat32(base + 16, true), 4);
    assert.equal(view.getFloat32(base + 24, true), 6);
    assert.equal(view.getUint32(base + 28, true), (BVH_LEAF_FLAG | 7) >>> 0);
    assert.deepEqual(Array.from(readNodeBounds(float32, 2)), [-1, -2, -3, 4, 5, 6]);
});

test('leaf flag, count, and offset round trip', () => {
    const { uint32 } = createNodeArrays(1);
    writeLeaf(uint32, 0, 0xfffffff0, BVH_MAX_LEAF_SIZE);
    assert.ok(isLeaf(uint32, 0));
    assert.equal(getLeafCount(uint32, 0), 0xffff);
    assert.equal(getLeafOffset(uint32, 0), 0xfffffff0);
    assert.equal(uint32[7] >>> 31, 1);
});

test('internal nodes store the split axis and a relative right child', () => {
    const { uint32 } = createNodeArrays(12);
    writeInternal(uint32, 3, 2);
    setRightChild(uint32, 3, 10);
    assert.ok(!isLeaf(uint32, 3));
    assert.equal(getSplitAxis(uint32, 3), 2);
    assert.equal(uint32[BVH_NODE_WORDS * 3 + 3], 7);
    assert.equal(getRightChild(uint32, 3), 10);
});

test('leafThreshold is limited by the 16-bit count field', () => {
    const bounds = new Float32Array([0, 0, 0, 1, 1, 1]);
    assert.throws(() => buildBVH(bounds, { leafThreshold: BVH_MAX_LEAF_SIZE + 1 }), /leafThreshold/);
    assert.equal(buildBVH(bounds, { leafThreshold: BVH_MAX_LEAF_SIZE }).nodeCount, 1);
});
