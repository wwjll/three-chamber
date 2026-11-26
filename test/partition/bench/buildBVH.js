import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { cpus, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { setRay } from '../../../extend/partition/aabb.js';
import { computeTriangleBounds, getTriangleCount } from '../../../extend/partition/triangles.js';
import { buildBVH } from '../../../extend/partition/bvh/buildBVH.js';
import { refitTriangles } from '../../../extend/partition/bvh/refitBVH.js';
import { createTraversalStack, getBVHStats, raycastTriangles, traversalCounters } from '../../../extend/partition/bvh/queryBVH.js';

/**
 * Measures buildBVH, ray queries, and refit for several build configurations.
 *
 *   pnpm run bench:partition [--runs 11] [--warmup 3] [--rays 100000] [--report 1]
 *
 * The parent process runs every (dataset, configuration) case in its own
 * child process (started with --expose-gc), one at a time, so the JIT state of
 * one case never affects another. It is not part of `pnpm test`. Every timed
 * item is warmed up, then measured `runs` times with a GC before each sample;
 * tables show the median and p10–p90. `--report 1` rewrites the report from
 * the saved results without running any case.
 */

const MODEL_URL = 'https://raw.githubusercontent.com/mrdoob/three.js/r187/examples/models/gltf/Xbot.glb';
const workDirectory = join(tmpdir(), 'three-chamber-bvh-bench');
const scriptPath = fileURLToPath(import.meta.url);

const datasets = ['sphere', 'xbot', 'slivers'];
const configurations = [
    { strategy: 'sah', binCount: 8 },
    { strategy: 'sah', binCount: 16 },
    { strategy: 'sah', binCount: 32 },
    { strategy: 'center', binCount: 16 },
];
const LEAF_THRESHOLD = 8;

// Mulberry32, so every process generates the same data and rays.
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

// ---------------------------------------------------------------- datasets

// A displaced latitude-longitude sphere: a closed, evenly tessellated high-polygon surface.
function createSphere(rings = 400, segments = 400) {
    const positions = new Float32Array(3 * (rings + 1) * (segments + 1));
    let vertex = 0;
    for (let ring = 0; ring <= rings; ring++) {
        const theta = (Math.PI * ring) / rings;
        for (let segment = 0; segment <= segments; segment++) {
            const phi = (2 * Math.PI * segment) / segments;
            const radius = 1 + 0.06 * Math.sin(13 * theta) * Math.cos(11 * phi) + 0.02 * Math.sin(41 * theta + 29 * phi);
            positions[vertex++] = radius * Math.sin(theta) * Math.cos(phi);
            positions[vertex++] = radius * Math.cos(theta);
            positions[vertex++] = radius * Math.sin(theta) * Math.sin(phi);
        }
    }
    const index = new Uint32Array(6 * rings * segments);
    let entry = 0;
    for (let ring = 0; ring < rings; ring++) {
        for (let segment = 0; segment < segments; segment++) {
            const a = ring * (segments + 1) + segment;
            const b = a + segments + 1;
            index.set([a, b, a + 1, a + 1, b, b + 1], entry);
            entry += 6;
        }
    }
    return { positions, index, description: `displaced sphere, ${rings}×${segments} quads` };
}

function readAccessor(json, binary, accessorIndex) {
    const accessor = json.accessors[accessorIndex];
    const view = json.bufferViews[accessor.bufferView];
    const components = { SCALAR: 1, VEC3: 3 }[accessor.type];
    const ArrayType = { 5121: Uint8Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array }[accessor.componentType];
    const elementBytes = components * ArrayType.BYTES_PER_ELEMENT;
    const stride = view.byteStride ?? elementBytes;
    const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
    const result = new ArrayType(components * accessor.count);
    for (let element = 0; element < accessor.count; element++) {
        const offset = binary.byteOffset + start + element * stride;
        result.set(new ArrayType(binary.buffer.slice(offset, offset + elementBytes)), components * element);
    }
    return result;
}

// Every triangle primitive of a GLB in mesh space, that is the bind pose of skinned meshes.
async function loadModel() {
    mkdirSync(workDirectory, { recursive: true });
    const file = join(workDirectory, 'Xbot.glb');
    if (!existsSync(file)) {
        const response = await fetch(MODEL_URL);
        if (!response.ok) {
            throw new Error(`Could not download ${MODEL_URL}: ${response.status}`);
        }
        writeFileSync(file, Buffer.from(await response.arrayBuffer()));
    }
    const glb = readFileSync(file);
    const jsonLength = glb.readUInt32LE(12);
    const json = JSON.parse(glb.subarray(20, 20 + jsonLength).toString('utf8'));
    const binary = glb.subarray(28 + jsonLength);

    const parts = [];
    for (const mesh of json.meshes) {
        for (const primitive of mesh.primitives) {
            if ((primitive.mode ?? 4) !== 4) {
                continue;
            }
            const positions = readAccessor(json, binary, primitive.attributes.POSITION);
            const vertexCount = positions.length / 3;
            const index = primitive.indices === undefined
                ? Uint32Array.from({ length: vertexCount }, (_, i) => i)
                : readAccessor(json, binary, primitive.indices);
            parts.push({ positions, index });
        }
    }

    const positions = new Float32Array(parts.reduce((sum, part) => sum + part.positions.length, 0));
    const index = new Uint32Array(parts.reduce((sum, part) => sum + part.index.length, 0));
    let vertexBase = 0;
    let entry = 0;
    for (const part of parts) {
        positions.set(part.positions, 3 * vertexBase);
        for (let i = 0; i < part.index.length; i++) {
            index[entry++] = part.index[i] + vertexBase;
        }
        vertexBase += part.positions.length / 3;
    }
    return { positions, index, description: 'three.js Xbot.glb, bind pose (mesh space, node transforms not applied)' };
}

/**
 * "Teapot in a stadium" with slivers: long thin triangles spread over a
 * 200-unit box around a dense cluster of tiny triangles at the origin.
 */
function createSlivers(sliverCount = 20000, clusterCount = 180000) {
    const random = createRandom(5);
    const positions = new Float32Array(9 * (sliverCount + clusterCount));
    const direction = [0, 0, 0];
    const side = [0, 0, 0];
    let offset = 0;

    function randomUnit(target) {
        const z = 2 * random() - 1;
        const angle = 2 * Math.PI * random();
        const ring = Math.sqrt(1 - z * z);
        target[0] = ring * Math.cos(angle);
        target[1] = ring * Math.sin(angle);
        target[2] = z;
    }

    function writeTriangle(center, length, width) {
        randomUnit(direction);
        randomUnit(side);
        const along = side[0] * direction[0] + side[1] * direction[1] + side[2] * direction[2];
        for (let axis = 0; axis < 3; axis++) {
            side[axis] -= along * direction[axis];
        }
        const sideLength = Math.hypot(side[0], side[1], side[2]);
        for (let axis = 0; axis < 3; axis++) {
            positions[offset + axis] = center[axis] - 0.5 * length * direction[axis];
            positions[offset + 3 + axis] = center[axis] + 0.5 * length * direction[axis];
            positions[offset + 6 + axis] = center[axis] + (width * side[axis]) / sideLength;
        }
        offset += 9;
    }

    for (let i = 0; i < sliverCount; i++) {
        writeTriangle([200 * random() - 100, 200 * random() - 100, 200 * random() - 100], 10 + 30 * random(), 0.005);
    }
    const center = [0, 0, 0];
    for (let i = 0; i < clusterCount; i++) {
        randomUnit(center);
        const radius = Math.cbrt(random());
        writeTriangle([radius * center[0], radius * center[1], radius * center[2]], 0.002, 0.001);
    }
    return {
        positions,
        index: null,
        description: `${sliverCount} slivers (10–40 × 0.005) in a 200³ box + ${clusterCount} triangles of 0.002 in a unit ball`,
    };
}

async function loadDataset(name) {
    if (name === 'sphere') {
        return createSphere();
    }
    if (name === 'xbot') {
        return loadModel();
    }
    return createSlivers();
}

// Rays from a sphere around the root box toward random points inside it.
function createRays(rootBounds, count) {
    const random = createRandom(7);
    const rays = new Float64Array(6 * count);
    const center = [0, 0, 0];
    const extent = [0, 0, 0];
    for (let axis = 0; axis < 3; axis++) {
        center[axis] = 0.5 * (rootBounds[axis] + rootBounds[axis + 4]);
        extent[axis] = rootBounds[axis + 4] - rootBounds[axis];
    }
    const radius = 0.75 * Math.hypot(extent[0], extent[1], extent[2]);
    for (let ray = 0; ray < count; ray++) {
        const z = 2 * random() - 1;
        const angle = 2 * Math.PI * random();
        const ring = Math.sqrt(1 - z * z);
        const origin = [center[0] + radius * ring * Math.cos(angle), center[1] + radius * ring * Math.sin(angle), center[2] + radius * z];
        const direction = [0, 1, 2].map((axis) => rootBounds[axis] + random() * extent[axis] - origin[axis]);
        const length = Math.hypot(direction[0], direction[1], direction[2]);
        rays.set([...origin, direction[0] / length, direction[1] / length, direction[2] / length], 6 * ray);
    }
    return rays;
}

// ---------------------------------------------------------------- child: one case

function sample(warmup, runs, run) {
    for (let i = 0; i < warmup; i++) {
        run();
    }
    const times = [];
    for (let i = 0; i < runs; i++) {
        globalThis.gc();
        const start = performance.now();
        run();
        times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    const rank = (fraction) => times[Math.min(runs - 1, Math.max(0, Math.ceil(fraction * runs) - 1))];
    return { median: rank(0.5), p10: rank(0.1), p90: rank(0.9) };
}

async function runCase({ dataset, strategy, binCount, runs, warmup, rayCount }) {
    const { positions, index } = await loadDataset(dataset);
    const triangleCount = getTriangleCount(positions, index);
    const options = { strategy, binCount, leafThreshold: LEAF_THRESHOLD };

    const bounds = computeTriangleBounds(positions, index);
    const boundsTime = sample(warmup, runs, () => computeTriangleBounds(positions, index, bounds));

    let tree = null;
    const buildTime = sample(warmup, runs, () => {
        tree = buildBVH(bounds, options);
    });
    const stats = getBVHStats(tree);

    const rays = createRays(tree.float32, rayCount);
    const ray = new Float64Array(9);
    const hit = new Float64Array(3);
    const stack = createTraversalStack();
    let hits = 0;
    const castAll = () => {
        hits = 0;
        for (let i = 0; i < rayCount; i++) {
            const o = 6 * i;
            setRay(ray, rays[o], rays[o + 1], rays[o + 2], rays[o + 3], rays[o + 4], rays[o + 5]);
            if (raycastTriangles(tree, positions, index, ray, stack, hit) !== -1) {
                hits++;
            }
        }
    };
    traversalCounters.nodes = 0;
    castAll();
    const nodesPerRay = traversalCounters.nodes / rayCount;
    const queryTime = sample(warmup, runs, castAll);
    const refitTime = sample(warmup, runs, () => refitTriangles(tree, positions, index));

    return {
        triangleCount,
        boundsTime,
        buildTime,
        stats,
        nodesPerRay,
        hitRate: hits / rayCount,
        queryTime,
        refitTime,
    };
}

// ---------------------------------------------------------------- parent: every case and the report

function readArguments() {
    const settings = { runs: 11, warmup: 3, rays: 100000 };
    const args = process.argv.slice(2);
    for (let i = 0; i < args.length; i += 2) {
        settings[args[i].replace(/^--/, '')] = Number(args[i + 1]);
    }
    return settings;
}

const formatTime = ({ median, p10, p90 }) => `${median.toFixed(2)} (${p10.toFixed(2)}–${p90.toFixed(2)})`;
const configurationName = ({ strategy, binCount }) => (strategy === 'sah' ? `SAH ${binCount} bins` : 'Center split');

async function runAll() {
    const { report: reportOnly, ...settings } = readArguments();
    mkdirSync(workDirectory, { recursive: true });
    let results = {};
    let descriptions = {};

    if (reportOnly) {
        const saved = JSON.parse(readFileSync(join(workDirectory, 'results.json'), 'utf8'));
        ({ results, descriptions } = saved);
        Object.assign(settings, saved.settings);
    }
    for (const dataset of reportOnly ? [] : datasets) {
        descriptions[dataset] = (await loadDataset(dataset)).description;
        for (const configuration of configurations) {
            const job = { dataset, ...configuration, runs: settings.runs, warmup: settings.warmup, rayCount: settings.rays };
            process.stderr.write(`${dataset} · ${configurationName(configuration)}\n`);
            const stdout = execFileSync(process.execPath, ['--expose-gc', scriptPath, '--case', JSON.stringify(job)], {
                encoding: 'utf8',
                maxBuffer: 1 << 24,
            });
            results[`${dataset}|${configurationName(configuration)}`] = JSON.parse(stdout);
        }
    }

    const lines = [];
    lines.push(`Node ${process.version} · ${cpus()[0].model} · ${cpus().length} logical CPUs`);
    lines.push(`runs ${settings.runs} after ${settings.warmup} warm-ups · ${settings.rays} rays · leafThreshold ${LEAF_THRESHOLD}`);
    lines.push('Times in ms: median (p10–p90).');
    for (const dataset of datasets) {
        const first = results[`${dataset}|${configurationName(configurations[0])}`];
        lines.push('', `### ${dataset}: ${first.triangleCount} triangles, ${descriptions[dataset]}`, '');
        lines.push(`Triangle bounds: ${formatTime(first.boundsTime)}`, '');
        lines.push('| configuration | build | nodes | depth | SAH cost | nodes/ray | query | refit |');
        lines.push('|---|---|---|---|---|---|---|---|');
        for (const configuration of configurations) {
            const result = results[`${dataset}|${configurationName(configuration)}`];
            lines.push(`| ${configurationName(configuration)} | ${formatTime(result.buildTime)} | `
                + `${result.stats.nodeCount} | ${result.stats.maxDepth} | ${result.stats.sahCost.toFixed(2)} | `
                + `${result.nodesPerRay.toFixed(1)} | ${formatTime(result.queryTime)} | ${formatTime(result.refitTime)} |`);
        }
    }

    const report = lines.join('\n');
    writeFileSync(join(workDirectory, 'report.md'), report);
    writeFileSync(join(workDirectory, 'results.json'), JSON.stringify({ settings, descriptions, results }, null, 2));
    process.stdout.write(`${report}\n`);
}

const caseIndex = process.argv.indexOf('--case');
if (caseIndex === -1) {
    await runAll();
} else {
    process.stdout.write(JSON.stringify(await runCase(JSON.parse(process.argv[caseIndex + 1]))));
}
