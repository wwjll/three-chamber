import { Box3, Clock, PerspectiveCamera, Scene, Vector3, WebGLRenderer } from 'three';
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
let currentModel = null;
let loadGeneration = 0;
let currentModelHasAlbedoTexture = false;
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
    renderScale: 1,
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
let cameraMoving = false;

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

function kickTraceFrame() {
    cameraMoving = false;
    pathTracer.reset();
    pathTracer.update();
    info.innerText = `Samples: ${pathTracer.samples}`;
}

async function loadSceneAssets() {
    const requestId = ++loadGeneration;
    const modelPath = modelAssetPaths[sceneParams.model];
    const modelUrl = modelPath.startsWith('http') ? modelPath : assetUrl + modelPath;
    const envUrl = assetUrl + hdrAssetPaths[sceneParams.environment];

    const [envTexture, gltf] = await Promise.all([
        new RGBELoader().loadAsync(envUrl),
        new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(modelUrl),
    ]);

    if (requestId !== loadGeneration) {
        return;
    }

    if (currentModel) {
        scene.remove(currentModel);
    }

    currentModel = gltf.scene;
    currentModelHasAlbedoTexture = modelHasAlbedoTexture(currentModel);
    scene.add(currentModel);
    fitCameraToObject(currentModel);

    const sceneGenerator = new SceneGenerator(currentModel);
    const { triangle, bvh, material } = sceneGenerator.generate();
    currentModel.visible = false;

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
    pathTracer.setSize(WIDTH * renderParams.renderScale, HEIGHT * renderParams.renderScale);
    pathTracer.setBounce(renderParams.bounceCount);
    pathTracer.setTransparentSteps(renderParams.transparentSteps);
    pathTracer.setEnvironmentMissMIS(samplingParams.environmentMissMIS);
    pathTracer.setDirectEnvironmentMIS(samplingParams.directEnvironmentMIS);
    applySelectedDebugMode();

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

    const samplingFolder = pane.addFolder({ title: 'Sampling' });
    samplingFolder
        .addBinding(samplingParams, 'environmentMissMIS', {
            label: 'Env Miss MIS',
        })
        .on('change', () => {
            pathTracer.setEnvironmentMissMIS(samplingParams.environmentMissMIS);
            pathTracer.reset();
        });
    samplingFolder
        .addBinding(samplingParams, 'directEnvironmentMIS', {
            label: 'Env MIS',
        })
        .on('change', () => {
            pathTracer.setDirectEnvironmentMIS(samplingParams.directEnvironmentMIS);
            pathTracer.reset();
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
        cameraMoving = true;
        pathTracer.reset();
    });

    controls.addEventListener('change', () => {
        cameraMoving = true;
        pathTracer.reset();
    });

    controls.addEventListener('end', () => {
        cameraMoving = false;
    });
}

function animate() {
    requestAnimationFrame(animate);

    stats.update()
    controls.update();

    if (cameraMoving) {
        pathTracer.reset();
    }

    pathTracer.update();

    info.innerText = `Samples: ${pathTracer.samples}`

}
