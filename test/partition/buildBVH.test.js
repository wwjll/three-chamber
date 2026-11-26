import assert from 'node:assert/strict';
import test from 'node:test';

import { computeTriangleBounds } from '../../extend/partition/triangles.js';
import { getLeafCount, getRightChild, isLeaf } from '../../extend/partition/bvh/BVHLayout.js';
import { buildBVH } from '../../extend/partition/bvh/buildBVH.js';
import { getBVHStats } from '../../extend/partition/bvh/queryBVH.js';
import {
    buildModes,
    createGrid,
    createRandom,
    createTriangleSoup,
    strategies,
    validateTree,
} from './helpers.js';

const random = createRandom(7);
const flatGrid = createGrid(32);
const scenes = {
    uniform: computeTriangleBounds(createTriangleSoup(3000, random)),
    clustered: computeTriangleBounds(createTriangleSoup(3000, random, { clustered: true })),
    flatGrid: computeTriangleBounds(flatGrid.positions, flatGrid.index),
};

for (const [sceneName, bounds] of Object.entries(scenes)) {
    for (const strategy of strategies) {
        for (const buildMode of buildModes) {
            test(`${sceneName}: ${strategy} / ${buildMode} keeps every invariant`, () => {
                const tree = buildBVH(bounds, { strategy, buildMode });
                assert.equal(tree.buildMode, buildMode);
                const depth = validateTree(tree, bounds, { exact: true });
                assert.equal(getBVHStats(tree).maxDepth, depth);
            });
        }
    }
}

for (const strategy of strategies) {
    test(`${strategy}: recursive and iterative builds are byte-identical`, () => {
        const options = { strategy, leafThreshold: 4 };
        const recursive = buildBVH(scenes.clustered, { ...options, buildMode: 'recursive' });
        const iterative = buildBVH(scenes.clustered, { ...options, buildMode: 'iterative' });
        assert.equal(iterative.nodeCount, recursive.nodeCount);
        assert.deepEqual(new Uint8Array(iterative.buffer), new Uint8Array(recursive.buffer));
        assert.deepEqual(iterative.primitiveIndices, recursive.primitiveIndices);
    });
}

test('auto build mode recurses unless the worst-case depth exceeds the limit', () => {
    assert.equal(buildBVH(scenes.clustered).buildMode, 'recursive');

    const fiveBoxes = scenes.uniform.subarray(0, 30);
    assert.equal(buildBVH(fiveBoxes, { recursionDepthLimit: 4 }).buildMode, 'recursive');
    assert.equal(buildBVH(fiveBoxes, { recursionDepthLimit: 3 }).buildMode, 'iterative');
    assert.equal(buildBVH(scenes.clustered, { maxDepth: 2000 }).buildMode, 'iterative');

    const options = { maxDepth: 200, recursionDepthLimit: 10, leafThreshold: 4 };
    const auto = buildBVH(scenes.clustered, options);
    const recursive = buildBVH(scenes.clustered, { ...options, buildMode: 'recursive' });
    assert.equal(auto.buildMode, 'iterative');
    assert.equal(recursive.buildMode, 'recursive');
    assert.deepEqual(new Uint8Array(auto.buffer), new Uint8Array(recursive.buffer));
    assert.deepEqual(auto.primitiveIndices, recursive.primitiveIndices);
});

test('the input bounds are never modified', () => {
    const before = scenes.uniform.slice();
    for (const strategy of strategies) {
        buildBVH(scenes.uniform, { strategy });
    }
    assert.deepEqual(scenes.uniform, before);
});

test('a single primitive becomes a root leaf', () => {
    const bounds = new Float32Array([0, 1, 2, 3, 4, 5]);
    for (const buildMode of ['auto', ...buildModes]) {
        const tree = buildBVH(bounds, { buildMode, maxDepth: 0 });
        assert.equal(tree.nodeCount, 1);
        assert.ok(isLeaf(tree.uint32, 0));
        assert.equal(getLeafCount(tree.uint32, 0), 1);
        assert.deepEqual(Array.from(tree.primitiveIndices), [0]);
    }
});

test('coincident primitives are halved until leaves fit', () => {
    const bounds = new Float32Array(6 * 100);
    for (let i = 0; i < 100; i++) {
        bounds.set([1, 1, 1, 2, 2, 2], 6 * i);
    }
    for (const strategy of strategies) {
        const tree = buildBVH(bounds, { strategy });
        validateTree(tree, bounds);
        assert.throws(() => buildBVH(bounds, { strategy, maxDepth: 2 }), /maxDepth/);
    }
});

test('invalid input and options throw', () => {
    const valid = new Float32Array([0, 0, 0, 1, 1, 1]);
    assert.throws(() => buildBVH([0, 0, 0, 1, 1, 1]), /Float32Array/);
    assert.throws(() => buildBVH(new Float32Array(0)), /non-empty/);
    assert.throws(() => buildBVH(new Float32Array(5)), /six values/);
    assert.throws(() => buildBVH(new Float32Array([0, 0, 0, NaN, 1, 1])), /invalid bounds/);
    assert.throws(() => buildBVH(new Float32Array([0, 2, 0, 1, 1, 1])), /invalid bounds/);
    assert.throws(() => buildBVH(valid, { strategy: 'median' }), /strategy/);
    assert.throws(() => buildBVH(valid, { buildMode: 'bfs' }), /buildMode/);
    assert.throws(() => buildBVH(valid, { recursionDepthLimit: -1 }), /recursionDepthLimit/);
    assert.throws(() => buildBVH(valid, { binCount: 1 }), /binCount/);
    assert.throws(() => buildBVH(valid, { leafThreshold: 0 }), /leafThreshold/);
    assert.throws(() => buildBVH(valid, { maxDepth: -1 }), /maxDepth/);
});

test('SAH costs no more than center splits on clustered data', () => {
    const sah = getBVHStats(buildBVH(scenes.clustered, { strategy: 'sah' }));
    const center = getBVHStats(buildBVH(scenes.clustered, { strategy: 'center' }));
    assert.ok(sah.sahCost <= center.sahCost, `sah ${sah.sahCost} > center ${center.sahCost}`);
});

for (const strategy of strategies) {
    test(`${strategy}: a node becomes a leaf exactly when it fits leafThreshold`, () => {
        const leafThreshold = 4;
        const { uint32 } = buildBVH(scenes.clustered, { strategy, leafThreshold });
        function countPrimitives(node) {
            if (isLeaf(uint32, node)) {
                const count = getLeafCount(uint32, node);
                assert.ok(count <= leafThreshold, `leaf of ${count}`);
                return count;
            }
            const count = countPrimitives(node + 1) + countPrimitives(getRightChild(uint32, node));
            assert.ok(count > leafThreshold, `internal node of ${count}`);
            return count;
        }
        assert.equal(countPrimitives(0), scenes.clustered.length / 6);
    });
}
