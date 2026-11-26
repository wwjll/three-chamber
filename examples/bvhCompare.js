import {
    AnimationClip,
    AnimationMixer,
    Bone,
    BufferAttribute,
    BufferGeometry,
    Color,
    CylinderGeometry,
    DataTexture,
    DirectionalLight,
    DoubleSide,
    DynamicDrawUsage,
    Float32BufferAttribute,
    Group,
    HemisphereLight,
    LineBasicMaterial,
    LineSegments,
    Matrix4,
    Mesh,
    MeshBasicMaterial,
    MeshStandardMaterial,
    OrthographicCamera,
    PerspectiveCamera,
    PlaneGeometry,
    Points,
    PointsMaterial,
    Quaternion,
    QuaternionKeyframeTrack,
    RGBAFormat,
    SRGBColorSpace,
    Scene,
    Skeleton,
    SkinnedMesh,
    Timer,
    Uint16BufferAttribute,
    Vector3,
    WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Pane } from 'tweakpane';

import { BVH_NODE_WORDS, getRightChild, isLeaf } from '../extend/partition/bvh/BVHLayout.js';

/**
 * Compares BVH configurations side by side. Each cell of the grid (a slot)
 * has its own configuration, edited in the panel after clicking the cell.
 * Every unique configuration gets its own worker (bvhCompare_bvhWorker.js),
 * so configurations build in parallel and keep their timings apart, and slots
 * with the same configuration share its tree. This file sets every count the
 * worker uses. The model exists once on layer 0; a configuration's overlays
 * live on the layers of the slots that show it (slot i uses layer i + 1).
 */

const MODEL_PATH = 'https://raw.githubusercontent.com/mrdoob/three.js/r187/examples/models/gltf/';
const DRACO_PATH = 'https://raw.githubusercontent.com/mrdoob/three.js/r187/examples/jsm/libs/draco/gltf/';
const GENERATED_MODEL = 'Generated tube';
const models = {
    Xbot: { file: 'Xbot.glb', triangles: '49k' },
    Soldier: { file: 'Soldier.glb', triangles: '11k' },
    Dragon: { file: 'DragonAttenuation.glb', triangles: '135k' },
    Dungeon: { file: 'dungeon_warkarma.glb', triangles: '72k' },
    'Littlest Tokyo': { file: 'LittlestTokyo.glb', triangles: '142k' },
    Nemetona: { file: 'nemetona.glb', triangles: '320k' },
    [GENERATED_MODEL]: { file: null, triangles: '25k' },
};

const MIN_CELL_WIDTH = 360;
const MIN_CELL_HEIGHT = 240;
const MAX_CELLS_PER_AXIS = 3;
const MAX_SLOTS = MAX_CELLS_PER_AXIS * MAX_CELLS_PER_AXIS;
const HEATMAP_RAY_BUDGET = 256 * 256;
const HEATMAP_BATCH_PIXELS = 8192;
const PROBE_RAY_COUNT = 2048;
const VERIFY_RAY_COUNT = 256;
const VERIFY_SLICE_MS = 8;
const VERIFY_TITLE = 'Verify against brute force';
const workerLimit = Math.max(1, Math.min(MAX_SLOTS, (navigator.hardwareConcurrency || 2) - 1));

const sah = { strategy: 'sah', binCount: 16, leafThreshold: 8, animationUpdate: 'refit' };
const slotConfigs = [
    sah,
    { ...sah, strategy: 'center' },
    { ...sah, binCount: 8 },
    { ...sah, binCount: 32 },
    { ...sah, binCount: 4 },
    { ...sah, leafThreshold: 4 },
    { ...sah, leafThreshold: 16 },
    { ...sah, animationUpdate: 'rebuild' },
    { ...sah, strategy: 'center', animationUpdate: 'rebuild' },
].map((config) => ({ ...config }));

const params = {
    model: 'Xbot',
    play: true,
    view: 'boxes',
    display: 'grid',
    cols: 2,
    rows: 1,
    boxMode: 'level',
    boxDepth: 6,
    boxOccluded: true,
    heatScale: 120,
    heatOpacity: 0.9,
    rebuildThreshold: 1.5,
    repeats: 5,
};
let selectedSlot = 0;
const slotParams = { ...slotConfigs[0] };
const collapsedLabels = new Array(MAX_SLOTS).fill(false);

const statusElement = document.querySelector('#status');
const labelsElement = document.querySelector('#labels');
const framesElement = document.querySelector('#frames');
const dividerElement = document.querySelector('#divider');
const hintElement = document.querySelector('#hint');

// Box colors run from blue at depth 0 to red at the tree's deepest level
// without cycling, so no two depths share a color.
const depthColor = new Color();
function getDepthColor(depth, maxDepth) {
    return depthColor.setHSL(0.66 * (1 - depth / Math.max(1, maxDepth)), 0.75, 0.6);
}
const depthLegendGradient = `linear-gradient(to right, ${Array.from({ length: 9 }, (_, stop) => getDepthColor(stop, 8).getStyle()).join(', ')})`;

const frameElements = Array.from({ length: MAX_SLOTS }, () => {
    const element = document.createElement('div');
    element.className = 'slot-frame';
    framesElement.appendChild(element);
    return element;
});
// Labels keep their elements across updates, so a click on the title is not
// lost when the statistics refresh every frame.
const labelElements = Array.from({ length: MAX_SLOTS }, (_, slot) => {
    const element = document.createElement('div');
    element.className = 'slot-label';
    const name = document.createElement('div');
    name.className = 'name';
    name.title = 'Click to collapse or expand';
    name.addEventListener('click', () => {
        collapsedLabels[slot] = !collapsedLabels[slot];
        updateLabels();
    });
    const legend = document.createElement('div');
    legend.className = 'depth-legend';
    const bar = document.createElement('span');
    bar.className = 'bar';
    bar.style.background = depthLegendGradient;
    legend.append(document.createElement('span'), bar, document.createElement('span'));
    element.append(name, document.createElement('div'), legend);
    labelsElement.appendChild(element);
    return element;
});

const renderer = new WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x161b24, 1);
document.body.appendChild(renderer.domElement);

const scene = new Scene();
scene.add(new HemisphereLight(0xdfe8ff, 0x2a2f38, 2.2));
const keyLight = new DirectionalLight(0xffffff, 2);
keyLight.position.set(3, 5, 4);
scene.add(keyLight);

const camera = new PerspectiveCamera(45, 1, 0.01, 100);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

const overlayScene = new Scene();
const overlayCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);

// Pick results are drawn last, above the heat map.
const pickScene = new Scene();

const dracoLoader = new DRACOLoader().setDecoderPath(DRACO_PATH);
const loader = new GLTFLoader().setPath(MODEL_PATH).setDRACOLoader(dracoLoader);
const timer = new Timer();
timer.connect(document);
const vertex = new Vector3();
const unprojectMatrix = new Matrix4();
const cameraOrigin = new Vector3();

const pickEnteredColor = new Color(0xffd34d);
const pickCulledColor = new Color(0x5d6675);
const heatPalette = createHeatPalette();

// Corner c of a box takes max x when bit 0 is set, max y for bit 1, max z for bit 2.
const boxEdgeCorners = new Uint8Array([0, 1, 1, 3, 3, 2, 2, 0, 4, 5, 5, 7, 7, 6, 6, 4, 0, 4, 1, 5, 2, 6, 3, 7]);

const entries = new Map();
let model = null;
let loadRequest = 0;
let splitFraction = 0.5;
let heatmapTimer = 0;
let pointerStart = null;
let verifyJob = 0;

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function setStatus(text) {
    statusElement.textContent = text;
}

// ---------------------------------------------------------------- model

function createGeneratedModel() {
    const height = 2;
    const boneCount = 9;
    const spacing = height / (boneCount - 1);
    const geometry = new CylinderGeometry(0.16, 0.3, height, 96, 128, false);
    geometry.translate(0, height / 2, 0);

    const position = geometry.getAttribute('position');
    const skinIndex = new Uint16Array(4 * position.count);
    const skinWeight = new Float32Array(4 * position.count);
    for (let i = 0; i < position.count; i++) {
        const along = position.getY(i) / spacing;
        const bone = Math.min(Math.floor(along), boneCount - 2);
        const weight = along - bone;
        skinIndex[4 * i] = bone;
        skinIndex[4 * i + 1] = bone + 1;
        skinWeight[4 * i] = 1 - weight;
        skinWeight[4 * i + 1] = weight;
    }
    geometry.setAttribute('skinIndex', new Uint16BufferAttribute(skinIndex, 4));
    geometry.setAttribute('skinWeight', new Float32BufferAttribute(skinWeight, 4));

    const bones = [];
    for (let i = 0; i < boneCount; i++) {
        const bone = new Bone();
        bone.name = `segment${i}`;
        bone.position.y = i === 0 ? 0 : spacing;
        bones[i - 1]?.add(bone);
        bones.push(bone);
    }
    const mesh = new SkinnedMesh(geometry, new MeshStandardMaterial({ color: 0x7f9cc4, roughness: 0.55 }));
    mesh.add(bones[0]);
    mesh.bind(new Skeleton(bones));

    const times = Array.from({ length: 9 }, (_, i) => i * 0.25);
    const quaternion = new Quaternion();
    const axis = new Vector3();
    const tracks = bones.slice(1).map((bone, i) => {
        axis.set(i % 2, 0, 1 - (i % 2));
        const values = [];
        for (const time of times) {
            quaternion.setFromAxisAngle(axis, 0.32 * Math.sin(Math.PI * time + 0.7 * i));
            values.push(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
        }
        return new QuaternionKeyframeTrack(`${bone.name}.quaternion`, times, values);
    });

    const root = new Group();
    root.add(mesh);
    return { root, animations: [new AnimationClip('bend', 2, tracks)] };
}

function disposeObject(root) {
    root.traverse((object) => {
        if (!object.isMesh) {
            return;
        }
        object.geometry.dispose();
        for (const material of [object.material].flat()) {
            for (const value of Object.values(material)) {
                if (value?.isTexture) {
                    value.dispose();
                }
            }
            material.dispose();
        }
    });
}

// One merged, indexed triangle list over every mesh under `root`.
function collectGeometry(root) {
    const meshes = [];
    root.traverse((object) => {
        if (object.isMesh) {
            meshes.push(object);
        }
    });

    let vertexCount = 0;
    let indexCount = 0;
    for (const { geometry } of meshes) {
        const count = geometry.getAttribute('position').count;
        vertexCount += count;
        indexCount += geometry.index ? geometry.index.count : count;
    }

    const index = new Uint32Array(indexCount);
    let vertexOffset = 0;
    let entry = 0;
    for (const { geometry } of meshes) {
        const count = geometry.getAttribute('position').count;
        if (geometry.index) {
            for (let i = 0; i < geometry.index.count; i++) {
                index[entry++] = vertexOffset + geometry.index.getX(i);
            }
        } else {
            for (let i = 0; i < count; i++) {
                index[entry++] = vertexOffset + i;
            }
        }
        vertexOffset += count;
    }
    return { meshes, index, positions: new Float32Array(3 * vertexCount) };
}

// getVertexPosition applies morph targets and skinning from the bones'
// matrixWorld and returns local space, so call it after updateMatrixWorld.
function writeWorldPositions(meshes, target) {
    let offset = 0;
    for (const mesh of meshes) {
        const count = mesh.geometry.getAttribute('position').count;
        for (let i = 0; i < count; i++) {
            mesh.getVertexPosition(i, vertex).applyMatrix4(mesh.matrixWorld);
            target[offset++] = vertex.x;
            target[offset++] = vertex.y;
            target[offset++] = vertex.z;
        }
    }
}

function frameCamera(positions) {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < positions.length; i += 3) {
        for (let axis = 0; axis < 3; axis++) {
            min[axis] = Math.min(min[axis], positions[i + axis]);
            max[axis] = Math.max(max[axis], positions[i + axis]);
        }
    }
    const center = new Vector3((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
    const radius = 0.5 * Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
    const distance = 1.1 * radius / Math.sin((camera.fov * Math.PI) / 360);
    controls.target.copy(center);
    camera.position.copy(center).addScaledVector(new Vector3(0.55, 0.3, 1).normalize(), distance);
    camera.near = distance / 100;
    camera.far = distance * 10;
    camera.updateProjectionMatrix();
    controls.update();
}

async function switchModel(requested) {
    const request = ++loadRequest;
    setStatus(`Loading ${requested}…`);
    let name = requested;
    let loaded = null;
    if (models[requested].file) {
        try {
            const gltf = await loader.loadAsync(models[requested].file);
            loaded = { root: gltf.scene, animations: gltf.animations };
        } catch (error) {
            console.warn(`Could not load ${requested}; using the generated model.`, error);
            name = GENERATED_MODEL;
        }
    }
    if (request !== loadRequest) {
        if (loaded) {
            disposeObject(loaded.root);
        }
        return;
    }
    loaded ??= createGeneratedModel();

    if (model) {
        scene.remove(model.root);
        model.mixer.stopAllAction();
        model.mixer.uncacheRoot(model.root);
        disposeObject(model.root);
    }

    const mixer = new AnimationMixer(loaded.root);
    const clip = loaded.animations.find((candidate) => /run|walk/i.test(candidate.name)) ?? loaded.animations[0];
    if (clip) {
        mixer.clipAction(clip).play();
    }
    scene.add(loaded.root);
    mixer.update(0);
    loaded.root.updateMatrixWorld(true);
    const geometry = collectGeometry(loaded.root);
    writeWorldPositions(geometry.meshes, geometry.positions);
    model = { name, root: loaded.root, mixer, animated: Boolean(clip), ...geometry };
    frameCamera(geometry.positions);

    params.model = name;
    pane.refresh();
    setStatus(name === requested ? '' : `${requested} could not be loaded; showing ${GENERATED_MODEL}.`);
    restartAllEntries();
}

// ---------------------------------------------------------------- layout

function canvasSize() {
    return [renderer.domElement.clientWidth, renderer.domElement.clientHeight];
}

function layoutLimits() {
    const [width, height] = canvasSize();
    return {
        cols: clamp(Math.floor(width / MIN_CELL_WIDTH), 1, MAX_CELLS_PER_AXIS),
        rows: clamp(Math.floor(height / MIN_CELL_HEIGHT), 1, MAX_CELLS_PER_AXIS),
    };
}

function slotCount() {
    return params.cols * params.rows;
}

// Center splits ignore the bin count, so it is left out of their key.
function configKey({ strategy, binCount, leafThreshold, animationUpdate }) {
    const bins = strategy === 'sah' ? binCount : '-';
    return `${strategy}/${bins}/${leafThreshold}/${animationUpdate}`;
}

function configName({ strategy, binCount, leafThreshold, animationUpdate }) {
    const parts = [strategy === 'sah' ? `SAH ${binCount} bins` : 'Center split', `leaf ≤ ${leafThreshold}`];
    if (animationUpdate === 'rebuild') {
        parts.push('rebuild every frame');
    }
    return parts.join(' · ');
}

function slotKey(slot) {
    return configKey(slotConfigs[slot]);
}

function wipeAvailable() {
    return params.cols === 2 && params.rows === 1;
}

function isWipe() {
    return params.display === 'wipe' && wipeAvailable();
}

// Cell rectangle in CSS pixels with a top-left origin; row 0 is the top row.
function cellRect(slot) {
    const [width, height] = canvasSize();
    const cellWidth = Math.floor(width / params.cols);
    const cellHeight = Math.floor(height / params.rows);
    const column = slot % params.cols;
    const row = Math.floor(slot / params.cols);
    return { x: column * cellWidth, y: row * cellHeight, width: cellWidth, height: cellHeight };
}

function viewAspect() {
    const [width, height] = canvasSize();
    if (isWipe()) {
        return width / height;
    }
    const cell = cellRect(0);
    return cell.width / cell.height;
}

function updateCameraAspect() {
    const aspect = viewAspect();
    if (camera.aspect !== aspect) {
        camera.aspect = aspect;
        camera.updateProjectionMatrix();
    }
}

function placeOverlays() {
    const [width, height] = canvasSize();
    const wipe = isWipe();
    dividerElement.style.display = wipe ? 'block' : 'none';
    dividerElement.style.left = `${splitFraction * width}px`;
    hintElement.textContent = slotCount() > 1
        ? 'Drag to orbit · click a cell to edit it in the panel · click the selected cell to trace one ray'
        : 'Drag to orbit · click to trace one ray · browser timings are indicative, the Node benchmark decides';

    frameElements.forEach((element, slot) => {
        if (slot >= slotCount() || slotCount() === 1) {
            element.style.display = 'none';
            return;
        }
        const split = Math.round(splitFraction * width);
        const cell = wipe
            ? { x: slot === 0 ? 0 : split, y: 0, width: slot === 0 ? split : width - split, height }
            : cellRect(slot);
        Object.assign(element.style, {
            display: 'block',
            left: `${cell.x}px`,
            top: `${cell.y}px`,
            width: `${cell.width}px`,
            height: `${cell.height}px`,
        });
        element.classList.toggle('selected', slot === selectedSlot);
        element.classList.toggle('wipe', wipe);
    });

    labelElements.forEach((element, slot) => {
        if (slot >= slotCount()) {
            element.style.display = 'none';
            return;
        }
        element.style.display = 'block';
        const left = wipe ? (slot === 0 ? 0 : splitFraction * width) : cellRect(slot).x;
        const top = wipe ? 0 : cellRect(slot).y;
        element.style.left = `${left + 8}px`;
        element.style.top = `${top + 8}px`;
    });
}

// ---------------------------------------------------------------- entries

function createLineSegments(opacity) {
    const lines = new LineSegments(
        new BufferGeometry(),
        new LineBasicMaterial({ vertexColors: true, transparent: true, opacity, depthTest: false })
    );
    lines.frustumCulled = false;
    lines.renderOrder = 1;
    return lines;
}

function ensureLineCapacity(lines, boxCount) {
    const position = lines.geometry.getAttribute('position');
    const length = 72 * Math.max(boxCount, 1);
    if (position !== undefined && position.array.length >= length) {
        return;
    }
    lines.geometry.dispose();
    lines.geometry = new BufferGeometry();
    lines.geometry.setAttribute('position', new BufferAttribute(new Float32Array(length), 3).setUsage(DynamicDrawUsage));
    lines.geometry.setAttribute('color', new BufferAttribute(new Float32Array(length), 3).setUsage(DynamicDrawUsage));
}

function writeBox(positions, colors, box, bounds, boundsOffset, color) {
    let offset = 72 * box;
    for (let i = 0; i < 24; i++, offset += 3) {
        const corner = boxEdgeCorners[i];
        positions[offset] = bounds[boundsOffset + (corner & 1 ? 3 : 0)];
        positions[offset + 1] = bounds[boundsOffset + (corner & 2 ? 4 : 1)];
        positions[offset + 2] = bounds[boundsOffset + (corner & 4 ? 5 : 2)];
        colors[offset] = color.r;
        colors[offset + 1] = color.g;
        colors[offset + 2] = color.b;
    }
}

function createAnimationStats() {
    return { frames: 0, refitMs: 0, rebuildMs: 0, rebuilds: 0, sahRatio: 1 };
}

function createEntry(key, config) {
    const boxLines = createLineSegments(0.85);
    boxLines.material.depthTest = params.boxOccluded;
    boxLines.visible = params.view === 'boxes';
    const pickLines = createLineSegments(1);
    pickLines.visible = false;
    const pickTriangle = new Mesh(
        new BufferGeometry(),
        new MeshBasicMaterial({ color: 0xff3d6e, side: DoubleSide, depthTest: false, transparent: true })
    );
    pickTriangle.geometry.setAttribute('position', new BufferAttribute(new Float32Array(9), 3));
    pickTriangle.frustumCulled = false;
    pickTriangle.renderOrder = 2;
    pickTriangle.visible = false;
    const pickPoint = new Points(
        new BufferGeometry(),
        new PointsMaterial({ color: 0xff3d6e, size: 12, sizeAttenuation: false, depthTest: false, transparent: true })
    );
    pickPoint.geometry.setAttribute('position', new BufferAttribute(new Float32Array(3), 3));
    pickPoint.frustumCulled = false;
    pickPoint.renderOrder = 3;
    pickPoint.visible = false;
    scene.add(boxLines);
    pickScene.add(pickLines, pickTriangle, pickPoint);

    const heatQuad = new Mesh(
        new PlaneGeometry(2, 2),
        new MeshBasicMaterial({ transparent: true, opacity: params.heatOpacity, depthTest: false, depthWrite: false })
    );
    heatQuad.visible = false;
    overlayScene.add(heatQuad);

    return {
        key,
        config: { ...config },
        status: 'queued',
        error: null,
        worker: null,
        repeats: 0,
        pendingUpdate: false,
        sparePositions: null,
        stats: null,
        animation: createAnimationStats(),
        decoded: { nodeCount: 0, bounds: new Float32Array(0), depth: new Uint8Array(0), leaf: new Uint8Array(0) },
        boxCount: 0,
        boxLines,
        pickLines,
        pickTriangle,
        pickPoint,
        pick: null,
        verify: null,
        heat: { jobId: 0, width: 0, height: 0, counts: null, pixels: null, texture: null, quad: heatQuad, averageNodes: null },
    };
}

function entryObjects(entry) {
    return [entry.boxLines, entry.pickLines, entry.pickTriangle, entry.pickPoint, entry.heat.quad];
}

function disposeEntry(entry) {
    entry.worker?.terminate();
    scene.remove(entry.boxLines);
    pickScene.remove(entry.pickLines, entry.pickTriangle, entry.pickPoint);
    overlayScene.remove(entry.heat.quad);
    for (const object of entryObjects(entry)) {
        object.geometry.dispose();
        object.material.dispose();
    }
    entry.heat.texture?.dispose();
}

function resetEntry(entry) {
    entry.worker?.terminate();
    Object.assign(entry, {
        worker: null,
        status: 'queued',
        error: null,
        pendingUpdate: false,
        sparePositions: null,
        stats: null,
        animation: createAnimationStats(),
        pick: null,
        verify: null,
    });
    entry.decoded.nodeCount = 0;
    entry.boxLines.geometry.setDrawRange(0, 0);
    hidePick(entry);
    entry.heat.jobId++;
    entry.heat.averageNodes = null;
    entry.heat.quad.visible = false;
}

// A configuration's overlays are visible in every slot that shows it.
function updateLayers() {
    for (const entry of entries.values()) {
        let mask = 0;
        for (let slot = 0; slot < slotCount(); slot++) {
            if (slotKey(slot) === entry.key) {
                mask |= 1 << (slot + 1);
            }
        }
        for (const object of entryObjects(entry)) {
            object.layers.mask = mask;
        }
    }
}

function startWorker(entry) {
    resetEntry(entry);
    const worker = new Worker(new URL('./bvhCompare_bvhWorker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => handleWorkerMessage(entry, data);
    worker.onerror = (event) => failEntry(entry, event.message);
    Object.assign(entry, { worker, status: 'building', repeats: params.repeats });

    const positions = model.positions.slice();
    const index = model.index.slice();
    entry.sparePositions = new Float32Array(positions.length);
    const { animationUpdate, ...buildOptions } = entry.config;
    worker.postMessage(
        {
            type: 'build',
            positions,
            index,
            buildOptions,
            animationUpdate,
            repeats: params.repeats,
            probeRayCount: PROBE_RAY_COUNT,
        },
        [positions.buffer, index.buffer]
    );
}

// Configurations beyond the worker limit wait until a visible configuration frees its worker.
function startQueuedEntries() {
    if (!model) {
        return;
    }
    let running = 0;
    for (const entry of entries.values()) {
        if (entry.worker) {
            running++;
        }
    }
    for (const entry of entries.values()) {
        if (running >= workerLimit) {
            break;
        }
        if (!entry.worker && entry.status === 'queued') {
            startWorker(entry);
            running++;
        }
    }
}

function restartAllEntries() {
    for (const entry of entries.values()) {
        resetEntry(entry);
    }
    startQueuedEntries();
    updateLabels();
}

function reconcileEntries() {
    const wanted = new Map();
    for (let slot = 0; slot < slotCount(); slot++) {
        wanted.set(slotKey(slot), slotConfigs[slot]);
    }
    for (const [key, entry] of entries) {
        if (!wanted.has(key)) {
            disposeEntry(entry);
            entries.delete(key);
        }
    }
    for (const [key, config] of wanted) {
        if (!entries.has(key)) {
            entries.set(key, createEntry(key, config));
        }
    }
    updateLayers();
    startQueuedEntries();
    requestAllHeatmaps();
    updateLabels();
}

function failEntry(entry, message) {
    entry.status = 'failed';
    entry.error = message;
    entry.worker?.terminate();
    entry.worker = null;
    startQueuedEntries();
    updateLabels();
}

function decodeNodes(entry, buffer, nodeCount) {
    const float32 = new Float32Array(buffer);
    const uint32 = new Uint32Array(buffer);
    if (entry.decoded.depth.length < nodeCount) {
        entry.decoded = {
            nodeCount,
            bounds: new Float32Array(6 * nodeCount),
            depth: new Uint8Array(nodeCount),
            leaf: new Uint8Array(nodeCount),
        };
    }
    const { bounds, depth, leaf } = entry.decoded;
    entry.decoded.nodeCount = nodeCount;
    depth[0] = 0;
    for (let node = 0; node < nodeCount; node++) {
        const word = BVH_NODE_WORDS * node;
        bounds.set(float32.subarray(word, word + 3), 6 * node);
        bounds.set(float32.subarray(word + 4, word + 7), 6 * node + 3);
        const nodeIsLeaf = isLeaf(uint32, node);
        leaf[node] = nodeIsLeaf ? 1 : 0;
        if (!nodeIsLeaf) {
            depth[node + 1] = depth[node] + 1;
            depth[getRightChild(uint32, node)] = depth[node] + 1;
        }
    }
}

// 'level' matches MeshBVHHelper with displayParents off: one level, plus leaves that end above it.
function isBoxVisible(nodeDepth, nodeIsLeaf) {
    if (params.boxMode === 'leaves') {
        return nodeIsLeaf;
    }
    if (params.boxMode === 'level') {
        return nodeDepth === params.boxDepth || (nodeIsLeaf && nodeDepth < params.boxDepth);
    }
    return nodeDepth <= params.boxDepth;
}

function updateBoxLines(entry) {
    const { nodeCount, bounds, depth, leaf } = entry.decoded;
    const { maxDepth } = entry.stats;
    ensureLineCapacity(entry.boxLines, nodeCount);
    const { position, color } = entry.boxLines.geometry.attributes;
    let boxes = 0;
    for (let node = 0; node < nodeCount; node++) {
        if (isBoxVisible(depth[node], leaf[node] === 1)) {
            writeBox(position.array, color.array, boxes, bounds, 6 * node, getDepthColor(depth[node], maxDepth));
            boxes++;
        }
    }
    entry.boxCount = boxes;
    entry.boxLines.geometry.setDrawRange(0, 24 * boxes);
    position.needsUpdate = true;
    color.needsUpdate = true;
}

// Draws from the nodes, then hands the buffer straight back to the worker.
function receiveNodes(entry, nodes, nodeCount) {
    decodeNodes(entry, nodes, nodeCount);
    entry.worker.postMessage({ type: 'nodes', nodes }, [nodes]);
    updateBoxLines(entry);
}

// While a pick is shown, the regular boxes are hidden so the ray's path stands out.
function updateBoxVisibility(entry) {
    entry.boxLines.visible = params.view === 'boxes' && entry.pick === null;
}

function hidePick(entry) {
    entry.pick = null;
    entry.pickLines.visible = false;
    entry.pickTriangle.visible = false;
    entry.pickPoint.visible = false;
    updateBoxVisibility(entry);
}

function showPick(entry, { boxes, entered, triangle, distance, vertices }) {
    const count = entered.length;
    ensureLineCapacity(entry.pickLines, count);
    const { position, color } = entry.pickLines.geometry.attributes;
    let enteredCount = 0;
    for (let node = 0; node < count; node++) {
        enteredCount += entered[node];
        writeBox(position.array, color.array, node, boxes, 6 * node, entered[node] ? pickEnteredColor : pickCulledColor);
    }
    entry.pickLines.geometry.setDrawRange(0, 24 * count);
    position.needsUpdate = true;
    color.needsUpdate = true;
    entry.pickLines.visible = true;

    entry.pickTriangle.visible = triangle !== -1;
    entry.pickPoint.visible = triangle !== -1;
    if (triangle !== -1) {
        const trianglePosition = entry.pickTriangle.geometry.getAttribute('position');
        trianglePosition.array.set(vertices);
        trianglePosition.needsUpdate = true;
        const pointPosition = entry.pickPoint.geometry.getAttribute('position');
        for (let axis = 0; axis < 3; axis++) {
            pointPosition.array[axis] = (vertices[axis] + vertices[axis + 3] + vertices[axis + 6]) / 3;
        }
        pointPosition.needsUpdate = true;
    }
    entry.pick = { visited: count, entered: enteredCount, triangle, distance };
    updateBoxVisibility(entry);
}

function handleWorkerMessage(entry, message) {
    switch (message.type) {
        case 'built':
            entry.stats = message.stats;
            entry.status = 'ready';
            receiveNodes(entry, message.nodes, message.nodeCount);
            requestHeatmap(entry);
            break;
        case 'updated': {
            const { animation } = entry;
            entry.sparePositions = message.positions;
            entry.pendingUpdate = false;
            entry.stats = { ...entry.stats, ...message.stats };
            animation.frames++;
            animation.refitMs = message.refitMs;
            animation.rebuildMs = message.rebuildMs;
            animation.rebuilds += message.rebuilt ? 1 : 0;
            animation.sahRatio = message.sahRatio;
            receiveNodes(entry, message.nodes, message.nodeCount);
            break;
        }
        case 'heatmapRows':
            if (message.jobId === entry.heat.jobId) {
                writeHeatRows(entry.heat, message);
            }
            break;
        case 'heatmapDone':
            if (message.jobId === entry.heat.jobId) {
                entry.heat.averageNodes = message.averageNodes;
                if (params.play) {
                    requestHeatmap(entry);
                }
            }
            break;
        case 'picked':
            showPick(entry, message);
            break;
        case 'verifyProgress':
            if (entry.verify?.jobId === message.jobId) {
                entry.verify.done = message.done;
                entry.verify.elapsedMs = message.elapsedMs;
            }
            break;
        case 'verified':
            if (entry.verify?.jobId === message.jobId) {
                Object.assign(entry.verify, {
                    running: false,
                    done: message.rayCount,
                    hits: message.hits,
                    mismatches: message.mismatches,
                    elapsedMs: message.elapsedMs,
                });
            }
            break;
        case 'error':
            failEntry(entry, message.message);
            return;
    }
    updateLabels();
}

// ---------------------------------------------------------------- heat map

function createHeatPalette() {
    const palette = new Uint8Array(4 * 256);
    const color = new Color();
    const rgb = { r: 0, g: 0, b: 0 };
    for (let level = 0; level < 256; level++) {
        color.setHSL(0.66 * (1 - level / 255), 0.9, 0.5).getRGB(rgb, SRGBColorSpace);
        palette.set([Math.round(255 * rgb.r), Math.round(255 * rgb.g), Math.round(255 * rgb.b), 255], 4 * level);
    }
    return palette;
}

function colorizeHeat(heat, start, end) {
    for (let pixel = start; pixel < end; pixel++) {
        const level = Math.min(255, Math.round((255 * heat.counts[pixel]) / params.heatScale));
        heat.pixels.set(heatPalette.subarray(4 * level, 4 * level + 4), 4 * pixel);
    }
    heat.texture.needsUpdate = true;
}

function writeHeatRows(heat, { rowStart, rowCount, data }) {
    heat.counts.set(data, rowStart * heat.width);
    colorizeHeat(heat, rowStart * heat.width, (rowStart + rowCount) * heat.width);
}

function ensureHeatTexture(heat, width, height) {
    if (heat.width === width && heat.height === height) {
        return;
    }
    heat.texture?.dispose();
    heat.counts = new Uint16Array(width * height);
    heat.pixels = new Uint8Array(4 * width * height);
    heat.texture = new DataTexture(heat.pixels, width, height, RGBAFormat);
    heat.texture.colorSpace = SRGBColorSpace;
    heat.texture.needsUpdate = true;
    heat.quad.material.map = heat.texture;
    heat.quad.material.needsUpdate = true;
    heat.width = width;
    heat.height = height;
}

/**
 * NDC x range of a configuration's heat map. In wipe mode both sides share
 * the full-screen viewport, so a configuration only traces the side(s) of the
 * divider that show it.
 */
function heatmapRange(entry) {
    if (!isWipe()) {
        return [-1, 1];
    }
    const split = 2 * splitFraction - 1;
    return [slotKey(0) === entry.key ? -1 : split, slotKey(1) === entry.key ? 1 : split];
}

/**
 * The ray budget is shared by the configurations on screen: evenly across
 * grid cells, by visible area in wipe mode. Both keep the pixel density of
 * a full view.
 */
function heatmapSize([xMin, xMax]) {
    const fraction = 0.5 * (xMax - xMin);
    const aspect = viewAspect() * fraction;
    const share = isWipe() ? HEATMAP_RAY_BUDGET * fraction : HEATMAP_RAY_BUDGET / Math.max(1, entries.size);
    const height = Math.max(8, Math.round(Math.sqrt(share / aspect)));
    return [Math.max(8, Math.round(height * aspect)), height];
}

function cameraPayload() {
    updateCameraAspect();
    camera.updateMatrixWorld();
    unprojectMatrix.multiplyMatrices(camera.matrixWorld, camera.projectionMatrixInverse);
    camera.getWorldPosition(cameraOrigin);
    return { origin: cameraOrigin.toArray(), unproject: unprojectMatrix.toArray() };
}

function requestHeatmap(entry) {
    if (params.view !== 'heatmap' || entry.status !== 'ready') {
        return;
    }
    const { heat } = entry;
    const range = heatmapRange(entry);
    heat.jobId++;
    heat.quad.visible = range[1] > range[0];
    if (!heat.quad.visible) {
        return;
    }
    const [width, height] = heatmapSize(range);
    ensureHeatTexture(heat, width, height);
    heat.quad.scale.x = 0.5 * (range[1] - range[0]);
    heat.quad.position.x = 0.5 * (range[0] + range[1]);
    entry.worker.postMessage({
        type: 'heatmap',
        jobId: heat.jobId,
        camera: cameraPayload(),
        width,
        height,
        region: [range[0], -1, range[1], 1],
        batchPixels: HEATMAP_BATCH_PIXELS,
    });
}

function requestAllHeatmaps() {
    for (const entry of entries.values()) {
        requestHeatmap(entry);
    }
}

function scheduleHeatmaps() {
    clearTimeout(heatmapTimer);
    heatmapTimer = setTimeout(requestAllHeatmaps, 150);
}

// ---------------------------------------------------------------- labels

function formatMs(value) {
    return `${value.toFixed(value < 10 ? 2 : 1)} ms`;
}

function describeVerify({ running, done, rayCount, hits, mismatches, elapsedMs }) {
    const seconds = `${(elapsedMs / 1000).toFixed(1)} s`;
    if (!running) {
        return `verify: ${mismatches} / ${rayCount} mismatches (${hits} hits) · ${seconds}`;
    }
    if (done === 0) {
        return `verify: running… (0/${rayCount})`;
    }
    const remaining = (elapsedMs * (rayCount - done)) / done / 1000;
    return `verify: ${Math.floor((100 * done) / rayCount)}% (${done}/${rayCount}) · ${seconds}, ~${remaining.toFixed(1)} s left`;
}

function describeEntry(entry) {
    if (!entry || entry.status === 'queued') {
        return [model ? `Queued: waiting for a free worker (limit ${workerLimit})` : 'Waiting for the model…'];
    }
    if (entry.status === 'failed') {
        return [`Failed: ${entry.error}`];
    }
    if (entry.status === 'building') {
        return ['Building…'];
    }

    const { stats, animation, heat, pick, verify } = entry;
    const lines = [
        `${stats.triangleCount.toLocaleString()} tris · ${stats.nodeCount.toLocaleString()} nodes · ${stats.leafCount.toLocaleString()} leaves`,
        `depth ${stats.maxDepth} · max leaf ${stats.maxLeafSize} · SAH cost ${stats.sahCost.toFixed(2)}`,
        `build ${formatMs(stats.recursiveMs)} rec · ${formatMs(stats.iterativeMs)} iter (median of ${entry.repeats})`,
        `auto → ${stats.buildMode} · rec = iter: ${stats.identical ? 'yes' : 'NO'}`,
        `${stats.nodesPerRay.toFixed(1)} nodes / probe ray`,
    ];
    if (params.view === 'boxes') {
        const shown = params.boxMode === 'leaves' ? 'leaves' : `${params.boxMode === 'level' ? 'at' : 'up to'} depth ${params.boxDepth}`;
        lines.push(`boxes: ${shown} · ${entry.boxCount.toLocaleString()} drawn`);
    }
    if (heat.averageNodes !== null && params.view === 'heatmap') {
        lines.push(`${heat.averageNodes.toFixed(1)} nodes / pixel (${heat.width}×${heat.height})`);
    }
    if (animation.frames > 0) {
        const update = entry.config.animationUpdate === 'refit'
            ? `refit ${formatMs(animation.refitMs)}${animation.rebuildMs > 0 ? ` + rebuild ${formatMs(animation.rebuildMs)}` : ''}`
            : `rebuild ${formatMs(animation.rebuildMs)}`;
        lines.push(update, `SAH cost ×${animation.sahRatio.toFixed(2)} of last build · ${animation.rebuilds} rebuilds`);
    }
    if (pick) {
        const result = pick.triangle === -1 ? 'miss' : `triangle ${pick.triangle} at ${pick.distance.toFixed(3)}`;
        lines.push(`pick: ${pick.visited} nodes popped, ${pick.entered} entered, ${result}`);
    }
    if (verify) {
        lines.push(describeVerify(verify));
    }
    return lines;
}

function updateLabels() {
    for (let slot = 0; slot < slotCount(); slot++) {
        const element = labelElements[slot];
        const [name, body, legend] = element.children;
        const entry = entries.get(slotKey(slot));
        const collapsed = collapsedLabels[slot];
        name.textContent = `${collapsed ? '▸' : '▾'} Slot ${slot + 1} · ${configName(slotConfigs[slot])}`;
        body.hidden = collapsed;
        if (!collapsed) {
            body.textContent = describeEntry(entry).join('\n');
        }
        legend.hidden = collapsed || params.view !== 'boxes' || entry?.status !== 'ready' || entry.pick !== null;
        if (!legend.hidden) {
            legend.firstChild.textContent = 'depth 0';
            legend.lastChild.textContent = `depth ${entry.stats.maxDepth}`;
        }
        element.classList.toggle('mismatch', entry?.verify?.running === false && entry.verify.mismatches > 0);
    }
    const verifying = [...entries.values()].some((entry) => entry.verify?.running);
    verifyButton.disabled = verifying;
    verifyButton.title = verifying ? 'Verifying…' : VERIFY_TITLE;
    placeOverlays();
}

// ---------------------------------------------------------------- rendering

function renderSlot(slot, viewport, scissor) {
    if (scissor[2] <= 0 || scissor[3] <= 0) {
        return;
    }
    renderer.setViewport(...viewport);
    renderer.setScissor(...scissor);
    camera.layers.set(0);
    camera.layers.enable(slot + 1);
    renderer.render(scene, camera);

    renderer.autoClear = false;
    if (params.view === 'heatmap') {
        overlayCamera.layers.set(slot + 1);
        renderer.render(overlayScene, overlayCamera);
    }
    renderer.render(pickScene, camera);
    renderer.autoClear = true;
}

// setViewport and setScissor take CSS pixels with a bottom-left origin.
function render() {
    const [width, height] = canvasSize();
    updateCameraAspect();
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, width, height);
    renderer.clear();
    renderer.setScissorTest(true);

    if (isWipe()) {
        const split = Math.round(splitFraction * width);
        renderSlot(0, [0, 0, width, height], [0, 0, split, height]);
        renderSlot(1, [0, 0, width, height], [split, 0, width - split, height]);
    } else {
        for (let slot = 0; slot < slotCount(); slot++) {
            const cell = cellRect(slot);
            const rect = [cell.x, height - cell.y - cell.height, cell.width, cell.height];
            renderSlot(slot, rect, rect);
        }
    }
    renderer.setScissorTest(false);
}

function updateAnimation(delta) {
    if (!model || !model.animated || !params.play) {
        return;
    }
    model.mixer.update(delta);
    model.root.updateMatrixWorld(true);

    // Skip a configuration while its previous update is still in flight.
    const idle = [...entries.values()].filter((entry) => entry.status === 'ready' && !entry.pendingUpdate);
    if (idle.length === 0) {
        return;
    }
    writeWorldPositions(model.meshes, model.positions);
    for (const entry of idle) {
        const positions = entry.sparePositions;
        positions.set(model.positions);
        entry.sparePositions = null;
        entry.pendingUpdate = true;
        entry.worker.postMessage(
            { type: 'update', positions, rebuildThreshold: params.rebuildThreshold },
            [positions.buffer]
        );
    }
}

function animate(timestamp) {
    requestAnimationFrame(animate);
    timer.update(timestamp);
    updateAnimation(timer.getDelta());
    controls.update();
    render();
}

// ---------------------------------------------------------------- picking

// The slot under the pointer and the pointer's NDC within that slot's view.
function locatePointer(clientX, clientY) {
    const rect = renderer.domElement.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    if (isWipe()) {
        return {
            slot: x < splitFraction * rect.width ? 0 : 1,
            ndc: [(2 * x) / rect.width - 1, 1 - (2 * y) / rect.height],
        };
    }
    const first = cellRect(0);
    const column = clamp(Math.floor(x / first.width), 0, params.cols - 1);
    const row = clamp(Math.floor(y / first.height), 0, params.rows - 1);
    const slot = row * params.cols + column;
    const cell = cellRect(slot);
    return { slot, ndc: [(2 * (x - cell.x)) / cell.width - 1, 1 - (2 * (y - cell.y)) / cell.height] };
}

// The same ray is traced in every configuration.
function pick(ndc) {
    const cameraData = cameraPayload();
    for (const entry of entries.values()) {
        if (entry.status === 'ready') {
            entry.worker.postMessage({ type: 'pick', camera: cameraData, ndc });
        }
    }
}

function clearPick() {
    for (const entry of entries.values()) {
        hidePick(entry);
    }
    updateLabels();
}

// ---------------------------------------------------------------- GUI

const pane = new Pane({ title: 'BVH compare' });
pane.addBinding(params, 'model', {
    label: 'Model',
    options: Object.fromEntries(Object.entries(models).map(([name, { triangles }]) => [`${name} (${triangles})`, name])),
}).on('change', ({ value }) => {
    if (value !== model?.name) {
        switchModel(value);
    }
});
pane.addBinding(params, 'play', { label: 'Animate' });
pane.addBinding(params, 'view', {
    label: 'View',
    options: { Model: 'model', Boxes: 'boxes', 'Heat map': 'heatmap' },
}).on('change', () => {
    for (const entry of entries.values()) {
        updateBoxVisibility(entry);
    }
    requestAllHeatmaps();
    updateLabels();
});

const layoutFolder = pane.addFolder({ title: 'Layout' });
let columnsBinding = null;
let rowsBinding = null;
let currentLimits = null;
const displayBinding = layoutFolder.addBinding(params, 'display', {
    label: 'Display',
    options: { Grid: 'grid', 'Wipe (2 columns, 1 row)': 'wipe' },
}).on('change', applyLayout);
layoutFolder.addButton({ title: 'Collapse / expand all stats' }).on('click', () => {
    const collapse = collapsedLabels.slice(0, slotCount()).some((collapsed) => !collapsed);
    collapsedLabels.fill(collapse);
    updateLabels();
});

// Slider ranges cannot change in place, so the bindings are recreated.
function rebuildLayoutBindings() {
    const limits = layoutLimits();
    params.cols = clamp(params.cols, 1, limits.cols);
    params.rows = clamp(params.rows, 1, limits.rows);
    if (currentLimits && currentLimits.cols === limits.cols && currentLimits.rows === limits.rows) {
        return;
    }
    currentLimits = limits;
    columnsBinding?.dispose();
    rowsBinding?.dispose();
    columnsBinding = layoutFolder.addBinding(params, 'cols', {
        label: 'Columns', min: 1, max: limits.cols, step: 1, index: 0,
    });
    rowsBinding = layoutFolder.addBinding(params, 'rows', {
        label: 'Rows', min: 1, max: limits.rows, step: 1, index: 1,
    });
    columnsBinding.disabled = limits.cols === 1;
    rowsBinding.disabled = limits.rows === 1;
    for (const binding of [columnsBinding, rowsBinding]) {
        binding.on('change', (event) => {
            if (event.last) {
                applyLayout();
            }
        });
    }
}

const slotFolder = pane.addFolder({ title: 'Slots' });
slotFolder.addBinding(slotParams, 'strategy', {
    label: 'Split',
    options: { SAH: 'sah', 'Center of bounds': 'center' },
});
const binsBinding = slotFolder.addBinding(slotParams, 'binCount', {
    label: 'Bins',
    options: { 4: 4, 8: 8, 16: 16, 32: 32, 64: 64 },
});
slotFolder.addBinding(slotParams, 'leafThreshold', { label: 'Leaf threshold', min: 1, max: 32, step: 1 });
slotFolder.addBinding(slotParams, 'animationUpdate', {
    label: 'Animation',
    options: { 'Refit (rebuild at threshold)': 'refit', 'Rebuild every frame': 'rebuild' },
});
let syncingSlotPanel = false;
slotFolder.on('change', (event) => {
    if (syncingSlotPanel || !event.last) {
        return;
    }
    Object.assign(slotConfigs[selectedSlot], slotParams);
    binsBinding.disabled = slotParams.strategy !== 'sah';
    reconcileEntries();
});

function selectSlot(slot) {
    selectedSlot = slot;
    Object.assign(slotParams, slotConfigs[slot]);
    slotFolder.title = `Slot ${slot + 1}`;
    binsBinding.disabled = slotParams.strategy !== 'sah';
    syncingSlotPanel = true;
    pane.refresh();
    syncingSlotPanel = false;
    placeOverlays();
}

function applyLayout() {
    displayBinding.disabled = !wipeAvailable();
    selectSlot(Math.min(selectedSlot, slotCount() - 1));
    reconcileEntries();
}

const boxFolder = pane.addFolder({ title: 'Boxes' });
boxFolder.addBinding(params, 'boxMode', {
    label: 'Show',
    options: { 'At depth': 'level', 'Up to depth': 'depth', 'Leaves': 'leaves' },
});
const boxDepthBinding = boxFolder.addBinding(params, 'boxDepth', { label: 'Depth', min: 0, max: 40, step: 1 });
boxFolder.addBinding(params, 'boxOccluded', { label: 'Hide behind model' });
boxFolder.on('change', () => {
    boxDepthBinding.disabled = params.boxMode === 'leaves';
    for (const entry of entries.values()) {
        entry.boxLines.material.depthTest = params.boxOccluded;
        updateBoxLines(entry);
    }
    updateLabels();
});

const heatFolder = pane.addFolder({ title: 'Heat map' });
heatFolder.addBinding(params, 'heatScale', { label: 'Red at nodes', min: 10, max: 500, step: 1 }).on('change', () => {
    for (const { heat } of entries.values()) {
        if (heat.texture) {
            colorizeHeat(heat, 0, heat.width * heat.height);
        }
    }
});
heatFolder.addBinding(params, 'heatOpacity', { label: 'Opacity', min: 0, max: 1, step: 0.05 }).on('change', () => {
    for (const { heat } of entries.values()) {
        heat.quad.material.opacity = params.heatOpacity;
    }
});

const animationFolder = pane.addFolder({ title: 'Animation and timing' });
animationFolder.addBinding(params, 'rebuildThreshold', { label: 'Rebuild at SAH ×', min: 1, max: 4, step: 0.05 });
animationFolder.addBinding(params, 'repeats', { label: 'Timed builds', min: 1, max: 21, step: 2 });

pane.addButton({ title: 'Rebuild all' }).on('click', restartAllEntries);
const verifyButton = pane.addButton({ title: VERIFY_TITLE });
verifyButton.on('click', () => {
    verifyJob++;
    for (const entry of entries.values()) {
        if (entry.status === 'ready') {
            entry.verify = { jobId: verifyJob, running: true, done: 0, rayCount: VERIFY_RAY_COUNT, hits: 0, mismatches: 0, elapsedMs: 0 };
            entry.worker.postMessage({ type: 'verify', jobId: verifyJob, rayCount: VERIFY_RAY_COUNT, sliceMs: VERIFY_SLICE_MS });
        }
    }
    updateLabels();
});
pane.addButton({ title: 'Clear pick' }).on('click', clearPick);

// ---------------------------------------------------------------- events

dividerElement.addEventListener('pointerdown', (event) => {
    dividerElement.setPointerCapture(event.pointerId);
});
dividerElement.addEventListener('pointermove', (event) => {
    if (!dividerElement.hasPointerCapture(event.pointerId)) {
        return;
    }
    splitFraction = clamp(event.clientX / canvasSize()[0], 0, 1);
    placeOverlays();
    scheduleHeatmaps();
});

renderer.domElement.addEventListener('pointerdown', (event) => {
    pointerStart = { x: event.clientX, y: event.clientY };
});
renderer.domElement.addEventListener('pointerup', (event) => {
    if (pointerStart && Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) < 4) {
        const { slot, ndc } = locatePointer(event.clientX, event.clientY);
        if (slot === selectedSlot) {
            pick(ndc);
        } else {
            selectSlot(slot);
        }
    }
    pointerStart = null;
});

controls.addEventListener('change', scheduleHeatmaps);

window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    const before = [params.cols, params.rows];
    rebuildLayoutBindings();
    if (before[0] !== params.cols || before[1] !== params.rows) {
        applyLayout();
    } else {
        placeOverlays();
        scheduleHeatmaps();
    }
});

window.addEventListener('beforeunload', () => {
    for (const entry of entries.values()) {
        disposeEntry(entry);
    }
    if (model) {
        disposeObject(model.root);
    }
    dracoLoader.dispose();
    controls.dispose();
    pane.dispose();
    renderer.dispose();
});

rebuildLayoutBindings();
applyLayout();
switchModel(params.model);
animate();
