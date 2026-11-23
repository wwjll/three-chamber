import {
    AdditiveBlending,
    AmbientLight,
    AnimationClip,
    AnimationMixer,
    BlendMode,
    Box3,
    Color,
    DirectionalLight,
    DynamicDrawUsage,
    Float32BufferAttribute,
    InstancedBufferAttribute,
    InstancedMesh,
    MathUtils,
    Mesh,
    MeshBasicNodeMaterial,
    MeshStandardMaterial,
    NormalBlending,
    Object3D,
    PCFShadowMap,
    PerspectiveCamera,
    PlaneGeometry,
    Quaternion,
    RenderPipeline,
    Scene,
    ShadowNodeMaterial,
    TorusKnotGeometry,
    Triangle,
    Vector2,
    Vector3,
    WebGPURenderer,
} from 'three/webgpu';
import { Fn, attribute, float, mix, mrt, output, pass, smoothstep, step, uint, uniform, uv, vec2, vec4 } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import Stats from 'three/examples/jsm/libs/stats.module.js';
import { Pane } from 'tweakpane';

import { getRenderLoopController } from '/extend/tools/Tool.js';

const modelLoader = new GLTFLoader().setPath('https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/models/gltf/');
const models = {
    Soldier: { file: 'Soldier.glb', clip: 'Walk', preserveFraming: true },
    'Torus Knot': {},
};
const renderLoop = getRenderLoopController();
const DEFAULT_FRAME_RATE = 30;
const MAX_DISSOLVE_PARTICLES = 1800;
const params = {
    model: 'Soldier',
    frameRate: DEFAULT_FRAME_RATE,
    edgeColor: '#fa9200',
    edgeWidth: 0.1,
    dissolveSpeed: 0.01,
};
const hotEdgeSettings = {
    rimColor: '#ffefd1',
    rimWidthScale: 1,
    rimIntensity: 4.5,
    bloomStrength: 0.8,
    bloomRadius: 0.6,
    bloomThreshold: 0.35,
};
const particleSettings = {
    count: 1100,
    intensity: 1,
    spread: 1,
    gatherTime: 0.55,
};
const progress = uniform(0);
const edgeWidth = uniform(params.edgeWidth);
const edgeColor = uniform(new Color(params.edgeColor));

const modelStatus = document.querySelector('#output');
const progressPanel = document.querySelector('#dissolve-controls');
const progressSlider = document.querySelector('#dissolve-progress');
const progressValue = document.querySelector('#dissolve-progress-value');
const sampleStatus = document.querySelector('#dissolve-sample');
const sampleNoise = 0.60;

let camera, scene, renderer, model, mixer, stats, particles, renderPipeline;
let hasMixerAnimation = false;
let dissolveStep = 0;
let dissolveTime = 0;
let gatherLead = 0;

async function init() {
    renderer = new WebGPURenderer({ antialias: false });
    await renderer.init();
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(0x111111, 1);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFShadowMap;
    document.body.appendChild(renderer.domElement);

    scene = new Scene();
    scene.add(new AmbientLight(0xf0f0f0, 3));

    camera = new PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 1000);
    // Preserve the Soldier demo's original framing independently of the skinned mesh bounds.
    camera.position.set(-2.344, 2.569, -2.521);
    scene.add(camera);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0.002, 0.730, -0.142);
    controls.update();
    controls.addEventListener('change', () => renderLoop.requestRender());

    const noise = dissolveNoiseNode(uv());
    const visible = progress.greaterThan(0).and(noise.sub(edgeWidth).lessThanEqual(progress));
    const litSurface = step(noise, progress);
    const rimColor = uniform(new Color(hotEdgeSettings.rimColor));
    const rimWidthScale = uniform(hotEdgeSettings.rimWidthScale);
    const rimIntensity = uniform(hotEdgeSettings.rimIntensity);
    const distanceFromCut = progress.add(edgeWidth).sub(noise);
    const fire = edgeColor.mul(mix(1, 0.15, smoothstep(0, edgeWidth, distanceFromCut)));
    const rimWidth = edgeWidth.mul(0.24).min(0.03).mul(rimWidthScale);
    const rim = smoothstep(0, rimWidth, distanceFromCut).oneMinus().mul(litSurface.oneMinus());
    const rimEmission = mix(edgeColor, rimColor, rim).mul(rim).mul(rimIntensity);
    const dissolveOutput = vec4(mix(fire, output.rgb, litSurface).add(rimEmission), output.a);
    const bloomOutput = mrt({ edgeGlow: vec4(rimEmission, 1) });

    const materialNodes = { maskNode: visible, outputNode: dissolveOutput, mrtNode: bloomOutput };
    particles = new DissolveParticles(scene, particleSettings);

    const plane = new Mesh(
        new PlaneGeometry(),
        // Match the old floor shadow when compositing in linear color space.
        new ShadowNodeMaterial({ color: 0xffffff, opacity: 0.07, transparent: true }),
    );
    plane.rotation.x = -Math.PI / 2;
    plane.receiveShadow = true;
    plane.scale.setScalar(50);
    scene.add(plane);

    const light = new DirectionalLight(0xffffff, 5);
    light.position.copy(camera.position);
    light.castShadow = true;
    light.shadow.mapSize.setScalar(1024);
    light.shadow.bias = 1e-5;
    const shadowCamera = light.shadow.camera;
    shadowCamera.near = 0.01;
    shadowCamera.far = 2000;
    shadowCamera.left = shadowCamera.bottom = -10;
    shadowCamera.right = shadowCamera.top = 10;
    scene.add(light);

    const scenePass = pass(scene, camera);
    const targets = mrt({ output, edgeGlow: vec4(0) });
    // Transparent particles and the shadow receiver preserve the rim emission behind them.
    targets.setBlendMode('edgeGlow', new BlendMode(NormalBlending));
    targets.setClearColor('edgeGlow', 0x000000, 0);
    scenePass.setMRT(targets);

    const glow = bloom(
        scenePass.getTextureNode('edgeGlow'),
        hotEdgeSettings.bloomStrength,
        hotEdgeSettings.bloomRadius,
        hotEdgeSettings.bloomThreshold,
    );
    renderPipeline = new RenderPipeline(renderer, scenePass.getTextureNode('output').add(vec4(glow.rgb, 0)));

    stats = new Stats();
    document.body.appendChild(stats.dom);
    renderLoop.configure({ fps: params.frameRate, render: renderFrame });
    await switchModel(params.model, materialNodes, false);

    progressPanel.style.setProperty('--sample-position', sampleNoise * 100 + '%');
    updateProgressMonitor();
    progressPanel.hidden = false;
    progressSlider.addEventListener('input', () => {
        dissolveStep = 0;
        particles.clear();
        setProgress(progressSlider.valueAsNumber);
        renderLoop.setContinuous(hasMixerAnimation);
    });

    const actionsPane = new Pane({ container: document.querySelector('#dissolve-actions') });
    actionsPane.addButton({ title: 'appear' }).on('click', () => startDissolve(0, params.dissolveSpeed));
    actionsPane.addButton({ title: 'disappear' }).on('click', () => startDissolve(1, -params.dissolveSpeed));
    const modelOptions = Object.keys(models).map((name) => ({ text: name, value: name }));
    const modelPicker = actionsPane.addBinding(params, 'model', { label: 'Model', options: modelOptions });
    modelPicker.on('change', async ({ value }) => {
        modelPicker.disabled = true;
        try {
            await switchModel(value, materialNodes);
        } catch (error) {
            modelStatus.textContent = `Could not switch to ${value}.`;
            console.error(error);
        } finally {
            modelPicker.disabled = false;
        }
    });

    const pane = new Pane({ container: document.querySelector('#dissolve-settings') });
    pane.addBinding(params, 'frameRate', { min: 5, max: 120, step: 1 }).on('change', ({ value }) => {
        renderLoop.setFPS(value);
        renderLoop.requestRender();
    });
    pane.addBinding(params, 'edgeColor', { view: 'color' }).on('change', ({ value }) => {
        edgeColor.value.set(value);
        progressPanel.style.setProperty('--fire-color', value);
        renderLoop.requestRender();
    });
    pane.addBinding(params, 'edgeWidth', { min: 0.01, max: 1, step: 0.01 }).on('change', ({ value }) => {
        edgeWidth.value = value;
        updateProgressMonitor();
        renderLoop.requestRender();
    });
    pane.addBinding(params, 'dissolveSpeed', { min: 0.01, max: 0.1, step: 0.01 });

    const hotEdgePane = pane.addFolder({ title: 'Hot Edge & Bloom' });
    hotEdgePane.addBinding(hotEdgeSettings, 'rimColor', { label: 'Rim color', view: 'color' });
    hotEdgePane.addBinding(hotEdgeSettings, 'rimWidthScale', { label: 'Rim width scale', min: 0.1, max: 4, step: 0.05 });
    hotEdgePane.addBinding(hotEdgeSettings, 'rimIntensity', { label: 'Rim intensity', min: 0, max: 12, step: 0.1 });
    hotEdgePane.addBinding(hotEdgeSettings, 'bloomStrength', { label: 'Bloom strength', min: 0, max: 3, step: 0.05 });
    hotEdgePane.addBinding(hotEdgeSettings, 'bloomRadius', { label: 'Bloom radius', min: 0, max: 1, step: 0.05 });
    hotEdgePane.addBinding(hotEdgeSettings, 'bloomThreshold', { label: 'Bloom threshold', min: 0, max: 5, step: 0.05 });
    hotEdgePane.on('change', () => {
        rimColor.value.set(hotEdgeSettings.rimColor);
        rimWidthScale.value = hotEdgeSettings.rimWidthScale;
        rimIntensity.value = hotEdgeSettings.rimIntensity;
        glow.strength.value = hotEdgeSettings.bloomStrength;
        glow.radius.value = hotEdgeSettings.bloomRadius;
        glow.threshold.value = hotEdgeSettings.bloomThreshold;
        renderLoop.requestRender();
    });

    const particlePane = pane.addFolder({ title: 'Particles' });
    particlePane.addBinding(particleSettings, 'count', { label: 'Count', min: 0, max: MAX_DISSOLVE_PARTICLES, step: 50 });
    particlePane.addBinding(particleSettings, 'intensity', { label: 'Intensity', min: 0, max: 2, step: 0.05 });
    particlePane.addBinding(particleSettings, 'spread', { label: 'Spread', min: 0.25, max: 2, step: 0.05 });
    particlePane.addBinding(particleSettings, 'gatherTime', { label: 'Gather time (s)', min: 0.2, max: 1.2, step: 0.05 });

    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderLoop.requestRender();
    });

    renderLoop.requestRender();
}

async function switchModel(name, materialNodes, reveal = true) {
    const { file, clip, preserveFraming } = models[name];
    let gltf;
    if (file) {
        modelStatus.textContent = `Loading ${name}…`;
        try {
            gltf = await modelLoader.loadAsync(file);
        } catch (error) {
            console.warn(`Could not load ${name}.`, error);
        }
    }

    const fallback = file && !gltf;
    const nextModel = gltf?.scene ?? new Mesh(
        new TorusKnotGeometry(0.6, 0.19, 128, 24),
        new MeshStandardMaterial({ color: 0x648cb3, metalness: 0.3, roughness: 0.42 }),
    );
    if (!preserveFraming || fallback) {
        fitModel(nextModel);
    }

    nextModel.frustumCulled = false;
    nextModel.traverse((object) => {
        if (!object.isMesh) {
            return;
        }

        ensureDissolveUVs(object.geometry);
        object.castShadow = true;
        object.receiveShadow = true;
        object.frustumCulled = false;

        const convert = (material) => Object.assign(renderer.library.fromMaterial(material), materialNodes);
        object.material = Array.isArray(object.material) ? object.material.map(convert) : convert(object.material);
    });

    particles.setModel(nextModel);
    if (model) {
        mixer?.stopAllAction();
        mixer?.uncacheRoot(model);
        disposeModel(model);
    }
    model = nextModel;
    scene.add(model);

    const animation = gltf && (AnimationClip.findByName(gltf.animations, clip) ?? gltf.animations[0]);
    mixer = animation ? new AnimationMixer(model) : null;
    mixer?.clipAction(animation).play();
    hasMixerAnimation = mixer !== null;
    dissolveStep = 0;
    setProgress(reveal || fallback ? 1 : 0);
    renderLoop.setContinuous(hasMixerAnimation);
    renderLoop.requestRender();
    modelStatus.textContent = fallback
        ? `${name} could not load. Showing Torus Knot.`
        : name;
}

function fitModel(root) {
    const bounds = new Box3().setFromObject(root, true);
    const size = bounds.getSize(new Vector3());
    const center = bounds.getCenter(new Vector3());
    const scale = 1.8 / Math.max(size.x, size.y, size.z);
    root.scale.multiplyScalar(scale);
    root.position.multiplyScalar(scale).sub(center.multiplyScalar(scale));
    root.position.y += size.y * scale / 2;
}

function ensureDissolveUVs(geometry) {
    if (geometry.hasAttribute('uv')) {
        return;
    }

    geometry.computeBoundingBox();
    const bounds = geometry.boundingBox;
    const size = bounds.getSize(new Vector3());
    // Project onto the two widest axes to give untextured meshes a dissolve field.
    const [u, v] = [0, 1, 2].sort((a, b) => size.getComponent(b) - size.getComponent(a));
    const position = geometry.getAttribute('position');
    const coordinates = new Float32Array(position.count * 2);
    const point = new Vector3();
    const width = size.getComponent(u) || 1;
    const height = size.getComponent(v) || 1;
    for (let i = 0; i < position.count; i++) {
        point.fromBufferAttribute(position, i).sub(bounds.min);
        coordinates[i * 2] = point.getComponent(u) / width;
        coordinates[i * 2 + 1] = point.getComponent(v) / height;
    }
    geometry.setAttribute('uv', new Float32BufferAttribute(coordinates, 2));
}

function disposeModel(root) {
    root.removeFromParent();
    const resources = new Set();
    root.traverse((object) => {
        if (!object.isMesh) {
            return;
        }
        resources.add(object.geometry);
        if (object.isSkinnedMesh) {
            resources.add(object.skeleton);
        }
        for (const material of [object.material].flat()) {
            resources.add(material);
            for (const value of Object.values(material)) {
                if (value?.isTexture) {
                    resources.add(value);
                }
            }
        }
    });
    resources.forEach((resource) => resource.dispose());
}

function renderFrame(deltaSeconds) {
    stats.update();
    const frameDelta = Math.min(deltaSeconds, 1 / params.frameRate);
    // Advance one animation step per rendered frame, like the dissolve transition.
    mixer?.update(1 / DEFAULT_FRAME_RATE);

    const wasActive = dissolveStep !== 0 || particles.active;
    if (dissolveStep !== 0) {
        const previousTime = dissolveTime;
        dissolveTime = MathUtils.clamp(dissolveTime + dissolveStep, -gatherLead, 1);
        if (dissolveStep < 0) {
            dissolveTime = Math.max(0, dissolveTime);
            particles.emit(previousTime, dissolveTime, edgeWidth.value);
        } else if (gatherLead > 0) {
            particles.gather(dissolveTime, gatherLead, edgeWidth.value);
        }

        const nextProgress = Math.max(0, dissolveTime);
        if (nextProgress !== progress.value) {
            setProgress(nextProgress);
        }
        if (dissolveStep < 0 ? dissolveTime === 0 : dissolveTime === 1) {
            dissolveStep = 0;
        }
    }

    particles.update(frameDelta, camera);
    if (wasActive && dissolveStep === 0 && !particles.active) {
        renderLoop.setContinuous(hasMixerAnimation);
    }

    renderPipeline.render();
}

function startDissolve(start, stepSize) {
    if (dissolveStep !== 0) {
        return;
    }

    particles.clear();
    setProgress(start);
    dissolveStep = stepSize;
    gatherLead = stepSize > 0 && particleSettings.count > 0 && particleSettings.intensity > 0
        ? stepSize * params.frameRate * particleSettings.gatherTime
        : 0;
    dissolveTime = start - gatherLead;
    if (gatherLead > 0) {
        particles.gather(dissolveTime, gatherLead, edgeWidth.value);
    }
    renderLoop.setContinuous(true);
}

function setProgress(value) {
    progress.value = value;
    updateProgressMonitor();
}

function updateProgressMonitor() {
    const value = progress.value;
    const fireEnd = value > 0 ? Math.min(value + edgeWidth.value, 1) : 0;
    const displayedValue = value.toFixed(2);
    progressSlider.value = displayedValue;
    progressValue.textContent = displayedValue;
    progressPanel.style.setProperty('--material-end', value * 100 + '%');
    progressPanel.style.setProperty('--fire-end', fireEnd * 100 + '%');

    let sampleState = 'Transparent';
    if (sampleNoise <= value) {
        sampleState = 'Material';
    } else if (sampleNoise <= fireEnd) {
        sampleState = 'Fire edge';
    }

    const status = `Noise ${sampleNoise.toFixed(2)} · ${sampleState}`;
    if (sampleStatus.textContent !== status) {
        sampleStatus.textContent = status;
    }
}

const LAYERS = [
    { frequency: 8, weight: 0.65 },
    { frequency: 19, weight: 0.25 },
    { frequency: 43, weight: 0.1 },
];
const HASH_X = 1597334677;
const HASH_Y = 3812015801;
const HASH_MULTIPLIER = 0x45d9f3b;
const HASH_RANGE = 0x1000000;

// Match the shader's unsigned hash so particle timing uses the same UV field.
function hashCell(x, y) {
    const seed = Math.imul(x, HASH_X) ^ Math.imul(y, HASH_Y);
    const hash = Math.imul(seed ^ (seed >>> 16), HASH_MULTIPLIER);
    return (hash >>> 8) / HASH_RANGE;
}

const hashCellNode = Fn(([cell]) => {
    const coord = cell.toUVec2();
    const seed = coord.x.mul(uint(HASH_X)).bitXor(coord.y.mul(uint(HASH_Y))).toVar();
    const hash = seed.bitXor(seed.shiftRight(uint(16))).mul(uint(HASH_MULTIPLIER));
    return hash.shiftRight(uint(8)).toFloat().div(HASH_RANGE);
});

function valueNoise(x, y) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const tx = MathUtils.smoothstep(x - ix, 0, 1);
    const ty = MathUtils.smoothstep(y - iy, 0, 1);
    const bottom = MathUtils.lerp(hashCell(ix, iy), hashCell(ix + 1, iy), tx);
    const top = MathUtils.lerp(hashCell(ix, iy + 1), hashCell(ix + 1, iy + 1), tx);
    return MathUtils.lerp(bottom, top, ty);
}

const valueNoiseNode = Fn(([position]) => {
    const cell = position.floor().toVar();
    const blend = position.fract().smoothstep(0, 1).toVar();
    const bottom = mix(hashCellNode(cell), hashCellNode(cell.add(vec2(1, 0))), blend.x);
    const top = mix(hashCellNode(cell.add(vec2(0, 1))), hashCellNode(cell.add(vec2(1, 1))), blend.x);
    return mix(bottom, top, blend.y);
});

function sampleDissolveNoise(uv) {
    const x = MathUtils.clamp(uv.x, 0, 1);
    const y = MathUtils.clamp(uv.y, 0, 1);
    return LAYERS.reduce((sum, { frequency, weight }) => sum + weight * valueNoise(x * frequency, y * frequency), 0);
}

const dissolveNoiseNode = Fn(([uv]) => {
    const coord = uv.saturate().toVar();
    return LAYERS.reduce(
        (sum, { frequency, weight }) => sum.add(valueNoiseNode(coord.mul(frequency)).mul(weight)),
        float(0),
    );
});

function sampleSurface(model) {
    const triangles = [];
    const face = new Triangle();
    let totalArea = 0;

    model.updateMatrixWorld(true);
    model.traverse((mesh) => {
        if (!mesh.isMesh) {
            return;
        }

        const indices = mesh.geometry.index;
        const position = mesh.geometry.getAttribute('position');
        const uv = mesh.geometry.getAttribute('uv');
        const count = indices ? indices.count : position.count;
        for (let i = 0; i < count; i += 3) {
            const a = indices ? indices.getX(i) : i;
            const b = indices ? indices.getX(i + 1) : i + 1;
            const c = indices ? indices.getX(i + 2) : i + 2;
            face.a.fromBufferAttribute(position, a).applyMatrix4(mesh.matrixWorld);
            face.b.fromBufferAttribute(position, b).applyMatrix4(mesh.matrixWorld);
            face.c.fromBufferAttribute(position, c).applyMatrix4(mesh.matrixWorld);
            const area = face.getArea();
            if (area > 0) {
                totalArea += area;
                triangles.push({ mesh, a, b, c, uv, end: totalArea });
            }
        }
    });

    const texcoord = new Vector2();
    let triangleIndex = 0;
    const samples = Array.from({ length: MAX_DISSOLVE_PARTICLES }, (_, i) => {
        const sampleArea = (i + Math.random()) * totalArea / MAX_DISSOLVE_PARTICLES;
        while (triangles[triangleIndex].end <= sampleArea) {
            triangleIndex++;
        }
        const { mesh, a, b, c, uv } = triangles[triangleIndex];
        const radius = Math.sqrt(Math.random());
        const weightA = 1 - radius;
        const weightB = radius * Math.random();
        const weightC = radius - weightB;
        texcoord.set(
            uv.getX(a) * weightA + uv.getX(b) * weightB + uv.getX(c) * weightC,
            uv.getY(a) * weightA + uv.getY(b) * weightB + uv.getY(c) * weightC,
        );
        return { mesh, a, b, c, weightA, weightB, weightC, noise: sampleDissolveNoise(texcoord) };
    });

    // Smaller budgets should still cover the entire character.
    for (let i = samples.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [samples[i], samples[j]] = [samples[j], samples[i]];
    }
    return samples;
}

class ParticleCloud {
    constructor(scene, capacity, sparks) {
        this.capacity = capacity;
        this.sparks = sparks;
        this.particles = [];
        this.quad = new Object3D();
        this.cameraInverse = new Quaternion();
        this.screenVelocity = new Vector3();
        this.tint = new Color();

        const geometry = new PlaneGeometry();
        this.opacity = new InstancedBufferAttribute(new Float32Array(capacity), 1).setUsage(DynamicDrawUsage);
        geometry.setAttribute('particleOpacity', this.opacity);

        const material = new MeshBasicNodeMaterial({
            transparent: true,
            depthWrite: false,
            blending: sparks ? AdditiveBlending : NormalBlending,
        });
        const radius = uv().sub(0.5).length();
        const profile = smoothstep(sparks ? 0.03 : 0.22, 0.5, radius).oneMinus();
        material.opacityNode = attribute('particleOpacity', 'float').mul(profile);

        this.mesh = new InstancedMesh(geometry, material, capacity);
        this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
        this.mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3)
            .setUsage(DynamicDrawUsage);
        this.mesh.count = 0;
        this.mesh.frustumCulled = false;
        scene.add(this.mesh);
    }

    emit(position, normal, spread) {
        const { randFloat } = MathUtils;
        const velocity = new Vector3(randFloat(-0.28, 0.40), randFloat(0.05, 0.45), randFloat(-0.25, 0.25));
        velocity.addScaledVector(normal, this.sparks ? randFloat(0.45, 1.6) : randFloat(0.12, 0.5));
        this.spawn(position.clone(), velocity.multiplyScalar(spread));
    }

    gather(sample, startProgress, spread) {
        const { randFloat, randFloatSpread } = MathUtils;
        const direction = new Vector3(randFloatSpread(2), randFloatSpread(2), randFloatSpread(2)).normalize();
        const sweep = new Vector3(-direction.z, 0, direction.x);
        const offset = direction.multiplyScalar(randFloat(0.55, 1.55) * spread);
        this.spawn(new Vector3(), new Vector3(), { sample, startProgress, offset, sweep });
    }

    spawn(position, velocity, gathering = null) {
        if (this.particles.length >= this.capacity) {
            return;
        }
        const { randFloat } = MathUtils;
        const color = this.sparks
            ? new Color().setRGB(2.3, randFloat(0.45, 1.45), randFloat(0.03, 0.19))
            : new Color().setRGB(0.24, 0.20, 0.16).multiplyScalar(randFloat(0.46, 1.5));

        this.particles.push({
            age: 0,
            life: this.sparks ? randFloat(0.22, 0.85) : randFloat(0.55, 1.7),
            position,
            velocity,
            gathering,
            size: this.sparks ? randFloat(0.019, 0.040) : randFloat(0.015, 0.046),
            spin: randFloat(-4, 4),
            rotation: randFloat(0, Math.PI * 2),
            color,
        });
    }

    update(delta, camera, intensity, converge) {
        if (this.particles.length === 0) {
            return;
        }

        this.cameraInverse.copy(camera.quaternion).invert();
        const drag = Math.exp(-(this.sparks ? 0.8 : 1.7) * delta);
        const sizeScale = Math.sqrt(Math.max(intensity, 0.1));
        let count = 0;
        for (const particle of this.particles) {
            particle.age += delta;
            const age = particle.gathering ? converge(particle) : particle.age / particle.life;
            if (age >= 1) {
                continue;
            }

            if (!particle.gathering) {
                particle.velocity.multiplyScalar(drag);
                particle.velocity.y += (this.sparks ? -1.9 : -0.14) * delta;
                particle.position.addScaledVector(particle.velocity, delta);
            }

            this.quad.position.copy(particle.position);
            this.quad.quaternion.copy(camera.quaternion);
            const size = particle.size * (1 - 0.45 * age) * sizeScale;
            if (this.sparks) {
                this.screenVelocity.copy(particle.velocity).applyQuaternion(this.cameraInverse);
                this.quad.rotateZ(Math.atan2(this.screenVelocity.y, this.screenVelocity.x));
                this.quad.scale.set(size * (1 + Math.min(this.screenVelocity.length() * 2, 4)), size, 1);
            } else {
                this.quad.rotateZ(particle.rotation + particle.age * particle.spin);
                this.quad.scale.set(size, size * 0.65, 1);
            }
            this.quad.updateMatrix();

            this.mesh.setMatrixAt(count, this.quad.matrix);
            this.tint.copy(particle.color).multiplyScalar(this.sparks ? intensity : 1);
            this.mesh.setColorAt(count, this.tint);
            const fade = particle.gathering ? Math.min(1, age * 6, (1 - age) * 4) : Math.min(1, (1 - age) * 2);
            this.opacity.setX(count, fade * Math.min(1, intensity) * (this.sparks ? 1 : 0.8));
            this.particles[count++] = particle;
        }

        this.particles.length = count;
        this.mesh.count = count;
        if (count > 0) {
            this.mesh.instanceMatrix.needsUpdate = true;
            this.mesh.instanceColor.needsUpdate = true;
            this.opacity.needsUpdate = true;
        }
    }

    clear() {
        this.particles.length = 0;
        this.mesh.count = 0;
    }
}

class DissolveParticles {
    constructor(scene, settings) {
        this.settings = settings;
        this.sparks = new ParticleCloud(scene, MAX_DISSOLVE_PARTICLES, true);
        this.ash = new ParticleCloud(scene, MAX_DISSOLVE_PARTICLES, false);
        this.face = new Triangle();
        this.position = new Vector3();
        this.normal = new Vector3();
        this.gathered = new Set();
        this.gathering = false;
        this.gatherProgress = 0;
        this.gatherEdgeWidth = 0;
        this.converge = this.converge.bind(this);
    }

    setModel(model) {
        const samples = sampleSurface(model);
        this.clear();
        this.model = model;
        this.samples = samples;
    }

    get active() {
        return this.sparks.particles.length > 0 || this.ash.particles.length > 0;
    }

    emit(previousProgress, nextProgress, edgeWidth) {
        const { count, intensity, spread } = this.settings;
        if (count === 0 || intensity === 0) {
            return;
        }

        const previousLimit = previousProgress + edgeWidth;
        const nextLimit = nextProgress > 0 ? nextProgress + edgeWidth : -1;
        this.model.updateMatrixWorld(true);
        for (let i = 0; i < count; i++) {
            const sample = this.samples[i];
            if (sample.noise > previousLimit || sample.noise <= nextLimit) {
                continue;
            }

            this.updateSurfacePoint(sample);
            (Math.random() < 0.36 ? this.sparks : this.ash).emit(this.position, this.normal, spread);
        }
    }

    gather(progress, lead, edgeWidth) {
        this.gatherProgress = progress;
        this.gatherEdgeWidth = edgeWidth;
        this.gathering = progress < 1;

        const { count, intensity, spread } = this.settings;
        if (intensity === 0) {
            return;
        }

        for (let i = 0; i < count; i++) {
            const sample = this.samples[i];
            const reveal = Math.max(0, sample.noise - edgeWidth);
            if (this.gathered.has(sample) || reveal <= progress || reveal > progress + lead) {
                continue;
            }

            // Start each particle shortly before its destination becomes visible.
            this.gathered.add(sample);
            (Math.random() < 0.36 ? this.sparks : this.ash).gather(sample, progress, spread);
        }
    }

    converge(particle) {
        const { sample, startProgress, offset, sweep } = particle.gathering;
        const reveal = Math.max(0, sample.noise - this.gatherEdgeWidth);
        if (this.gatherProgress >= reveal) {
            return 1;
        }

        const age = (this.gatherProgress - startProgress) / (reveal - startProgress);
        this.updateSurfacePoint(sample);
        const angle = Math.PI * age;
        particle.position.copy(this.position)
            .addScaledVector(offset, 1 - age * age)
            .addScaledVector(sweep, Math.sin(angle) * 0.3);
        particle.velocity.copy(offset).multiplyScalar(-2 * age)
            .addScaledVector(sweep, Math.cos(angle) * 0.3 * Math.PI);
        return age;
    }

    updateSurfacePoint({ mesh, a, b, c, weightA, weightB, weightC }) {
        mesh.getVertexPosition(a, this.face.a).applyMatrix4(mesh.matrixWorld);
        mesh.getVertexPosition(b, this.face.b).applyMatrix4(mesh.matrixWorld);
        mesh.getVertexPosition(c, this.face.c).applyMatrix4(mesh.matrixWorld);
        this.face.getNormal(this.normal);
        this.position.copy(this.face.a).multiplyScalar(weightA)
            .addScaledVector(this.face.b, weightB)
            .addScaledVector(this.face.c, weightC)
            .addScaledVector(this.normal, 0.012);
    }

    update(delta, camera) {
        if (this.gathering && this.active) {
            this.model.updateMatrixWorld(true);
        }

        const intensity = this.settings.count > 0 ? this.settings.intensity : 0;
        this.sparks.update(delta, camera, intensity, this.converge);
        this.ash.update(delta, camera, intensity, this.converge);
    }

    clear() {
        this.sparks.clear();
        this.ash.clear();
        this.gathered.clear();
        this.gathering = false;
    }
}

init().catch((error) => {
    modelStatus.textContent = 'Could not start the Dissolve demo.';
    console.error(error);
});
