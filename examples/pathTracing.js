import * as THREE from 'three';
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
    DamagedHelmet: 'models/pbr/DamagedHelmet.glb',
    Bunny: 'models/static/bunny.glb',
    Dragon: 'models/static/dragon.glb',
};
const modelOptions = {
    DamagedHelmet: 'DamagedHelmet',
    Bunny: 'Bunny',
    Dragon: 'Dragon',
};
const hdrAssetPaths = {
    KiaraNoon: 'hdrs/kiara_5_noon_2k.hdr',
    Daytime: 'hdrs/daytime.hdr',
    NoonGrass: 'hdrs/noon_grass_2k.hdr',
};
const hdrOptions = {
    KiaraNoon: 'KiaraNoon',
    Daytime: 'Daytime',
    NoonGrass: 'NoonGrass',
};
const info = document.querySelector("#info");

let renderer, scene, camera, controls, stats, clock, pane;
let pathTracer;
let currentModel = null;
let loadGeneration = 0;
const BG_COLOR = 0x333333;
const sceneParams = {
    model: 'DamagedHelmet',
    environment: 'KiaraNoon',
};
const materialParams = {
    material: 'origin',
    debugMode: 'lit',
};
let currentModelTextureInfo = null;
const debugModeOptions = {
    Lit: 'lit',
    Albedo: 'albedo',
    UV: 'uv',
    'UV Fract': 'uvFract',
    Checker: 'checker',
};
const debugModeValues = {
    lit: 0,
    albedo: 1,
    uv: 2,
    uvFract: 3,
    checker: 4,
};
const materialOptions = {
    Origin: 'origin',
    Gold: 'gold',
    Mirror: 'mirror',
};
const materialPresetValues = {
    origin: 0,
    gold: 1,
    mirror: 2,
};

let cameraMoving = false;

init();

function getTextureSummary(texture) {
    if (!texture) return null;

    const image = texture.image || {};
    return {
        name: texture.name || null,
        uuid: texture.uuid,
        source: image.currentSrc || image.src || image.data?.src || null,
        size: Number.isFinite(image.width) && Number.isFinite(image.height)
            ? `${image.width}x${image.height}`
            : null,
        colorSpace: texture.colorSpace || null,
    };
}

function printModelTextures(model) {
    const textureInfo = {
        albedo: null,
        normal: null,
        roughness: null,
        metalness: null,
        ao: null,
        emissive: null,
        baseColorFactor: new THREE.Vector3(1, 1, 1),
        roughnessFactor: 1.0,
        metalnessFactor: 0.0,
        emissiveFactor: new THREE.Vector3(0, 0, 0),
        normalScale: new THREE.Vector2(1, 1),
        aoIntensity: 1.0,
    };
    let materialFactorsCaptured = false;

    model.traverse((child) => {
        if (!child.isMesh || !child.material) return;

        const materials = Array.isArray(child.material) ? child.material : [child.material];
        materials.forEach((material, index) => {
            if (!textureInfo.albedo && material.map) textureInfo.albedo = material.map;
            if (!textureInfo.normal && material.normalMap) textureInfo.normal = material.normalMap;
            if (!textureInfo.roughness && material.roughnessMap) textureInfo.roughness = material.roughnessMap;
            if (!textureInfo.metalness && material.metalnessMap) textureInfo.metalness = material.metalnessMap;
            if (!textureInfo.ao && material.aoMap) textureInfo.ao = material.aoMap;
            if (!textureInfo.emissive && material.emissiveMap) textureInfo.emissive = material.emissiveMap;
            if (!materialFactorsCaptured) {
                textureInfo.baseColorFactor.set(
                    material.color?.r ?? 1,
                    material.color?.g ?? 1,
                    material.color?.b ?? 1,
                );
                textureInfo.roughnessFactor = material.roughness ?? 1.0;
                textureInfo.metalnessFactor = material.metalness ?? 0.0;
                textureInfo.emissiveFactor.set(
                    (material.emissive?.r ?? 0) * (material.emissiveIntensity ?? 1.0),
                    (material.emissive?.g ?? 0) * (material.emissiveIntensity ?? 1.0),
                    (material.emissive?.b ?? 0) * (material.emissiveIntensity ?? 1.0),
                );
                textureInfo.normalScale.set(
                    material.normalScale?.x ?? 1.0,
                    material.normalScale?.y ?? 1.0,
                );
                textureInfo.aoIntensity = material.aoMapIntensity ?? 1.0;
                materialFactorsCaptured = true;
            }

            const label = `${child.name || 'Mesh'}#${index}`;
            console.group(`[PathTracing] Material textures: ${label}`);
            console.log('material', {
                name: material.name || null,
                type: material.type,
            });
            console.log('map', getTextureSummary(material.map));
            console.log('normalMap', getTextureSummary(material.normalMap));
            console.log('roughnessMap', getTextureSummary(material.roughnessMap));
            console.log('metalnessMap', getTextureSummary(material.metalnessMap));
            console.log('aoMap', getTextureSummary(material.aoMap));
            console.log('emissiveMap', getTextureSummary(material.emissiveMap));
            console.groupEnd();
        });
    });

    return textureInfo;
}

function fitCameraToObject(object3D) {
    const box = new THREE.Box3().setFromObject(object3D);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
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
    const hasOriginAlbedo = Boolean(currentModelTextureInfo?.albedo);

    if (materialParams.material === 'origin' && !hasOriginAlbedo) {
        materialParams.material = 'gold';
        pane?.refresh();
    }

    const useOriginMaterial = materialParams.material === 'origin' && hasOriginAlbedo;
    const materialPreset = useOriginMaterial
        ? materialPresetValues.origin
        : materialPresetValues[materialParams.material];

    pathTracer.setOriginMaterialInfo(useOriginMaterial ? currentModelTextureInfo : null);
    pathTracer.setMaterialPreset(materialPreset);
}

async function loadSceneAssets() {
    const requestId = ++loadGeneration;
    const modelUrl = assetUrl + modelAssetPaths[sceneParams.model];
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
    currentModelTextureInfo = printModelTextures(currentModel);
    scene.add(currentModel);
    fitCameraToObject(currentModel);

    const sceneGenerator = new SceneGenerator(currentModel);
    const { triangle, bvh } = sceneGenerator.generate();
    currentModel.visible = false;

    pathTracer.setHdrTexture(envTexture);
    pathTracer.setDataTexture(triangle, bvh);
    applySelectedAlbedoTexture();
    pathTracer.reset();
}

async function init() {

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(BG_COLOR, 1);
    renderer.setPixelRatio(1);
    renderer.autoClear = false;
    document.body.appendChild(renderer.domElement);

    const WIDTH = window.innerWidth;
    const HEIGHT = window.innerHeight;

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(60, WIDTH / HEIGHT, 0.1, 10000);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.target = new THREE.Vector3(0, 0, 0);
    clock = new THREE.Clock();
    stats = new Stats();
    document.body.appendChild(stats.dom);

    pathTracer = new PathTracer(renderer, scene, camera);
    pathTracer.setSize(WIDTH, HEIGHT);
    pathTracer.setBounce(3);
    pathTracer.setDebugMode(debugModeValues[materialParams.debugMode]);

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
    materialFolder
        .addBinding(materialParams, 'debugMode', {
            label: 'Debug',
            options: debugModeOptions,
        })
        .on('change', () => {
            pathTracer.setDebugMode(debugModeValues[materialParams.debugMode]);
            pathTracer.reset();
        });
}

function event() {

    window.addEventListener('resize', () => {
        const { innerWidth, innerHeight } = window;
        pathTracer.camera.aspect = innerWidth / innerHeight;
        pathTracer.reset();
        pathTracer.setSize(innerWidth, innerHeight);
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
