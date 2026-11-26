import assert from 'node:assert/strict';
import test from 'node:test';

import { computeTriangleBounds } from '../../extend/partition/triangles.js';
import { buildBVH } from '../../extend/partition/bvh/buildBVH.js';
import { refitBVH, refitTriangles } from '../../extend/partition/bvh/refitBVH.js';
import { createTraversalStack, getBVHStats, raycastTriangles } from '../../extend/partition/bvh/queryBVH.js';
import {
    cloneTree,
    createGrid,
    createRandom,
    createRandomRays,
    raycastBruteForce,
    validateTree,
} from './helpers.js';

const random = createRandom(23);
const rays = createRandomRays(300, random);

function deform(positions, time) {
    const deformed = positions.slice();
    for (let vertex = 0; vertex < deformed.length; vertex += 3) {
        const x = deformed[vertex];
        const y = deformed[vertex + 1];
        deformed[vertex] = x + 0.2 * Math.sin(4 * y + time);
        deformed[vertex + 2] = 0.5 * Math.sin(3 * x + time) * Math.cos(2 * y);
    }
    return deformed;
}

test('refit gives exact bounds and correct hits after deformation', () => {
    const { positions, index } = createGrid(40);
    const tree = buildBVH(computeTriangleBounds(positions, index));
    const before = new Uint32Array(tree.uint32);

    const deformed = deform(positions, 1.3);
    const deformedBounds = computeTriangleBounds(deformed, index);
    refitBVH(tree, deformedBounds);
    validateTree(tree, deformedBounds, { exact: true });

    for (let word = 0; word < before.length; word += 8) {
        assert.equal(tree.uint32[word + 3], before[word + 3], 'refit must not change child or offset words');
        assert.equal(tree.uint32[word + 7], before[word + 7], 'refit must not change flag words');
    }

    const stack = createTraversalStack();
    const hit = new Float64Array(3);
    const expectedHit = new Float64Array(3);
    for (const ray of rays) {
        const expected = raycastBruteForce(deformed, index, ray, expectedHit);
        assert.equal(raycastTriangles(tree, deformed, index, ray, stack, hit), expected);
    }
});

test('refitBVH and refitTriangles write identical bytes', () => {
    const { positions, index } = createGrid(30);
    const tree = buildBVH(computeTriangleBounds(positions, index));
    const fromBounds = cloneTree(tree);
    const fromVertices = cloneTree(tree);

    for (const time of [0.4, 2.1]) {
        const deformed = deform(positions, time);
        refitBVH(fromBounds, computeTriangleBounds(deformed, index));
        refitTriangles(fromVertices, deformed, index);
        assert.deepEqual(new Uint8Array(fromVertices.buffer), new Uint8Array(fromBounds.buffer));
    }
});

test('refitting to the original positions restores the build', () => {
    const { positions, index } = createGrid(16);
    const tree = buildBVH(computeTriangleBounds(positions, index));
    const original = new Uint8Array(tree.buffer.slice(0));
    refitTriangles(tree, deform(positions, 0.7), index);
    refitTriangles(tree, positions, index);
    assert.deepEqual(new Uint8Array(tree.buffer), original);
});

test('refit cost grows with deformation and stays finite', () => {
    const { positions, index } = createGrid(40);
    const tree = buildBVH(computeTriangleBounds(positions, index));
    const deformed = deform(positions, 2);
    refitTriangles(tree, deformed, index);
    const refit = getBVHStats(tree);
    const rebuilt = getBVHStats(buildBVH(computeTriangleBounds(deformed, index)));
    assert.ok(Number.isFinite(refit.sahCost));
    assert.ok(refit.sahCost >= rebuilt.sahCost * 0.9);
});

test('refitBVH rejects bounds for a different primitive count', () => {
    const tree = buildBVH(new Float32Array([0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3]));
    assert.throws(() => refitBVH(tree, new Float32Array(6)), /exactly/);
});
