import { BVH_NODE_WORDS, createNodeArrays } from './BVHLayout.js';

/**
 * Packs independent trees into one node buffer and one primitive index
 * buffer, for example a static scene, animated objects, and lights that are
 * built, refit, or replaced separately.
 *
 * Offsets inside a tree are relative, so each tree is copied unchanged. A leaf
 * offset is relative to the tree's `primitiveOffset`, and its primitive
 * indices keep the tree's own numbering; callers map them to their geometry.
 *
 * Returns the packed arrays, a root table with `nodeOffset`, `nodeCount`,
 * `primitiveOffset`, and `primitiveCount` per tree, and `trees`: views whose
 * arrays are subarrays of the packed ones. Queries and refits accept these
 * views, and a refit through a view writes straight into the packed buffer,
 * so only that tree's node range needs to be uploaded again.
 */
function packBVHs(trees) {
    let nodeCount = 0;
    let primitiveCount = 0;
    for (const tree of trees) {
        nodeCount += tree.nodeCount;
        primitiveCount += tree.primitiveCount;
    }

    const { buffer, float32, uint32 } = createNodeArrays(nodeCount);
    const primitiveIndices = new Uint32Array(primitiveCount);
    const roots = [];
    const views = [];
    let nodeOffset = 0;
    let primitiveOffset = 0;

    for (const tree of trees) {
        // Copy through the integer view so flag words stay bit-exact.
        uint32.set(tree.uint32, BVH_NODE_WORDS * nodeOffset);
        primitiveIndices.set(tree.primitiveIndices, primitiveOffset);

        const root = {
            nodeOffset,
            nodeCount: tree.nodeCount,
            primitiveOffset,
            primitiveCount: tree.primitiveCount,
        };
        roots.push(root);
        views.push(createTreeView(float32, uint32, primitiveIndices, root));

        nodeOffset += tree.nodeCount;
        primitiveOffset += tree.primitiveCount;
    }

    return {
        buffer,
        float32,
        uint32,
        primitiveIndices,
        nodeCount,
        primitiveCount,
        roots,
        trees: views,
    };
}

// A tree view over shared node and primitive arrays, described by a root table entry.
function createTreeView(float32, uint32, primitiveIndices, root) {
    const begin = BVH_NODE_WORDS * root.nodeOffset;
    const end = begin + BVH_NODE_WORDS * root.nodeCount;
    return {
        float32: float32.subarray(begin, end),
        uint32: uint32.subarray(begin, end),
        primitiveIndices: primitiveIndices.subarray(root.primitiveOffset, root.primitiveOffset + root.primitiveCount),
        nodeCount: root.nodeCount,
        primitiveCount: root.primitiveCount,
    };
}

export {
    createTreeView,
    packBVHs,
};
