import { Box3, Clock, EquirectangularReflectionMapping, PMREMGenerator, PerspectiveCamera, Scene, Vector3, WebGLRenderer } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader.js";
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import Stats from 'three/examples/jsm/libs/stats.module.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { Pane } from 'tweakpane';
import { SceneGenerator } from "../extend/path-tracing/SceneGenerator";
import { PathTracer } from "../extend/path-tracing/PathTracer";

import { getAssetURL } from '/extend/tools/Tool.js'

const assetUrl = getAssetURL();
const modelAssetPaths = {
    DamagedHelmet: 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/DamagedHelmet/glTF/DamagedHelmet.gltf',
    FlightHelmet: 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/FlightHelmet/glTF/FlightHelmet.gltf',
    SciFiHelmet: 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/SciFiHelmet/glTF/SciFiHelmet.gltf',
};
const modelOptions = {
    DamagedHelmet: 'DamagedHelmet',
    FlightHelmet: 'FlightHelmet',
    SciFiHelmet: 'SciFiHelmet',
};
const hdrAssetPaths = {
    KiaraNoon: 'hdrs/kiara_5_noon_2k.hdr',
    Daytime: 'hdrs/daytime.hdr',
};
const hdrOptions = {
    KiaraNoon: 'KiaraNoon',
    Daytime: 'Daytime',
};
const info = document.querySelector("#info");

let renderer, scene, camera, controls, stats, clock, pane;
let pathTracer;
let pmremGenerator;
let currentModel = null;
let currentEnvironmentBackground = null;
let currentEnvironmentTarget = null;
let loadGeneration = 0;
let currentModelHasAlbedoTexture = false;
let resumeTraceTimer = null;
let persistedCameraState = null;
const BG_COLOR = 0x333333;
const PATH_TRACING_STATE_STORAGE_KEY = 'three-chamber:path-tracing-state';
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
    renderScale: 1,
    rasterFallback: true,
    interactionResumeDelayMs: 500,
    toneMapping: 'none',
    exposure: 1.0,
};
const samplingParams = {
    environmentMissMIS: true,
    directEnvironmentMIS: false,
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

restorePersistedState();
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

    pathTracer.setOriginMaterialInfo(null);
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

function restorePersistedState() {
    const rawState = sessionStorage.getItem(PATH_TRACING_STATE_STORAGE_KEY);
    if (!rawState) {
        return;
    }

    try {
        const state = JSON.parse(rawState);
        Object.assign(sceneParams, state.sceneParams || {});
        Object.assign(materialParams, state.materialParams || {});
        Object.assign(renderParams, state.renderParams || {});
        Object.assign(samplingParams, state.samplingParams || {});
        persistedCameraState = state.camera || null;
    } catch (error) {
        console.warn('[PathTracing] Failed to restore persisted state.', error);
    }
}

function persistCurrentState() {
    const state = {
        sceneParams: { ...sceneParams },
        materialParams: { ...materialParams },
        renderParams: { ...renderParams },
        samplingParams: { ...samplingParams },
        camera: camera && controls ? {
            position: camera.position.toArray(),
            target: controls.target.toArray(),
        } : persistedCameraState,
    };

    sessionStorage.setItem(PATH_TRACING_STATE_STORAGE_KEY, JSON.stringify(state));
}

function reloadForShaderRecompile() {
    persistCurrentState();
    location.reload();
}

function restorePersistedCameraState() {
    if (!persistedCameraState) {
        return;
    }

    if (Array.isArray(persistedCameraState.position)) {
        camera.position.fromArray(persistedCameraState.position);
    }
    if (Array.isArray(persistedCameraState.target)) {
        controls.target.fromArray(persistedCameraState.target);
    }
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    controls.update();
}

function kickTraceFrame() {
    cameraMoving = false;
    if (!pathTracer.isReady()) {
        info.innerText = 'Samples: raster';
        return;
    }

    pathTracer.reset();
    pathTracer.update();
    info.innerText = `Samples: ${pathTracer.samples}`;
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
    if (cameraMoving) {
        pathTracer.reset();
    }

    pathTracer.update();
    info.innerText = `Samples: ${pathTracer.samples}`;
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
    pathTracer.setReady(false);
    const modelPath = modelAssetPaths[sceneParams.model];
    const modelUrl = modelPath.startsWith('http') ? modelPath : assetUrl + modelPath;
    const envUrl = assetUrl + hdrAssetPaths[sceneParams.environment];

    const [envTexture, gltf] = await Promise.all([
        new RGBELoader().loadAsync(envUrl),
        new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(modelUrl),
    ]);

    if (requestId !== loadGeneration) {
        envTexture.dispose();
        return;
    }

    if (currentModel) {
        scene.remove(currentModel);
    }

    currentModel = gltf.scene;
    currentModelHasAlbedoTexture = modelHasAlbedoTexture(currentModel);
    scene.add(currentModel);
    fitCameraToObject(currentModel);
    restorePersistedCameraState();

    const sceneGenerator = new SceneGenerator(currentModel);
    const { triangle, bvh, material } = sceneGenerator.generate();

    setSceneEnvironment(envTexture);
    pathTracer.setHdrTexture(envTexture);
    pathTracer.setDataTexture(triangle, bvh, material);
    applySelectedAlbedoTexture();
    applySelectedDebugMode();
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    controls.update();
    kickTraceFrame();

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
    clock = new Clock();
    stats = new Stats();
    document.body.appendChild(stats.dom);

    pathTracer = new PathTracer(renderer, scene, camera);
    pathTracer.setRasterFallbackRenderer(({ renderer: fallbackRenderer, scene: fallbackScene, camera: fallbackCamera }) => {
        fallbackRenderer.setRenderTarget(null);
        fallbackRenderer.clear();
        fallbackRenderer.render(fallbackScene, fallbackCamera);
        info.innerText = 'Samples: raster';
    });
    pathTracer.setSize(WIDTH * renderParams.renderScale, HEIGHT * renderParams.renderScale);
    pathTracer.setBounce(renderParams.bounceCount);
    pathTracer.setTransparentSteps(renderParams.transparentSteps);
    pathTracer.setEnvironmentMissMIS(samplingParams.environmentMissMIS);
    pathTracer.setDirectEnvironmentMIS(samplingParams.directEnvironmentMIS);
    applySelectedDebugMode();
    applyOutputSettings();

    initPane();
    await loadSceneAssets();
    event();
    animate();

}

function initPane() {
    pane = new Pane({ title: 'PathTracing' });

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
            pathTracer.reset();
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
            pathTracer.reset();
        });

    const samplingFolder = pane.addFolder({ title: 'Sampling' });
    samplingFolder
        .addBinding(samplingParams, 'environmentMissMIS', {
            label: 'Env Miss MIS (recompile)',
        })
        .on('change', () => {
            reloadForShaderRecompile();
        });
    samplingFolder
        .addBinding(samplingParams, 'directEnvironmentMIS', {
            label: 'Env MIS (recompile)',
        })
        .on('change', () => {
            reloadForShaderRecompile();
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
        pathTracer.setSize(innerWidth * renderParams.renderScale, innerHeight * renderParams.renderScale);
        pathTracer.update();
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

function animate() {
    requestAnimationFrame(animate);

    stats.update()
    controls.update();
    if (shouldUseRasterFallback()) {
        pathTracer.renderRasterFallback();
        return;
    }

    renderPathTracingFrame();

}
