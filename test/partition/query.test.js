import assert from 'node:assert/strict';
import test from 'node:test';

import { setRay } from '../../extend/partition/aabb.js';
import { computeTriangleBounds, intersectTriangle } from '../../extend/partition/triangles.js';
import { createNodeArrays, readNodeBounds } from '../../extend/partition/bvh/BVHLayout.js';
import { buildBVH } from '../../extend/partition/bvh/buildBVH.js';
import { createTreeView, packBVHs } from '../../extend/partition/bvh/packBVHs.js';
import {
    createTraversalStack,
    raycastBVH,
    raycastTriangles,
    traceRaycastTriangles,
    traversalCounters,
} from '../../extend/partition/bvh/queryBVH.js';
import {
    createGrid,
    createRandom,
    createRandomRays,
    createTriangleSoup,
    raycastBruteForce,
    strategies,
} from './helpers.js';

const random = createRandom(11);
const soup = createTriangleSoup(2000, random);
const grid = createGrid(24, (x, y) => 0.3 * Math.sin(3 * x) * Math.cos(2 * y));
const rays = createRandomRays(400, random);

function assertSameHits(tree, positions, index, message) {
    const stack = createTraversalStack();
    const hit = new Float64Array(3);
    const expectedHit = new Float64Array(3);
    let hits = 0;
    for (const ray of rays) {
        const expected = raycastBruteForce(positions, index, ray, expectedHit);
        const actual = raycastTriangles(tree, positions, index, ray, stack, hit);
        assert.equal(actual, expected, message);
        if (expected !== -1) {
            assert.deepEqual(hit, expectedHit, message);
            hits++;
        }
    }
    assert.ok(hits > rays.length / 10, `${message}: too few hits (${hits}) to be meaningful`);
}

for (const strategy of strategies) {
    test(`${strategy}: raycasts match brute force`, () => {
        const options = { strategy };
        assertSameHits(buildBVH(computeTriangleBounds(soup), options), soup, null, 'soup');
        assertSameHits(
            buildBVH(computeTriangleBounds(grid.positions, grid.index), options),
            grid.positions,
            grid.index,
            'grid'
        );
    });
}

test('raycastBVH with a triangle callback matches raycastTriangles', () => {
    const tree = buildBVH(computeTriangleBounds(soup));
    const stack = createTraversalStack();
    const hit = new Float64Array(3);
    const triangleHit = new Float64Array(3);
    const expectedHit = new Float64Array(3);

    for (const ray of rays) {
        const expected = raycastTriangles(tree, soup, null, ray, stack, expectedHit);
        const actual = raycastBVH(tree, ray, stack, hit, (triangle, tMin, closest) => (
            intersectTriangle(soup, null, triangle, ray, tMin, closest, triangleHit) ? triangleHit[0] : Infinity
        ));
        assert.equal(actual, expected);
        if (expected !== -1) {
            assert.equal(hit[0], expectedHit[0]);
        }
    }
});

test('tMin and tMax limit the hit distance', () => {
    const tree = buildBVH(computeTriangleBounds(soup));
    const stack = createTraversalStack();
    const hit = new Float64Array(3);
    const expectedHit = new Float64Array(3);
    for (const ray of rays) {
        const expected = raycastBruteForce(soup, null, ray, expectedHit, 2.5, 3.5);
        assert.equal(raycastTriangles(tree, soup, null, ray, stack, hit, 2.5, 3.5), expected);
    }
});

test('traceRaycastTriangles reports the nodes raycastTriangles visits and finds the same hit', () => {
    const tree = buildBVH(computeTriangleBounds(soup));
    const stack = createTraversalStack();
    const hit = new Float64Array(3);
    const traceHit = new Float64Array(3);
    for (const ray of rays) {
        traversalCounters.nodes = 0;
        const expected = raycastTriangles(tree, soup, null, ray, stack, hit);
        let visited = 0;
        let entered = 0;
        const actual = traceRaycastTriangles(tree, soup, null, ray, stack, traceHit, (node, inside) => {
            visited++;
            entered += inside ? 1 : 0;
        });
        assert.equal(actual, expected);
        assert.equal(visited, traversalCounters.nodes);
        assert.ok(entered <= visited);
        if (expected !== -1) {
            assert.deepEqual(traceHit, hit);
        }
    }
});

test('a tree copied into the middle of a larger buffer traverses the same', () => {
    const tree = buildBVH(computeTriangleBounds(soup));
    const { float32, uint32 } = createNodeArrays(100 + tree.nodeCount + 5);
    uint32.set(tree.uint32, 8 * 100);
    const view = createTreeView(float32, uint32, tree.primitiveIndices, {
        nodeOffset: 100,
        nodeCount: tree.nodeCount,
        primitiveOffset: 0,
        primitiveCount: tree.primitiveCount,
    });
    assertSameHits(view, soup, null, 'relocated');
});

test('a top-level BVH over independent trees supports nested traversal', () => {
    const offsets = [[-3, 0, 0], [0, 0, 0], [3, 0.5, 0]];
    const objects = offsets.map((offset) => createTriangleSoup(600, random, { offset, size: 0.4 }));
    const trees = objects.map((positions) => buildBVH(computeTriangleBounds(positions)));
    const packed = packBVHs(trees);

    const rootBounds = new Float32Array(6 * trees.length);
    trees.forEach((tree, object) => readNodeBounds(tree.float32, 0, rootBounds, 6 * object));
    const topLevel = buildBVH(rootBounds, { leafThreshold: 1 });

    const outerStack = createTraversalStack();
    const innerStack = createTraversalStack();
    const outerHit = new Float64Array(3);
    const innerHit = new Float64Array(3);
    const expectedHit = new Float64Array(3);
    const sceneRays = [
        ...createRandomRays(150, random, [-3, 0, 0]),
        ...createRandomRays(150, random, [3, 0.5, 0]),
    ];

    for (const blas of [trees, packed.trees]) {
        let hits = 0;
        for (const ray of sceneRays) {
            let expectedObject = -1;
            let closest = Infinity;
            objects.forEach((positions, object) => {
                if (raycastBruteForce(positions, null, ray, expectedHit, 0, closest) !== -1) {
                    closest = expectedHit[0];
                    expectedObject = object;
                }
            });

            let hitTriangle = -1;
            const object = raycastBVH(topLevel, ray, outerStack, outerHit, (candidate, tMin, tMax) => {
                const triangle = raycastTriangles(
                    blas[candidate],
                    objects[candidate],
                    null,
                    ray,
                    innerStack,
                    innerHit,
                    tMin,
                    tMax
                );
                if (triangle === -1) {
                    return Infinity;
                }
                hitTriangle = triangle;
                return innerHit[0];
            });

            assert.equal(object, expectedObject);
            if (object !== -1) {
                assert.equal(outerHit[0], closest);
                assert.notEqual(hitTriangle, -1);
                hits++;
            }
        }
        assert.ok(hits > 50);
    }
});

test('a stack smaller than the tree depth throws', () => {
    const tree = buildBVH(computeTriangleBounds(soup));
    const ray = setRay(new Float64Array(9), 0, 0, -5, 0, 0, 1);
    assert.throws(
        () => raycastTriangles(tree, soup, null, ray, createTraversalStack(0), new Float64Array(3)),
        /stack/
    );
});

test('traversal counters count visited nodes', () => {
    const tree = buildBVH(computeTriangleBounds(soup));
    traversalCounters.nodes = 0;
    raycastTriangles(tree, soup, null, rays[0], createTraversalStack(), new Float64Array(3));
    assert.ok(traversalCounters.nodes >= 1 && traversalCounters.nodes <= tree.nodeCount);
});
