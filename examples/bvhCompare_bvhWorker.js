import { createRay, setRay, setRayFromCamera } from '../extend/partition/aabb.js';
import { computeTriangleBounds, getTriangleCount, intersectTriangle } from '../extend/partition/triangles.js';
import { BVH_NODE_WORDS } from '../extend/partition/bvh/BVHLayout.js';
import { buildBVH, defaultBuildOptions } from '../extend/partition/bvh/buildBVH.js';
import { refitTriangles } from '../extend/partition/bvh/refitBVH.js';
import {
    createTraversalStack,
    getBVHStats,
    raycastTriangles,
    traceRaycastTriangles,
    traversalCounters,
} from '../extend/partition/bvh/queryBVH.js';

/**
 * Worker entry of the bvhCompare example. It builds, refits, and probes one
 * triangle BVH off the main thread using the plain functions of
 * extend/partition. bvhCompare.js creates it with
 * `new Worker(new URL('./bvhCompare_bvhWorker.js', import.meta.url), { type: 'module' })`.
 *
 * Use one worker per build configuration. The worker owns the geometry and
 * the tree. The node buffer is transferred to the main thread after every
 * build or update and must come straight back in a `nodes` message; anything
 * that reads the tree waits for it. Callers choose every count and threshold
 * in their messages.
 *
 * Messages in → out:
 * - build { positions, index, buildOptions, animationUpdate, repeats, probeRayCount }
 *   → built { nodes, nodeCount, stats }
 * - nodes { nodes } returns the node buffer.
 * - update { positions, rebuildThreshold }
 *   → updated { nodes, nodeCount, stats, refitMs, rebuildMs, rebuilt, sahRatio, positions }
 * - heatmap { jobId, camera, width, height, region, batchPixels }
 *   → heatmapRows { jobId, rowStart, rowCount, data } …, heatmapDone { jobId, averageNodes }
 * - pick { camera, ndc } → picked { boxes, entered, triangle, distance, vertices }
 * - verify { jobId, rayCount, sliceMs }
 *   → verifyProgress { jobId, done, rayCount, elapsedMs } …, verified { jobId, rayCount, hits, mismatches, elapsedMs }
 * - any failure → error { message }
 *
 * `camera` is { origin, unproject } as described for setRayFromCamera.
 * A heat map covers `region` = [xMin, yMin, xMax, yMax] in the camera's NDC
 * with width × height rays, one at the center of each cell, row 0 at yMin.
 * Heat maps and verification run in slices and yield between them, so other
 * messages are handled meanwhile; a newer job of the same kind replaces a
 * running one.
 */

const state = {
    buildOptions: null,
    animationUpdate: 'refit',
    positions: null,
    index: null,
    tree: null,
    stack: null,
    baseSahCost: 0,
    heatmapJob: -1,
    verifyJob: -1,
};
const ray = createRay();
const hit = new Float64Array(3);
const bruteHit = new Float64Array(3);

function nextTask() {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

async function waitForTree() {
    while (state.tree.buffer === null) {
        await nextTask();
    }
}

function sendTree(type, message, transfer = []) {
    const { buffer, nodeCount } = state.tree;
    state.tree.buffer = null;
    state.tree.float32 = null;
    state.tree.uint32 = null;
    self.postMessage({ type, nodes: buffer, nodeCount, ...message }, [buffer, ...transfer]);
}

function receiveTree({ nodes }) {
    state.tree.buffer = nodes;
    state.tree.float32 = new Float32Array(nodes);
    state.tree.uint32 = new Uint32Array(nodes);
}

// Mulberry32, so every configuration measures the same probe rays.
function createRandom(seed) {
    let value = seed >>> 0;
    return function random() {
        value = (value + 0x6d2b79f5) >>> 0;
        let mixed = Math.imul(value ^ (value >>> 15), value | 1);
        mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
        return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
    };
}

// A ray from a sphere around the root box toward a random point inside it.
function setProbeRay(random) {
    const bounds = state.tree.float32;
    const center = [0, 0, 0];
    const extent = [0, 0, 0];
    for (let axis = 0; axis < 3; axis++) {
        center[axis] = 0.5 * (bounds[axis] + bounds[axis + 4]);
        extent[axis] = bounds[axis + 4] - bounds[axis];
    }
    const radius = 0.75 * Math.hypot(extent[0], extent[1], extent[2]);
    const z = 2 * random() - 1;
    const angle = 2 * Math.PI * random();
    const ring = Math.sqrt(1 - z * z);
    const origin = [
        center[0] + radius * ring * Math.cos(angle),
        center[1] + radius * ring * Math.sin(angle),
        center[2] + radius * z,
    ];
    const direction = [0, 0, 0];
    for (let axis = 0; axis < 3; axis++) {
        direction[axis] = bounds[axis] + random() * extent[axis] - origin[axis];
    }
    const length = Math.hypot(direction[0], direction[1], direction[2]);
    setRay(ray, origin[0], origin[1], origin[2], direction[0] / length, direction[1] / length, direction[2] / length);
}

function median(values) {
    const sorted = values.slice().sort((a, b) => a - b);
    return sorted[sorted.length >> 1];
}

// One warm-up build, then the median of `repeats` timed builds.
function timeBuild(bounds, options, repeats) {
    let tree = buildBVH(bounds, options);
    const times = [];
    for (let run = 0; run < repeats; run++) {
        const start = performance.now();
        tree = buildBVH(bounds, options);
        times.push(performance.now() - start);
    }
    return { tree, milliseconds: median(times) };
}

function sameBytes(a, b) {
    if (a.byteLength !== b.byteLength) {
        return false;
    }
    const left = new Uint8Array(a);
    const right = new Uint8Array(b);
    for (let i = 0; i < left.length; i++) {
        if (left[i] !== right[i]) {
            return false;
        }
    }
    return true;
}

function buildTree() {
    return buildBVH(computeTriangleBounds(state.positions, state.index), state.buildOptions);
}

function describeTree() {
    return {
        ...getBVHStats(state.tree),
        buildMode: state.tree.buildMode,
        triangleCount: state.tree.primitiveCount,
    };
}

function measureNodesPerRay(rayCount) {
    const random = createRandom(1);
    traversalCounters.nodes = 0;
    for (let i = 0; i < rayCount; i++) {
        setProbeRay(random);
        raycastTriangles(state.tree, state.positions, state.index, ray, state.stack, hit);
    }
    return traversalCounters.nodes / rayCount;
}

function handleBuild({ positions, index, buildOptions, animationUpdate, repeats, probeRayCount }) {
    Object.assign(state, { positions, index, buildOptions, animationUpdate });
    state.stack = createTraversalStack(buildOptions.maxDepth ?? defaultBuildOptions.maxDepth);

    const bounds = computeTriangleBounds(positions, index);
    const recursive = timeBuild(bounds, { ...buildOptions, buildMode: 'recursive' }, repeats);
    const iterative = timeBuild(bounds, { ...buildOptions, buildMode: 'iterative' }, repeats);
    state.tree = buildBVH(bounds, buildOptions);
    const stats = describeTree();
    state.baseSahCost = stats.sahCost;

    sendTree('built', {
        stats: {
            ...stats,
            recursiveMs: recursive.milliseconds,
            iterativeMs: iterative.milliseconds,
            identical: sameBytes(recursive.tree.buffer, iterative.tree.buffer)
                && sameBytes(recursive.tree.primitiveIndices.buffer, iterative.tree.primitiveIndices.buffer),
            nodesPerRay: measureNodesPerRay(probeRayCount),
        },
    });
}

/**
 * Takes this frame's positions and returns the previous buffer, so the main
 * thread alternates between two buffers. Refit time excludes the statistics
 * pass; a rebuild above the threshold is timed separately.
 */
function handleUpdate({ positions, rebuildThreshold }) {
    const previous = state.positions;
    state.positions = positions;

    let refitMs = 0;
    if (state.animationUpdate === 'refit') {
        const start = performance.now();
        refitTriangles(state.tree, positions, state.index);
        refitMs = performance.now() - start;
    }

    let stats = describeTree();
    let rebuildMs = 0;
    let rebuilt = false;
    if (state.animationUpdate === 'rebuild' || stats.sahCost > rebuildThreshold * state.baseSahCost) {
        const start = performance.now();
        state.tree = buildTree();
        rebuildMs = performance.now() - start;
        rebuilt = true;
        stats = describeTree();
        state.baseSahCost = stats.sahCost;
    }

    sendTree('updated', {
        stats,
        refitMs,
        rebuildMs,
        rebuilt,
        sahRatio: stats.sahCost / state.baseSahCost,
        positions: previous,
    }, [previous.buffer]);
}

/**
 * Visited-node counts for one ray per heat map pixel. Rows are sent in
 * batches; between batches the worker yields so a newer job can replace this
 * one.
 */
async function handleHeatmap({ jobId, camera, width, height, region, batchPixels }) {
    state.heatmapJob = jobId;
    const [xMin, yMin, xMax, yMax] = region;
    const stepX = (xMax - xMin) / width;
    const stepY = (yMax - yMin) / height;
    const rowsPerBatch = Math.max(1, Math.floor(batchPixels / width));
    let total = 0;

    for (let rowStart = 0; rowStart < height; rowStart += rowsPerBatch) {
        await waitForTree();
        if (state.heatmapJob !== jobId) {
            return;
        }

        const rowCount = Math.min(rowsPerBatch, height - rowStart);
        const data = new Uint16Array(width * rowCount);
        for (let row = 0; row < rowCount; row++) {
            const ndcY = yMin + stepY * (rowStart + row + 0.5);
            for (let column = 0; column < width; column++) {
                setRayFromCamera(ray, camera.unproject, camera.origin, xMin + stepX * (column + 0.5), ndcY);
                traversalCounters.nodes = 0;
                raycastTriangles(state.tree, state.positions, state.index, ray, state.stack, hit);
                const nodes = traversalCounters.nodes;
                data[row * width + column] = nodes < 65535 ? nodes : 65535;
                total += nodes;
            }
        }
        self.postMessage({ type: 'heatmapRows', jobId, rowStart, rowCount, data }, [data.buffer]);
        await nextTask();
    }

    if (state.heatmapJob === jobId) {
        self.postMessage({ type: 'heatmapDone', jobId, averageNodes: total / (width * height) });
    }
}

// Every node the ray popped, as boxes, with whether the ray entered each one.
async function handlePick({ camera, ndc }) {
    await waitForTree();
    setRayFromCamera(ray, camera.unproject, camera.origin, ndc[0], ndc[1]);
    const { float32 } = state.tree;
    const { positions, index, stack } = state;
    const visited = [];
    const entered = [];
    const closestTriangle = traceRaycastTriangles(state.tree, positions, index, ray, stack, hit, (node, inside) => {
        visited.push(node);
        entered.push(inside ? 1 : 0);
    });
    const closest = closestTriangle === -1 ? Infinity : hit[0];

    const boxes = new Float32Array(6 * visited.length);
    visited.forEach((node, i) => {
        const word = BVH_NODE_WORDS * node;
        boxes.set(float32.subarray(word, word + 3), 6 * i);
        boxes.set(float32.subarray(word + 4, word + 7), 6 * i + 3);
    });
    const vertices = new Float32Array(9);
    if (closestTriangle !== -1) {
        for (let corner = 0; corner < 3; corner++) {
            const vertex = 3 * index[3 * closestTriangle + corner];
            vertices.set(positions.subarray(vertex, vertex + 3), 3 * corner);
        }
    }
    const enteredFlags = Uint8Array.from(entered);
    self.postMessage(
        { type: 'picked', boxes, entered: enteredFlags, triangle: closestTriangle, distance: closest, vertices },
        [boxes.buffer, enteredFlags.buffer, vertices.buffer]
    );
}

/**
 * Casts the ray through the tree and against every triangle. Bit 0 of the
 * result is set when brute force hits, bit 1 on a mismatch: both must find
 * the same triangle or the same distance.
 */
function verifyRay(positions, index, triangleCount) {
    const triangle = raycastTriangles(state.tree, positions, index, ray, state.stack, hit);
    let closest = Infinity;
    let expected = -1;
    for (let candidate = 0; candidate < triangleCount; candidate++) {
        if (intersectTriangle(positions, index, candidate, ray, 0, closest, bruteHit)) {
            closest = bruteHit[0];
            expected = candidate;
        }
    }
    const sameHit = triangle === expected
        || (triangle !== -1 && expected !== -1 && hit[0] === closest);
    return (expected === -1 ? 0 : 1) | (sameHit ? 0 : 2);
}

/**
 * Checks rays in slices of about `sliceMs`, reporting progress after each.
 * Positions and the tree are read at the start of every slice, since an
 * update may replace them between slices; each ray is checked within one
 * slice, so both of its casts see the same geometry.
 */
async function handleVerify({ jobId, rayCount, sliceMs }) {
    state.verifyJob = jobId;
    const random = createRandom(2);
    const start = performance.now();
    let done = 0;
    let hits = 0;
    let mismatches = 0;

    while (done < rayCount) {
        await waitForTree();
        if (state.verifyJob !== jobId) {
            return;
        }

        const { positions, index } = state;
        const triangleCount = getTriangleCount(positions, index);
        const sliceEnd = performance.now() + sliceMs;
        do {
            setProbeRay(random);
            const result = verifyRay(positions, index, triangleCount);
            hits += result & 1;
            mismatches += result >> 1;
            done++;
        } while (done < rayCount && performance.now() < sliceEnd);

        self.postMessage({ type: 'verifyProgress', jobId, done, rayCount, elapsedMs: performance.now() - start });
        await nextTask();
    }

    if (state.verifyJob === jobId) {
        self.postMessage({ type: 'verified', jobId, rayCount, hits, mismatches, elapsedMs: performance.now() - start });
    }
}

const handlers = {
    build: handleBuild,
    nodes: receiveTree,
    update: handleUpdate,
    heatmap: handleHeatmap,
    pick: handlePick,
    verify: handleVerify,
};

self.onmessage = async ({ data }) => {
    try {
        await handlers[data.type](data);
    } catch (error) {
        self.postMessage({ type: 'error', message: error.message });
    }
};
