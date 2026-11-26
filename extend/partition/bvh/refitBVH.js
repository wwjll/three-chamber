import {
    BVH_NODE_WORDS,
    getLeafCount,
    getLeafOffset,
    getRightChild,
    isLeaf,
} from './BVHLayout.js';

/**
 * Refit recomputes node bounds for moved primitives and keeps the topology.
 * Children always follow their parent, so one reverse pass over the nodes
 * finishes every child before its parent. Both functions write in place, so
 * refitting a view returned by packBVHs updates the packed buffer directly.
 */

function writeBounds(float32, node, minX, minY, minZ, maxX, maxY, maxZ) {
    const word = BVH_NODE_WORDS * node;
    float32[word] = minX;
    float32[word + 1] = minY;
    float32[word + 2] = minZ;
    float32[word + 4] = maxX;
    float32[word + 5] = maxY;
    float32[word + 6] = maxZ;
}

function unionChildren(float32, uint32, node) {
    const word = BVH_NODE_WORDS * node;
    const left = word + BVH_NODE_WORDS;
    const right = BVH_NODE_WORDS * getRightChild(uint32, node);
    for (let component = 0; component < 3; component++) {
        const leftMin = float32[left + component];
        const rightMin = float32[right + component];
        const leftMax = float32[left + component + 4];
        const rightMax = float32[right + component + 4];
        float32[word + component] = leftMin < rightMin ? leftMin : rightMin;
        float32[word + component + 4] = leftMax > rightMax ? leftMax : rightMax;
    }
}

/**
 * Refits against per-primitive bounds in input order ([min.xyz, max.xyz] per
 * primitive, Float32Array), for any primitive type.
 */
function refitBVH(tree, primitiveBounds) {
    const { float32, uint32, nodeCount, primitiveIndices } = tree;
    if (primitiveBounds.length !== 6 * tree.primitiveCount) {
        throw new Error('[BVH] refitBVH needs bounds for exactly the primitives the tree was built from.');
    }

    for (let node = nodeCount - 1; node >= 0; node--) {
        if (!isLeaf(uint32, node)) {
            unionChildren(float32, uint32, node);
            continue;
        }

        let minX = Infinity;
        let minY = Infinity;
        let minZ = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        let maxZ = -Infinity;
        const start = getLeafOffset(uint32, node);
        const end = start + getLeafCount(uint32, node);
        for (let entry = start; entry < end; entry++) {
            const i = 6 * primitiveIndices[entry];
            if (primitiveBounds[i] < minX) {
                minX = primitiveBounds[i];
            }
            if (primitiveBounds[i + 1] < minY) {
                minY = primitiveBounds[i + 1];
            }
            if (primitiveBounds[i + 2] < minZ) {
                minZ = primitiveBounds[i + 2];
            }
            if (primitiveBounds[i + 3] > maxX) {
                maxX = primitiveBounds[i + 3];
            }
            if (primitiveBounds[i + 4] > maxY) {
                maxY = primitiveBounds[i + 4];
            }
            if (primitiveBounds[i + 5] > maxZ) {
                maxZ = primitiveBounds[i + 5];
            }
        }
        writeBounds(float32, node, minX, minY, minZ, maxX, maxY, maxZ);
    }

    return tree;
}

/**
 * Refits a triangle BVH directly from vertex positions, without a
 * per-triangle bounds buffer. `positions` and `index` follow triangles.js and
 * must describe the same triangles the tree was built from.
 */
function refitTriangles(tree, positions, index = null) {
    const { float32, uint32, nodeCount, primitiveIndices } = tree;

    for (let node = nodeCount - 1; node >= 0; node--) {
        if (!isLeaf(uint32, node)) {
            unionChildren(float32, uint32, node);
            continue;
        }

        let minX = Infinity;
        let minY = Infinity;
        let minZ = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        let maxZ = -Infinity;
        const start = getLeafOffset(uint32, node);
        const end = start + getLeafCount(uint32, node);
        for (let entry = start; entry < end; entry++) {
            const first = 3 * primitiveIndices[entry];
            for (let corner = 0; corner < 3; corner++) {
                const vertex = 3 * (index === null ? first + corner : index[first + corner]);
                const x = positions[vertex];
                const y = positions[vertex + 1];
                const z = positions[vertex + 2];
                if (x < minX) {
                    minX = x;
                }
                if (y < minY) {
                    minY = y;
                }
                if (z < minZ) {
                    minZ = z;
                }
                if (x > maxX) {
                    maxX = x;
                }
                if (y > maxY) {
                    maxY = y;
                }
                if (z > maxZ) {
                    maxZ = z;
                }
            }
        }
        writeBounds(float32, node, minX, minY, minZ, maxX, maxY, maxZ);
    }

    return tree;
}

export {
    refitBVH,
    refitTriangles,
};
