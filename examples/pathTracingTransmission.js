import {
    ACESFilmicToneMapping,
    Box3,
    CanvasTexture,
    CylinderGeometry,
    EquirectangularReflectionMapping,
    Group,
    Mesh,
    MeshPhysicalMaterial,
    MeshStandardMaterial,
    PMREMGenerator,
    PerspectiveCamera,
    PlaneGeometry,
    SRGBColorSpace,
    Scene,
    SphereGeometry,
    Vector3,
    WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { Pane } from 'tweakpane';
import { SceneCompiler } from '../extend/path-tracing/compiler/SceneCompiler.js';
import { PathTracer } from '../extend/path-tracing/PathTracer.js';

import { getAssetURL } from '/extend/tools/Tool.js';

/**
 * Test bed for transmissive (dielectric) materials. Simple analytic shapes
 * make refraction easy to reason about; the glTF dragon adds a real asset with
 * KHR_materials_transmission and KHR_materials_volume. The raster view renders
 * the same scene with three.js's own transmission as a reference.
 */

const THREE_MODEL_PATH = 'https://raw.githubusercontent.com/mrdoob/three.js/r187/examples/models/gltf/';
const DRACO_PATH = 'https://raw.githubusercontent.com/mrdoob/three.js/r187/examples/jsm/libs/draco/gltf/';
const DRAGON_URL = `${THREE_MODEL_PATH}DragonAttenuation.glb`;
const HDR_URL = `${getAssetURL()}hdrs/daytime.hdr`;
const RESUME_DELAY_MS = 300;
const MAX_ATTENUATION_DISTANCE = 20;

const statsElement = document.querySelector('#stats');
const gltfLoader = new GLTFLoader()
    .setMeshoptDecoder(MeshoptDecoder)
    .setDRACOLoader(new DRACOLoader().setDecoderPath(DRACO_PATH));
const sceneCompiler = new SceneCompiler();

const params = {
    shape: 'sphere',
    view: 'path',
    bounceCount: 8,
};
const glassParams = {
    color: '#ffffff',
    transmission: 1,
    ior: 1.5,
    roughness: 0,
    thickness: 1,
    attenuationColor: '#ffffff',
    attenuationDistance: MAX_ATTENUATION_DISTANCE,
};
const shapeLabels = { sphere: 'Sphere', prism: 'Prism', dragon: 'Dragon' };

let renderer, scene, camera, controls, pane, pathTracer, pmremGenerator, environmentTarget;
let currentModel = null;
let currentCompiledScene = null;
let glassMaterials = [];
let loadGeneration = 0;
let modelFallback = false;
let cameraMoving = false;
let resumeTimer = null;

init();

function createCheckerTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 512;
    const context = canvas.getContext('2d');
    const squares = 8;
    const size = canvas.width / squares;
    for (let y = 0; y < squares; y++) {
        for (let x = 0; x < squares; x++) {
            context.fillStyle = (x + y) % 2 === 0 ? '#e8e8e8' : '#3a3f4a';
            context.fillRect(x * size, y * size, size, size);
        }
    }
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    return texture;
}

// An upright triangular prism standing on one triangular end. Non-indexed
// vertices give every face its own flat normal, so the faces do not get
// smoothed into a rounded shape. The base lands just above the floor; a
// coplanar base would z-fight with it.
function createPrismGeometry() {
    const height = 2.4;
    const geometry = new CylinderGeometry(1, 1, height, 3, 1).translate(0, height / 2 - 0.999, 0).toNonIndexed();
    geometry.computeVertexNormals();
    return geometry;
}

function createGlassMaterial() {
    return new MeshPhysicalMaterial({ metalness: 0 });
}

// The shape sits on a checker floor so refraction visibly bends the squares.
function createShapeScene(shape) {
    const geometry = shape === 'prism' ? createPrismGeometry() : new SphereGeometry(1, 96, 48);
    const floor = new Mesh(
        new PlaneGeometry(8, 8).rotateX(-Math.PI / 2),
        new MeshStandardMaterial({ map: createCheckerTexture(), roughness: 0.9 }),
    );
    floor.position.y = -1;
    return new Group().add(new Mesh(geometry, createGlassMaterial()), floor);
}

function collectGlassMaterials(model) {
    const materials = new Set();
    model.traverse((child) => {
        if (child.isMesh && child.material.isMeshPhysicalMaterial && child.material.transmission > 0) {
            materials.add(child.material);
        }
    });
    return [...materials];
}

// A loaded model keeps its authored glass, so the panel starts from it.
function readGlassParams(material) {
    Object.assign(glassParams, {
        color: `#${material.color.getHexString()}`,
        transmission: material.transmission,
        ior: material.ior,
        roughness: material.roughness,
        thickness: material.thickness,
        attenuationColor: `#${material.attenuationColor.getHexString()}`,
        attenuationDistance: Math.min(material.attenuationDistance, MAX_ATTENUATION_DISTANCE),
    });
}

function applyGlassParams() {
    for (const material of glassMaterials) {
        material.color.set(glassParams.color);
        material.attenuationColor.set(glassParams.attenuationColor);
        material.transmission = glassParams.transmission;
        material.ior = glassParams.ior;
        material.roughness = glassParams.roughness;
        material.thickness = glassParams.thickness;
        material.attenuationDistance = glassParams.attenuationDistance;
    }
}

function fitCameraToObject(object) {
    const box = new Box3().setFromObject(object);
    const center = box.getCenter(new Vector3());
    const distance = Math.max(box.getSize(new Vector3()).length() * 0.9, 1);
    camera.position.set(center.x + distance * 0.6, center.y + distance * 0.45, center.z + distance);
    camera.near = distance / 100;
    camera.far = distance * 20;
    camera.updateProjectionMatrix();
    controls.target.copy(center);
    controls.update();
}

function compileScene() {
    const compiledScene = sceneCompiler.compile(currentModel);
    pathTracer.setScene(compiledScene);
    currentCompiledScene?.dispose();
    currentCompiledScene = compiledScene;
    pathTracer.reset();
}

async function loadShape() {
    const requestId = ++loadGeneration;
    pathTracer.setReady(false);

    let model = null;
    if (params.shape === 'dragon') {
        const gltf = await gltfLoader.loadAsync(DRAGON_URL).catch((error) => {
            console.warn('Could not load the dragon.', error);
            return null;
        });
        if (requestId !== loadGeneration) {
            return;
        }
        model = gltf?.scene ?? null;
    }
    modelFallback = params.shape === 'dragon' && !model;
    model ??= createShapeScene(modelFallback ? 'sphere' : params.shape);

    if (currentModel) {
        scene.remove(currentModel);
    }
    currentModel = model;
    scene.add(currentModel);

    glassMaterials = collectGlassMaterials(currentModel);
    if (glassMaterials.length === 0) {
        currentModel.traverse((child) => {
            if (child.isMesh && child.material.isMeshPhysicalMaterial) {
                glassMaterials.push(child.material);
            }
        });
    }
    if (params.shape === 'dragon' && !modelFallback) {
        readGlassParams(glassMaterials[0]);
        pane.refresh();
    }
    applyGlassParams();

    fitCameraToObject(currentModel);
    compileScene();
    cameraMoving = false;
}

function describeStats() {
    const shapeLabel = modelFallback
        ? 'Dragon could not load. Showing Sphere.'
        : shapeLabels[params.shape];
    const view = params.view === 'path' ? 'path traced' : 'raster reference (three.js)';
    const lines = [`${shapeLabel} · ${view}`];
    if (params.view === 'path') {
        lines.push(`samples    ${pathTracer.samples.toLocaleString('en-US')} · bounces ${params.bounceCount}`);
    }
    if (currentCompiledScene) {
        const { triangleCount, materialCount } = currentCompiledScene.stats;
        lines.push(`triangles  ${triangleCount.toLocaleString('en-US')} · materials ${materialCount}`);
    }
    lines.push(
        `glass      ${glassMaterials.length} material${glassMaterials.length === 1 ? '' : 's'}`,
        `           transmission ${glassParams.transmission.toFixed(2)} · ior ${glassParams.ior.toFixed(2)} · roughness ${glassParams.roughness.toFixed(2)}`,
        `           thickness ${glassParams.thickness.toFixed(2)} · attenuation ${glassParams.attenuationColor} at ${glassParams.attenuationDistance.toFixed(1)}`,
    );
    return lines.join('\n');
}

function initPane() {
    pane = new Pane({ title: 'Transmission' });

    const sceneFolder = pane.addFolder({ title: 'Scene' });
    sceneFolder
        .addBinding(params, 'shape', {
            label: 'Shape',
            options: Object.fromEntries(Object.entries(shapeLabels).map(([shape, label]) => [label, shape])),
        })
        .on('change', loadShape);
    sceneFolder
        .addBinding(params, 'view', {
            label: 'View',
            options: { 'Path traced': 'path', 'Raster reference': 'raster' },
        })
        .on('change', () => {
            pathTracer.reset();
        });
    sceneFolder
        .addBinding(params, 'bounceCount', { label: 'Bounces', min: 1, max: 8, step: 1 })
        .on('change', () => {
            pathTracer.setBounce(params.bounceCount);
            pathTracer.reset();
        });

    // The raster reference follows every slider step. The path tracer reads
    // materials only when the scene compiles, so it recompiles once a drag ends.
    const glassFolder = pane.addFolder({ title: 'Glass' });
    glassFolder.addBinding(glassParams, 'color', { label: 'Color' });
    glassFolder.addBinding(glassParams, 'transmission', { label: 'Transmission', min: 0, max: 1, step: 0.01 });
    glassFolder.addBinding(glassParams, 'ior', { label: 'IOR', min: 1, max: 2.5, step: 0.01 });
    glassFolder.addBinding(glassParams, 'roughness', { label: 'Roughness', min: 0, max: 1, step: 0.01 });
    glassFolder.addBinding(glassParams, 'thickness', { label: 'Thickness', min: 0, max: 5, step: 0.05 });
    glassFolder.addBinding(glassParams, 'attenuationColor', { label: 'Atten. Color' });
    glassFolder.addBinding(glassParams, 'attenuationDistance', {
        label: 'Atten. Dist',
        min: 0.1,
        max: MAX_ATTENUATION_DISTANCE,
        step: 0.1,
    });
    glassFolder.on('change', (event) => {
        applyGlassParams();
        if (event.last && pathTracer.isReady()) {
            compileScene();
        }
    });
}

function initEvents() {
    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        pathTracer.reset();
        pathTracer.setSize(window.innerWidth, window.innerHeight, window.devicePixelRatio);
    });

    window.addEventListener('beforeunload', () => {
        pathTracer.dispose();
        currentCompiledScene?.dispose();
        environmentTarget?.dispose();
        pmremGenerator.dispose();
    });

    // While the camera moves the raster view stands in, so dragging stays
    // smooth; tracing restarts shortly after the drag ends.
    controls.addEventListener('change', () => {
        window.clearTimeout(resumeTimer);
        cameraMoving = true;
        pathTracer.reset();
    });
    controls.addEventListener('end', () => {
        resumeTimer = window.setTimeout(() => {
            cameraMoving = false;
            pathTracer.reset();
        }, RESUME_DELAY_MS);
    });
}

function animate() {
    requestAnimationFrame(animate);

    if (params.view === 'raster' || cameraMoving || !pathTracer.isReady()) {
        pathTracer.renderRasterFallback();
    } else {
        pathTracer.update();
    }
    statsElement.textContent = describeStats();
}

async function init() {
    renderer = new WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.autoClear = false;
    document.body.appendChild(renderer.domElement);
    pmremGenerator = new PMREMGenerator(renderer);

    scene = new Scene();
    camera = new PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
    controls = new OrbitControls(camera, renderer.domElement);

    pathTracer = new PathTracer(renderer, scene, camera);
    pathTracer.setRasterFallbackRenderer(({ renderer: rasterRenderer, scene: rasterScene, camera: rasterCamera }) => {
        rasterRenderer.setRenderTarget(null);
        rasterRenderer.clear();
        rasterRenderer.render(rasterScene, rasterCamera);
    });
    pathTracer.setSize(window.innerWidth, window.innerHeight, window.devicePixelRatio);
    pathTracer.setBounce(params.bounceCount);

    const envTexture = await new HDRLoader().loadAsync(HDR_URL);
    envTexture.mapping = EquirectangularReflectionMapping;
    environmentTarget = pmremGenerator.fromEquirectangular(envTexture);
    scene.background = envTexture;
    scene.environment = environmentTarget.texture;
    pathTracer.setHdrTexture(envTexture);

    initPane();
    initEvents();
    await loadShape();
    animate();
}
