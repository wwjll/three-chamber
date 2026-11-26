/**
 * Binary BVH node encoding.
 *
 * Every node is 32 bytes of one ArrayBuffer, read through Float32Array and
 * Uint32Array views of that buffer:
 *
 *   word 0-2  f32  bounds minimum xyz
 *   word 3    u32  internal: right child index relative to this node
 *                  leaf: first primitiveIndices entry, relative to the tree
 *   word 4-6  f32  bounds maximum xyz
 *   word 7    u32  flags
 *                  bit 31     leaf flag
 *                  leaf:      bits 0-15 primitive count, bits 16-30 reserved
 *                  internal:  bits 0-1 split axis, bits 2-30 reserved
 *
 * Nodes are stored depth first, so the left child of node i is node i + 1 and
 * every child follows its parent. All offsets are relative, so a tree can be
 * copied to any position of a larger buffer without being rewritten. The word
 * order matches the WGSL struct
 * { min: vec3f, childOrOffset: u32, max: vec3f, flags: u32 }.
 */

const BVH_NODE_BYTES = 32;
const BVH_NODE_WORDS = 8;
const BVH_LEAF_FLAG = 0x80000000;
const BVH_LEAF_COUNT_MASK = 0xffff;
const BVH_SPLIT_AXIS_MASK = 0x3;
const BVH_MAX_LEAF_SIZE = BVH_LEAF_COUNT_MASK;

function createNodeArrays(nodeCount) {
    const buffer = new ArrayBuffer(nodeCount * BVH_NODE_BYTES);
    return {
        buffer,
        float32: new Float32Array(buffer),
        uint32: new Uint32Array(buffer),
    };
}

function isLeaf(uint32, node) {
    return (uint32[BVH_NODE_WORDS * node + 7] & BVH_LEAF_FLAG) !== 0;
}

function getLeafOffset(uint32, node) {
    return uint32[BVH_NODE_WORDS * node + 3];
}

function getLeafCount(uint32, node) {
    return uint32[BVH_NODE_WORDS * node + 7] & BVH_LEAF_COUNT_MASK;
}

function getRightChild(uint32, node) {
    return node + uint32[BVH_NODE_WORDS * node + 3];
}

function getSplitAxis(uint32, node) {
    return uint32[BVH_NODE_WORDS * node + 7] & BVH_SPLIT_AXIS_MASK;
}

function writeLeaf(uint32, node, offset, count) {
    uint32[BVH_NODE_WORDS * node + 3] = offset;
    uint32[BVH_NODE_WORDS * node + 7] = (BVH_LEAF_FLAG | count) >>> 0;
}

function writeInternal(uint32, node, axis) {
    uint32[BVH_NODE_WORDS * node + 7] = axis;
}

function setRightChild(uint32, node, rightChild) {
    uint32[BVH_NODE_WORDS * node + 3] = rightChild - node;
}

// Copies [min.xyz, max.xyz] from `bounds` into the node.
function writeNodeBounds(float32, node, bounds, offset = 0) {
    const word = BVH_NODE_WORDS * node;
    float32[word] = bounds[offset];
    float32[word + 1] = bounds[offset + 1];
    float32[word + 2] = bounds[offset + 2];
    float32[word + 4] = bounds[offset + 3];
    float32[word + 5] = bounds[offset + 4];
    float32[word + 6] = bounds[offset + 5];
}

// Copies the node bounds into `target` as [min.xyz, max.xyz].
function readNodeBounds(float32, node, target = new Float32Array(6), offset = 0) {
    const word = BVH_NODE_WORDS * node;
    target[offset] = float32[word];
    target[offset + 1] = float32[word + 1];
    target[offset + 2] = float32[word + 2];
    target[offset + 3] = float32[word + 4];
    target[offset + 4] = float32[word + 5];
    target[offset + 5] = float32[word + 6];
    return target;
}

export {
    BVH_LEAF_COUNT_MASK,
    BVH_LEAF_FLAG,
    BVH_MAX_LEAF_SIZE,
    BVH_NODE_BYTES,
    BVH_NODE_WORDS,
    BVH_SPLIT_AXIS_MASK,
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
};
