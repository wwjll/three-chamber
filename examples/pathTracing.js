import {
    Box3,
    EquirectangularReflectionMapping,
    Mesh,
    MeshStandardMaterial,
    PMREMGenerator,
    PerspectiveCamera,
    Scene,
    TorusKnotGeometry,
    Vector3,
    WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { Pane } from 'tweakpane';
import { SceneCompiler } from "../extend/path-tracing/compiler/SceneCompiler.js";
import { PathTracer } from "../extend/path-tracing/PathTracer.js";
import { getTileRect } from "../extend/path-tracing/Tiles.js";

import { getAssetURL } from '/extend/tools/Tool.js'

const assetUrl = getAssetURL();
const KHRONOS_MODEL_PATH = 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/';
// The glTF-Sample-Assets FlightHelmet lenses use KHR_materials_transmission, which the path tracer does not
// support yet. The legacy glTF-Sample-Models copy uses alphaMode BLEND, so the lenses stay see-through.
const KHRONOS_LEGACY_MODEL_PATH = 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/';
const THREE_MODEL_PATH = 'https://raw.githubusercontent.com/mrdoob/three.js/r187/examples/models/gltf/';
const DRACO_PATH = 'https://raw.githubusercontent.com/mrdoob/three.js/r187/examples/jsm/libs/draco/gltf/';
const modelUrls = {
    DamagedHelmet: `${KHRONOS_MODEL_PATH}DamagedHelmet/glTF/DamagedHelmet.gltf`,
    FlightHelmet: `${KHRONOS_LEGACY_MODEL_PATH}FlightHelmet/glTF/FlightHelmet.gltf`,
    Nemetona: `${THREE_MODEL_PATH}nemetona.glb`,
    TorusKnot: null,
};
const modelOptions = Object.fromEntries(Object.keys(modelUrls).map((name) => [name, name]));
const gltfLoader = new GLTFLoader()
    .setMeshoptDecoder(MeshoptDecoder)
    .setDRACOLoader(new DRACOLoader().setDecoderPath(DRACO_PATH));
const hdrAssetPaths = {
    KiaraNoon: 'hdrs/kiara_5_noon_2k.hdr',
    Daytime: 'hdrs/daytime.hdr',
};
const hdrOptions = {
    KiaraNoon: 'KiaraNoon',
    Daytime: 'Daytime',
};
const statsTitle = document.querySelector('#stats-title');
const statsBody = document.querySelector('#stats-body');
const tileGrid = document.querySelector('#tile-grid');
const tileGridDurationMs = 1500;
let tileGridTimer = null;
const statsRefreshIntervalMs = 250;
const sampleRateWindowMs = 500;
const bytesPerTexel = 16;

let renderer, scene, camera, controls, pane;
let pathTracer;
let pmremGenerator;
let currentModel = null;
let currentEnvironmentBackground = null;
let currentEnvironmentTarget = null;
let currentCompiledScene = null;
let loadGeneration = 0;
let currentModelHasAlbedoTexture = false;
let resumeTraceTimer = null;
const BG_COLOR = 0x333333;
const sceneParams = {
    model: 'DamagedHelmet',
    environment: 'Daytime',
};
const materialParams = {
    material: 'off',
    debugMode: 'lit',
    materialIndexing: 'off',
};
const renderParams = {
    bounceCount: 2,
    transparentSteps: 1,
    tilesX: 1,
    tilesY: 1,
    renderScale: 1,
    rasterFallback: true,
    interactionResumeDelayMs: 500,
    toneMapping: 'none',
    exposure: 1.0,
};
const debugModeOptions = {
    Off: 'lit',
    Albedo: 'albedo',
    UV: 'uv',
    'UV Fract': 'uvFract',
    Checker: 'checker',
    Facing: 'facing',
    'Geo Normal': 'geoNormal',
    'Hose Mask': 'hoseMask',
    'Hit Dist': 'hitDistance',
};
const materialIndexingOptions = {
    Off: 'off',
    'Material ID': 'materialId',
    'Material Base': 'materialBase',
    'Material Roughness': 'materialRoughness',
    'Material Metalness': 'materialMetalness',
    'Material Emissive': 'materialEmissive',
};
const debugModeValues = {
    lit: 0,
    albedo: 1,
    uv: 2,
    uvFract: 3,
    checker: 4,
    materialId: 5,
    materialBase: 6,
    materialRoughness: 7,
    materialMetalness: 8,
    materialEmissive: 9,
    facing: 10,
    geoNormal: 11,
    hoseMask: 12,
    hitDistance: 13,
};
const materialOptions = {
    Off: 'off',
    Gold: 'gold',
    Mirror: 'mirror',
};
const materialPresetValues = {
    off: 0,
    gold: 1,
    mirror: 2,
};
const outputToneMappingOptions = {
    None: 'none',
    Reinhard: 'reinhard',
    ACES: 'aces',
};
const outputToneMappingValues = {
    none: 0,
    reinhard: 1,
    aces: 2,
};
let cameraMoving = false;
const sceneCompiler = new SceneCompiler();
const loadStats = {
    loading: true,
    modelFallback: false,
    loadMs: 0,
    compileMs: 0,
    setSceneMs: 0,
    firstFrameMs: 0,
};
const sampleRate = {
    samples: Infinity,
    resetTime: 0,
    windowStart: 0,
    windowSamples: 0,
    perSecond: 0,
};
let lastStatsRefresh = 0;
let statsCollapsed = false;

init();

function modelHasAlbedoTexture(model) {
    let hasAlbedoTexture = false;

    model.traverse((child) => {
        if (hasAlbedoTexture || !child.isMesh || !child.material) {
            return;
        }

        const materials = Array.isArray(child.material) ? child.material : [child.material];
        hasAlbedoTexture = materials.some((material) => Boolean(material?.map));
    });

    return hasAlbedoTexture;
}

function fitCameraToObject(object3D) {
    const box = new Box3().setFromObject(object3D);
    const center = box.getCenter(new Vector3());
    const size = box.getSize(new Vector3());
    const maxSize = Math.max(size.x, size.y, size.z);
    const safeDistance = Math.max(maxSize * 1.8, 1.0);

    camera.position.set(
        center.x + safeDistance,
        center.y + safeDistance * 0.7,
        center.z + safeDistance
    );
    controls.target.copy(center);
    camera.near = Math.max(safeDistance / 100, 0.01);
    camera.far = Math.max(safeDistance * 20, 100);
    camera.updateProjectionMatrix();
    controls.update();
}

function applySelectedAlbedoTexture() {
    const hasOriginAlbedo = currentModelHasAlbedoTexture;

    if (materialParams.material === 'off' && !hasOriginAlbedo) {
        materialParams.material = 'gold';
        pane?.refresh();
    }

    const useOriginMaterial = materialParams.material === 'off' && hasOriginAlbedo;
    const materialPreset = useOriginMaterial
        ? materialPresetValues.off
        : materialPresetValues[materialParams.material];

    pathTracer.setMaterialPreset(materialPreset);
}

function applySelectedDebugMode() {
    const modeKey = materialParams.materialIndexing !== 'off'
        ? materialParams.materialIndexing
        : materialParams.debugMode;
    pathTracer.setDebugMode(debugModeValues[modeKey]);
}

function applyOutputSettings() {
    pathTracer.setOutputToneMapping(outputToneMappingValues[renderParams.toneMapping]);
    pathTracer.setOutputExposure(renderParams.exposure);
}

function kickTraceFrame() {
    cameraMoving = false;
    if (!pathTracer.isReady()) {
        return;
    }

    pathTracer.reset();
    pathTracer.update();
}

function clearResumeTraceTimer() {
    if (resumeTraceTimer !== null) {
        window.clearTimeout(resumeTraceTimer);
        resumeTraceTimer = null;
    }
}

function scheduleTraceResume() {
    clearResumeTraceTimer();
    const delay = Math.max(0, renderParams.interactionResumeDelayMs | 0);
    if (delay === 0) {
        kickTraceFrame();
        return;
    }

    resumeTraceTimer = window.setTimeout(() => {
        resumeTraceTimer = null;
        kickTraceFrame();
    }, delay);
}

function shouldUseRasterFallback() {
    if (!renderParams.rasterFallback) {
        return false;
    }

    return cameraMoving || !pathTracer.isReady();
}

function renderPathTracingFrame() {
    // Moving without the raster fallback restarts accumulation every frame, so
    // trace a whole sample instead of leaving only the first tile visible.
    if (cameraMoving) {
        pathTracer.reset();
        pathTracer.update(pathTracer.tileCount);
        return;
    }

    pathTracer.update();
}

function trackSampleRate(now) {
    const { samples } = pathTracer;
    if (loadStats.loading || cameraMoving || samples < sampleRate.samples) {
        sampleRate.resetTime = now;
        sampleRate.windowStart = now;
        sampleRate.windowSamples = samples;
        sampleRate.perSecond = 0;
    }
    sampleRate.samples = samples;

    const windowMs = now - sampleRate.windowStart;
    if (windowMs >= sampleRateWindowMs) {
        sampleRate.perSecond = (samples - sampleRate.windowSamples) * 1000 / windowMs;
        sampleRate.windowStart = now;
        sampleRate.windowSamples = samples;
    }
}

function formatCount(value) {
    return value.toLocaleString('en-US');
}

function formatMs(ms) {
    return `${ms.toFixed(1)} ms`;
}

function formatDataTexture(name, { textureWidth, textureHeight }) {
    const megabytes = textureWidth * textureHeight * bytesPerTexel / (1024 * 1024);
    return `${name} ${textureWidth}×${textureHeight} ${megabytes.toFixed(2)} MB`;
}

function getRenderState() {
    if (loadStats.loading || !pathTracer.isReady()) {
        return 'loading';
    }
    if (cameraMoving) {
        return renderParams.rasterFallback ? 'raster (moving)' : 'tracing (moving)';
    }
    return 'tracing';
}

function refreshStatsPanel(now) {
    const { traceRenderTarget } = pathTracer;
    const modelLabel = loadStats.modelFallback
        ? `${sceneParams.model} could not load. Showing Torus Knot.`
        : sceneParams.model;
    const lines = [
        `${modelLabel} · ${sceneParams.environment}`,
        `state      ${getRenderState()}`,
        `samples    ${formatCount(pathTracer.samples)} · ${sampleRate.perSecond.toFixed(1)}/s · ${((now - sampleRate.resetTime) / 1000).toFixed(1)} s`,
        `resolution ${traceRenderTarget.width}×${traceRenderTarget.height} · bounces ${renderParams.bounceCount}`,
        `tiles      ${pathTracer.tilesX}×${pathTracer.tilesY} · next ${pathTracer.tileIndex + 1}/${pathTracer.tileCount}`,
    ];

    if (currentCompiledScene) {
        const sceneStats = currentCompiledScene.stats;
        const textureCounts = Object.entries(currentCompiledScene.material.textures)
            .map(([type, textures]) => `${type} ${textures.length}`)
            .join(' · ');
        const { triangle, bvh, material } = currentCompiledScene;

        lines.push(
            '',
            `meshes ${formatCount(sceneStats.meshCount)} · triangles ${formatCount(sceneStats.triangleCount)} · materials ${sceneStats.materialCount}`,
            `textures   ${textureCounts}`,
            '',
            `load       ${formatMs(loadStats.loadMs)}`,
            `compile    ${formatMs(loadStats.compileMs)}`,
            `           collect ${formatMs(sceneStats.collectMs)} · bvh build ${formatMs(sceneStats.bvhBuildMs)} · encode ${formatMs(sceneStats.encodeMs)}`,
            `setScene   ${formatMs(loadStats.setSceneMs)} · first frame ${formatMs(loadStats.firstFrameMs)} (CPU)`,
            '',
            `bvh        build ${formatMs(sceneStats.bvhBuildMs)} · nodes ${formatCount(sceneStats.nodeCount)} · leaves ${formatCount(sceneStats.leafCount)}`,
            `           depth ${sceneStats.maxDepth} · max leaf ${sceneStats.maxLeafSize} tris · SAH cost ${sceneStats.sahCost.toFixed(2)}`,
            '',
            `gpu data   ${formatDataTexture('triangle', triangle)}`,
            `           ${formatDataTexture('bvh', bvh)}`,
            `           ${formatDataTexture('material', material)}`,
        );
    }

    statsBody.textContent = lines.join('\n');
}

// A pass over a few tiles finishes within a few frames, too fast to see the
// grid, so a grid change outlines and numbers the tiles for a moment.
function flashTileGrid() {
    const { tilesX, tilesY, tileCount, traceRenderTarget: { width, height } } = pathTracer;
    const pixelRatio = renderer.getPixelRatio();
    tileGrid.replaceChildren(...Array.from({ length: tileCount }, (_, index) => {
        const rect = getTileRect(index, tilesX, tilesY, width, height);
        const cell = document.createElement('div');
        cell.textContent = `${index + 1}`;
        Object.assign(cell.style, {
            left: `${rect.x / pixelRatio}px`,
            top: `${(height - rect.y - rect.height) / pixelRatio}px`,
            width: `${rect.width / pixelRatio}px`,
            height: `${rect.height / pixelRatio}px`,
        });
        return cell;
    }));
    tileGrid.hidden = false;
    window.clearTimeout(tileGridTimer);
    tileGridTimer = window.setTimeout(() => {
        tileGrid.hidden = true;
    }, tileGridDurationMs);
}

function toggleStatsPanel() {
    statsCollapsed = !statsCollapsed;
    statsTitle.textContent = `${statsCollapsed ? '▸' : '▾'} Path Tracing`;
    statsBody.hidden = statsCollapsed;
    lastStatsRefresh = 0;
}

function disposeSceneEnvironment() {
    if (currentEnvironmentBackground) {
        currentEnvironmentBackground.dispose();
        currentEnvironmentBackground = null;
    }

    if (currentEnvironmentTarget) {
        currentEnvironmentTarget.dispose();
        currentEnvironmentTarget = null;
    }

    scene.background = null;
    scene.environment = null;
}

function setSceneEnvironment(envTexture) {
    disposeSceneEnvironment();

    envTexture.mapping = EquirectangularReflectionMapping;
    currentEnvironmentBackground = envTexture;
    currentEnvironmentTarget = pmremGenerator.fromEquirectangular(envTexture);
    scene.background = currentEnvironmentBackground;
    scene.environment = currentEnvironmentTarget.texture;
}

async function loadSceneAssets() {
    const requestId = ++loadGeneration;
    loadStats.loading = true;
    pathTracer.setReady(false);
    const envUrl = assetUrl + hdrAssetPaths[sceneParams.environment];
    const modelUrl = modelUrls[sceneParams.model];

    const loadStart = performance.now();
    const [envTexture, gltf] = await Promise.all([
        new HDRLoader().loadAsync(envUrl),
        modelUrl && gltfLoader.loadAsync(modelUrl).catch((error) => {
            console.warn(`Could not load ${sceneParams.model}.`, error);
            return null;
        }),
    ]);
    const loadMs = performance.now() - loadStart;

    if (requestId !== loadGeneration) {
        envTexture.dispose();
        return;
    }

    if (currentModel) {
        scene.remove(currentModel);
    }

    currentModel = gltf?.scene ?? new Mesh(
        new TorusKnotGeometry(0.6, 0.19, 128, 24),
        new MeshStandardMaterial({ color: 0x648cb3, metalness: 0.3, roughness: 0.42 }),
    );
    currentModelHasAlbedoTexture = modelHasAlbedoTexture(currentModel);
    scene.add(currentModel);
    fitCameraToObject(currentModel);

    const compileStart = performance.now();
    const compiledScene = sceneCompiler.compile(currentModel);
    const compileMs = performance.now() - compileStart;

    setSceneEnvironment(envTexture);
    pathTracer.setHdrTexture(envTexture);
    const setSceneStart = performance.now();
    pathTracer.setScene(compiledScene);
    const setSceneMs = performance.now() - setSceneStart;
    currentCompiledScene?.dispose();
    currentCompiledScene = compiledScene;
    applySelectedAlbedoTexture();
    applySelectedDebugMode();
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    controls.update();
    const firstFrameStart = performance.now();
    kickTraceFrame();
    Object.assign(loadStats, {
        loading: false,
        modelFallback: Boolean(modelUrl) && !gltf,
        loadMs,
        compileMs,
        setSceneMs,
        firstFrameMs: performance.now() - firstFrameStart,
    });

    requestAnimationFrame(() => {
        if (requestId !== loadGeneration) {
            return;
        }
        kickTraceFrame();
    });
}

async function init() {

    renderer = new WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(BG_COLOR, 1);
    renderer.setPixelRatio(1);
    renderer.autoClear = false;
    document.body.appendChild(renderer.domElement);
    pmremGenerator = new PMREMGenerator(renderer);
    pmremGenerator.compileEquirectangularShader();

    const WIDTH = window.innerWidth;
    const HEIGHT = window.innerHeight;

    scene = new Scene();
    camera = new PerspectiveCamera(60, WIDTH / HEIGHT, 0.1, 10000);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.target = new Vector3(0, 0, 0);

    pathTracer = new PathTracer(renderer, scene, camera);
    pathTracer.setRasterFallbackRenderer(({ renderer: fallbackRenderer, scene: fallbackScene, camera: fallbackCamera }) => {
        fallbackRenderer.setRenderTarget(null);
        fallbackRenderer.clear();
        fallbackRenderer.render(fallbackScene, fallbackCamera);
    });
    pathTracer.setSize(
        WIDTH,
        HEIGHT,
        window.devicePixelRatio * renderParams.renderScale
    );
    pathTracer.setBounce(renderParams.bounceCount);
    pathTracer.setTransparentSteps(renderParams.transparentSteps);
    pathTracer.setTiles(renderParams.tilesX, renderParams.tilesY);
    applySelectedDebugMode();
    applyOutputSettings();

    initPane();
    await loadSceneAssets();
    event();
    animate();

}

function initPane() {
    pane = new Pane({ title: 'PathTracing' });

    statsTitle.addEventListener('click', toggleStatsPanel);
    pane.addButton({ title: 'Collapse / expand stats' }).on('click', toggleStatsPanel);

    const sceneFolder = pane.addFolder({ title: 'Scene' });
    sceneFolder
        .addBinding(sceneParams, 'model', {
            label: 'Model',
            options: modelOptions,
        })
        .on('change', async () => {
            await loadSceneAssets();
        });
    sceneFolder
        .addBinding(sceneParams, 'environment', {
            label: 'HDR',
            options: hdrOptions,
        })
        .on('change', async () => {
            await loadSceneAssets();
        });

    const materialFolder = pane.addFolder({ title: 'Material' });
    materialFolder
        .addBinding(materialParams, 'material', {
            label: 'Preset',
            options: materialOptions,
        })
        .on('change', () => {
            applySelectedAlbedoTexture();
            pathTracer.reset();
        });

    const renderFolder = pane.addFolder({ title: 'Render' });
    renderFolder
        .addBinding(renderParams, 'bounceCount', {
            label: 'Bounces',
            min: 1,
            max: 8,
            step: 1,
        })
        .on('change', () => {
            pathTracer.setBounce(renderParams.bounceCount);
            pathTracer.reset();
        });
    renderFolder
        .addBinding(renderParams, 'transparentSteps', {
            label: 'Trans Steps',
            min: 1,
            max: 8,
            step: 1,
        })
        .on('change', () => {
            pathTracer.setTransparentSteps(renderParams.transparentSteps);
            pathTracer.reset();
        });
    // Restarting accumulation on a grid change shows the new tiles filling in
    // from a black frame.
    for (const [key, label] of [['tilesX', 'Tiles X'], ['tilesY', 'Tiles Y']]) {
        renderFolder
            .addBinding(renderParams, key, {
                label,
                min: 1,
                max: 8,
                step: 1,
            })
            .on('change', () => {
                pathTracer.setTiles(renderParams.tilesX, renderParams.tilesY);
                pathTracer.reset();
                flashTileGrid();
            });
    }
    renderFolder
        .addBinding(renderParams, 'rasterFallback', {
            label: 'Raster Fallback',
        })
        .on('change', () => {
            pathTracer.reset();
        });
    renderFolder
        .addBinding(renderParams, 'interactionResumeDelayMs', {
            label: 'Resume Delay',
            min: 0,
            max: 1000,
            step: 10,
        });
    renderFolder
        .addBinding(renderParams, 'toneMapping', {
            label: 'Tone Map',
            options: outputToneMappingOptions,
        })
        .on('change', () => {
            applyOutputSettings();
        });
    renderFolder
        .addBinding(renderParams, 'exposure', {
            label: 'Exposure',
            min: 0.1,
            max: 3.0,
            step: 0.05,
        })
        .on('change', () => {
            applyOutputSettings();
        });

    const debugFolder = pane.addFolder({ title: 'Debug' });
    debugFolder
        .addBinding(materialParams, 'debugMode', {
            label: 'UV',
            options: debugModeOptions,
        })
        .on('change', () => {
            applySelectedDebugMode();
            pathTracer.reset();
        });
    debugFolder
        .addBinding(materialParams, 'materialIndexing', {
            label: 'Indexing',
            options: materialIndexingOptions,
        })
        .on('change', () => {
            applySelectedDebugMode();
            pathTracer.reset();
        });
}

function event() {

    window.addEventListener('resize', () => {
        const { innerWidth, innerHeight } = window;
        pathTracer.camera.aspect = innerWidth / innerHeight;
        pathTracer.reset();
        pathTracer.setSize(
            innerWidth,
            innerHeight,
            window.devicePixelRatio * renderParams.renderScale
        );
        pathTracer.update();
    });

    window.addEventListener('beforeunload', () => {
        clearResumeTraceTimer();
        pathTracer.dispose();
        currentCompiledScene?.dispose();
        disposeSceneEnvironment();
        pmremGenerator.dispose();
    });

    controls.addEventListener('start', () => {
        clearResumeTraceTimer();
        cameraMoving = true;
        pathTracer.reset();
    });

    controls.addEventListener('change', () => {
        clearResumeTraceTimer();
        cameraMoving = true;
        pathTracer.reset();
    });

    controls.addEventListener('end', () => {
        scheduleTraceResume();
    });
}

function animate(now = performance.now()) {
    requestAnimationFrame(animate);

    controls.update();
    if (shouldUseRasterFallback()) {
        pathTracer.renderRasterFallback();
    } else {
        renderPathTracingFrame();
    }

    trackSampleRate(now);
    if (!statsCollapsed && now - lastStatsRefresh >= statsRefreshIntervalMs) {
        lastStatsRefresh = now;
        refreshStatsPanel(now);
    }
}
