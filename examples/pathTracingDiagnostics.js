import {
    AmbientLight,
    BoxGeometry,
    Color,
    DataTexture,
    DirectionalLight,
    EquirectangularReflectionMapping,
    FloatType,
    LinearFilter,
    Mesh,
    MeshStandardMaterial,
    NoColorSpace,
    PerspectiveCamera,
    PlaneGeometry,
    RGBAFormat,
    Scene,
    SphereGeometry,
    WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Pane } from 'tweakpane';

import {
    bsdfEventFlags,
    clientPointToRenderTargetPixel,
    decodeFlags,
    pathDiagnosticModes,
    pathFailureFlags,
    pathTerminationReasons,
} from '../extend/path-tracing/Diagnostics.js';
import { PathTracer } from '../extend/path-tracing/PathTracer.js';
import { SceneCompiler } from '../extend/path-tracing/compiler/SceneCompiler.js';

const statusElement = document.querySelector('#status');
const reportElement = document.querySelector('#diagnostic-report');
const markerElement = document.querySelector('#pixel-marker');

const diagnosticOptions = {
    Radiance: 'radiance',
    'Path length': 'pathLength',
    'Termination reason': 'termination',
    'BSDF event': 'event',
    'Sample PDF': 'pdf',
    'Max throughput': 'throughput',
    'Max contribution': 'contribution',
    'Failure flags': 'failure',
};
const parameters = {
    diagnostic: 'pathLength',
    bounces: 6,
    extremeThreshold: 100,
    pauseRendering: false,
    autoStopSamples: 256,
};

let selectedPixel = null;
let pendingPixelRead = false;
let pointerStart = null;
let renderOneSample = false;

const renderer = new WebGLRenderer({ antialias: true });
renderer.setPixelRatio(1);
renderer.autoClear = false;
renderer.setClearColor(0x11141a, 1);
document.body.appendChild(renderer.domElement);

const scene = new Scene();
scene.background = new Color(0x202837);
const camera = new PerspectiveCamera(52, 1, 0.05, 100);
camera.position.set(5.2, 3.2, 6.5);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.8, 0);
controls.enableDamping = true;

const resources = [];

function addMesh(geometry, material, position) {
    const mesh = new Mesh(geometry, material);
    mesh.position.copy(position);
    scene.add(mesh);
    resources.push(geometry, material);
    return mesh;
}

function buildProceduralScene() {
    const floor = addMesh(
        new PlaneGeometry(12, 12),
        new MeshStandardMaterial({ color: 0x8b929d, roughness: 0.82 }),
        { x: 0, y: 0, z: 0 }
    );
    floor.rotation.x = -Math.PI / 2;

    addMesh(
        new SphereGeometry(1, 48, 24),
        new MeshStandardMaterial({ color: 0xd9d9dd, roughness: 0.12, metalness: 0.92 }),
        { x: -1.45, y: 1.0, z: 0 }
    );
    addMesh(
        new SphereGeometry(0.9, 48, 24),
        new MeshStandardMaterial({ color: 0xbd4b35, roughness: 0.72, metalness: 0.0 }),
        { x: 1.25, y: 0.9, z: 0.2 }
    );
    addMesh(
        new BoxGeometry(1.2, 1.2, 1.2),
        new MeshStandardMaterial({
            color: 0x161616,
            emissive: 0xff7b32,
            emissiveIntensity: 5,
            roughness: 0.4,
        }),
        { x: 0, y: 2.8, z: -1.4 }
    );

    scene.add(new AmbientLight(0xffffff, 0.35));
    const keyLight = new DirectionalLight(0xffffff, 2.4);
    keyLight.position.set(3, 5, 4);
    scene.add(keyLight);
}

function createConstantEnvironment() {
    const data = new Float32Array([
        0.8, 0.9, 1.1, 1,
        0.8, 0.9, 1.1, 1,
        0.8, 0.9, 1.1, 1,
        0.8, 0.9, 1.1, 1,
    ]);
    const texture = new DataTexture(data, 2, 2, RGBAFormat, FloatType);
    texture.mapping = EquirectangularReflectionMapping;
    texture.colorSpace = NoColorSpace;
    texture.minFilter = LinearFilter;
    texture.magFilter = LinearFilter;
    texture.needsUpdate = true;
    return texture;
}

buildProceduralScene();
scene.updateMatrixWorld(true);

const compiledScene = new SceneCompiler().compile(scene);
const environmentTexture = createConstantEnvironment();
const pathTracer = new PathTracer(renderer, scene, camera);
pathTracer.setScene(compiledScene);
pathTracer.setHdrTexture(environmentTexture);
pathTracer.setBounce(parameters.bounces);
pathTracer.setDiagnosticExtremeThreshold(parameters.extremeThreshold);
pathTracer.setRasterFallbackRenderer(({ renderer: activeRenderer, scene: activeScene, camera: activeCamera }) => {
    activeRenderer.setRenderTarget(null);
    activeRenderer.clear();
    activeRenderer.render(activeScene, activeCamera);
});

function applyDiagnosticMode() {
    pathTracer.setDiagnosticMode(pathDiagnosticModes[parameters.diagnostic]);
    pathTracer.reset();
    pendingPixelRead = selectedPixel !== null;
}

function formatNumber(value) {
    if (!Number.isFinite(value)) {
        return String(value);
    }
    if (value === 0) {
        return '0';
    }
    return Math.abs(value) < 0.001 || Math.abs(value) >= 1000
        ? value.toExponential(4)
        : value.toFixed(5);
}

function updateDiagnosticReport() {
    if (!selectedPixel || pathDiagnosticModes[parameters.diagnostic] === 0) {
        return;
    }

    const diagnostic = pathTracer.readDiagnosticPixel(selectedPixel.x, selectedPixel.y);
    const firstFailure = diagnostic.firstFailureBounce < 0
        ? 'None'
        : String(diagnostic.firstFailureBounce);

    reportElement.textContent = [
        `Pixel              ${diagnostic.pixel.x}, ${diagnostic.pixel.y}`,
        `Path length        ${diagnostic.pathLength}`,
        `Termination        ${pathTerminationReasons[diagnostic.terminationReason] ?? diagnostic.terminationReason}`,
        `Last BSDF event    ${decodeFlags(diagnostic.bsdfEventFlags, bsdfEventFlags).join(' | ')}`,
        `Sample PDF         ${formatNumber(diagnostic.samplePdf)}`,
        `Max throughput     ${formatNumber(diagnostic.maxThroughput)}`,
        `Max contribution   ${formatNumber(diagnostic.maxContribution)}`,
        `First bad bounce   ${firstFailure}`,
        `Failure flags      ${decodeFlags(diagnostic.failureFlags, pathFailureFlags).join(' | ')}`,
    ].join('\n');
}

function resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    pathTracer.setSize(width, height, window.devicePixelRatio);
    pathTracer.reset();
    pendingPixelRead = selectedPixel !== null;
}

function inspectPointer(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    selectedPixel = clientPointToRenderTargetPixel(
        event.clientX,
        event.clientY,
        rect,
        pathTracer.diagnosticSummaryRenderTarget.width,
        pathTracer.diagnosticSummaryRenderTarget.height
    );
    markerElement.style.display = 'block';
    markerElement.style.left = `${event.clientX}px`;
    markerElement.style.top = `${event.clientY}px`;

    if (pathDiagnosticModes[parameters.diagnostic] === 0) {
        parameters.diagnostic = 'pathLength';
        pane.refresh();
        applyDiagnosticMode();
    }
    pendingPixelRead = true;
}

const pane = new Pane({ title: 'Path diagnostics' });
pane.addBinding(parameters, 'diagnostic', {
    label: 'View',
    options: diagnosticOptions,
}).on('change', applyDiagnosticMode);
pane.addBinding(parameters, 'bounces', {
    label: 'Bounces',
    min: 1,
    max: 8,
    step: 1,
}).on('change', () => {
    pathTracer.setBounce(parameters.bounces);
    pathTracer.reset();
});
pane.addBinding(parameters, 'extremeThreshold', {
    label: 'Extreme',
    min: 1,
    max: 1000,
    step: 1,
}).on('change', () => {
    pathTracer.setDiagnosticExtremeThreshold(parameters.extremeThreshold);
    pathTracer.reset();
});
pane.addBinding(parameters, 'pauseRendering', { label: 'Pause GPU' });
pane.addBinding(parameters, 'autoStopSamples', {
    label: 'Auto stop',
    min: 0,
    max: 2048,
    step: 1,
}).on('change', () => {
    if (parameters.autoStopSamples === 0 || pathTracer.samples < parameters.autoStopSamples) {
        parameters.pauseRendering = false;
        pane.refresh();
    }
});
pane.addButton({ title: 'Render one sample' }).on('click', () => {
    renderOneSample = true;
});
pane.addButton({ title: 'Reset accumulation' }).on('click', () => {
    pathTracer.reset();
    pendingPixelRead = selectedPixel !== null;
});

controls.addEventListener('change', () => {
    pathTracer.reset();
    pendingPixelRead = selectedPixel !== null;
});

renderer.domElement.addEventListener('pointerdown', (event) => {
    pointerStart = { x: event.clientX, y: event.clientY };
});
renderer.domElement.addEventListener('pointerup', (event) => {
    if (!pointerStart) {
        return;
    }
    const dragDistance = Math.hypot(
        event.clientX - pointerStart.x,
        event.clientY - pointerStart.y
    );
    if (dragDistance < 4) {
        inspectPointer(event);
    }
    pointerStart = null;
});

window.addEventListener('resize', resize);
window.addEventListener('beforeunload', () => {
    controls.dispose();
    pane.dispose();
    pathTracer.dispose();
    compiledScene.dispose();
    environmentTexture.dispose();
    resources.forEach((resource) => resource.dispose());
    renderer.dispose();
});

applyDiagnosticMode();
resize();

function animate() {
    requestAnimationFrame(animate);
    controls.update();

    const reachedSampleLimit = parameters.autoStopSamples > 0
        && pathTracer.samples >= parameters.autoStopSamples;
    const shouldRender = renderOneSample
        || pathTracer.samples === 0
        || pendingPixelRead
        || (!parameters.pauseRendering && !reachedSampleLimit);

    if (shouldRender) {
        pathTracer.update();
        renderOneSample = false;
        pendingPixelRead = false;
        updateDiagnosticReport();
    }

    const viewLabel = Object.entries(diagnosticOptions)
        .find(([, value]) => value === parameters.diagnostic)?.[0] ?? parameters.diagnostic;
    const pauseReason = parameters.pauseRendering
        ? ' · GPU paused'
        : reachedSampleLimit
            ? ' · auto-stopped'
            : '';
    statusElement.textContent = `Samples: ${pathTracer.samples} · ${viewLabel}${pauseReason}`;
}

animate();
