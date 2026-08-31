import {
    ACESFilmicToneMapping,
    AmbientLight,
    Color,
    DirectionalLight,
    GridHelper,
    HemisphereLight,
    Mesh,
    MeshBasicMaterial,
    MeshStandardMaterial,
    Object3D,
    PCFSoftShadowMap,
    PerspectiveCamera,
    PlaneGeometry,
    Quaternion,
    Scene,
    SphereGeometry,
    SRGBColorSpace,
    Vector3,
    WebGLRenderer
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { Pane } from 'tweakpane';
import { getAssetURL, getRenderLoopController } from '../extend/tools/Tool.js';
import { Chain } from '../extend/kinematic/Chain.js';
import {
    createDhParametersFromJointState,
    createInitialJointState,
    kukaKr5ChainProfile,
    ur3eChainProfile,
} from '../extend/kinematic/ChainController.js';
import ChainSolver from '../extend/kinematic/ChainSolver.js';
import { createKukaKr5Rig } from '../extend/kinematic/KukaKr5Rig.js';
import { createUr3eRig } from '../extend/kinematic/Ur3eRobotiqRig.js';

let scene, camera, renderer, controls, pane;
let chain;
let actuator;
let chainSolver;
let profileInfoBlock;
let solveStatsBlock;
let showModelBinding;
let qCurrent = [];
let isSolving = false;
let isSyncingTarget = false;
let isDraggingTarget = false;
let pendingSolve = false;
const pendingTarget = new Vector3();
const pendingTargetQuat = new Quaternion();
let solveActive = false;
let targetTolerance = 1e-2;
let solveStartedAt = 0;
let accumulatedSolveMs = 0;
let accumulatedIterations = 0;
let solveCallCount = 0;

const BG_COLOR = 0x242a2e;
const FRAME_RATE = 60;
const DEFAULT_EXPOSURE = 1.2;
const KUKA_MODEL_URL = `${getAssetURL()}models/kuka-kr5/visual/`;
const UR3E_MODEL_URL = `${getAssetURL()}models/ur3e/visual/`;
const renderLoop = getRenderLoopController();
const modelRigEntries = new Map();

const styleParams = {
    jointColor: 0x7d7d7d,
    linkColor: 0x000000,
    randomJointColor: true,
    randomLinkColor: false,
    jointRadius: 0.035,
    jointHeight: 0.12,
    linkRadius: 0.01,
    trimLinksAtJoints: true,
    linkJointOverlap: 0.01,
    showAxisHelper: false,
    showDOFHelper: false,
    dofColor: 0xffa500,
    dofOpacity: 0.25,
    dofUseJointColor: true,
    dofUseAutoRadius: false,
    dofRadius: 0.1,
    dofRadiusScale: 0.5,
    dofThicknessRatio: 0.3,
    dofSegments: 64,
    dofOffsetZ: 1e-4,
    axisHelperSize: 0.1,
    syncUp: true,
    litMaterials: true,
    roughness: 0.42,
    metalness: 0.24,
    castShadow: true,
    receiveShadow: true
};

const baseParams = {
    mdhMode: false,
    baseOffset: { x: 0, y: 0, z: 0 }
};

const solverParams = {
    solverMethod: 'DLS',
    maxIter: 20,
    alpha: 0.05,
    tolerance: targetTolerance,
    damping: 0.04,
    dlsMaxDelta: 0.08,
    rotationWeight: 0.25,
    rotationTolerance: 0.03,
    solveMode: 'Position Only',
    solveImmediately: false,
    debug: false
};

const solveStats = {
    status: 'Idle',
    solveTime: '--',
    wallTime: '--',
    iterations: '0',
    calls: '0',
    error: '--'
};

const viewParams = {
    showModel: true
};

const modelParams = {
    preset: 'kuka-kr5'
};

const sharedIkVisualStyle = {
    jointColor: 0x7d7d7d,
    linkColor: 0x171a1c,
    randomJointColor: true,
    jointRadius: 0.025,
    jointHeight: 0.12,
    linkRadius: 0.01
};

const ur3eVisualStyle = {
    ...sharedIkVisualStyle,
    jointRadius: sharedIkVisualStyle.jointRadius * 0.65,
    jointHeight: sharedIkVisualStyle.jointHeight * 0.65
};

const modelPresets = {
    'kuka-kr5': {
        profile: kukaKr5ChainProfile,
        style: sharedIkVisualStyle,
        cameraPosition: [1.5, 1.3, 1.5],
        cameraTarget: [0.25, 0.5, -0.25]
    },
    'universal-robots-ur3e': {
        profile: ur3eChainProfile,
        style: ur3eVisualStyle,
        cameraPosition: [0.66, 0.55, 0.66],
        cameraTarget: [0.08, 0.24, -0.08]
    }
};

let activeProfile = modelPresets[modelParams.preset].profile;

init();

function init() {
    scene = new Scene();
    scene.background = new Color(BG_COLOR);

    camera = new PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(2, 2, 2);

    renderer = new WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(BG_COLOR, 1);
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = DEFAULT_EXPOSURE;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFSoftShadowMap;
    document.body.appendChild(renderer.domElement);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0, 0.5);
    controls.update();
    controls.addEventListener('change', () => {
        renderLoop.requestRender();
    });

    addEnvironment();

    chain = new Chain(scene);
    actuator = createActuator(scene, camera, renderer.domElement);
    chainSolver = new ChainSolver({
        targetPosition: new Vector3(),
        targetQuaternion: new Quaternion(),
        chain,
        maxIter: solverParams.maxIter,
        alpha: solverParams.alpha,
        tolerance: solverParams.tolerance,
        solveMode: solverParams.solveMode,
        solverMethod: solverParams.solverMethod,
        damping: solverParams.damping,
        dlsMaxDelta: solverParams.dlsMaxDelta,
        rotationWeight: solverParams.rotationWeight,
        rotationTolerance: solverParams.rotationTolerance,
        debug: solverParams.debug,
        forwardKinematics: (q) => {
            chain.updateJoint(q);
        }
    });
    actuator.controls.addEventListener('dragging-changed', (event) => {
        controls.enabled = !event.value;
        isDraggingTarget = event.value;
        if (!isDraggingTarget) {
            // Default behavior: solve once after drag end (mouse up).
            queueSolveFromTarget();
        }
        renderLoop.requestRender();
    });
    actuator.controls.addEventListener('change', () => {
        if (isDraggingTarget && solverParams.solveImmediately) {
            queueSolveFromTarget();
        }
        renderLoop.requestRender();
    });

    renderLoop.configure({
        fps: FRAME_RATE,
        render: renderFrame
    });
    renderLoop.setContinuous(false);
    renderLoop.setRenderOnIdle(false);

    pane = new Pane({
        title: 'IK',
        container: document.getElementById('control-panel')
    });

    const modelFolder = pane.addFolder({ title: 'Robot Model' });
    modelFolder.addBinding(modelParams, 'preset', {
        label: 'Preset',
        options: {
            'KUKA KR5': 'kuka-kr5',
            'UR3e (Official DH)': 'universal-robots-ur3e'
        }
    }).on('change', (ev) => {
        selectModelPreset(ev.value);
    });
    profileInfoBlock = addProfileInfoBlock(modelFolder);
    modelFolder.expanded = true;

    const vizFolder = pane.addFolder({ title: 'Visualization' });
    showModelBinding = vizFolder.addBinding(viewParams, 'showModel', {
        label: 'Show Model'
    }).on('change', (ev) => {
        viewParams.showModel = ev.value;
        updateModelPresentation();
    });
    vizFolder.addBinding(styleParams, 'syncUp', { label: 'Sync Up' }).on('change', (ev) => {
        if (ev.last === false) { return; }
        updateArm();
    });
    const helpersFolder = vizFolder.addFolder({ title: 'Helpers' });
    helpersFolder.addBinding(styleParams, 'showAxisHelper', { label: 'Axis Helper' }).on('change', (ev) => {
        if (ev.last === false) { return; }
        updateArm();
    });
    helpersFolder.addBinding(styleParams, 'showDOFHelper', { label: 'DOF Helper' }).on('change', (ev) => {
        if (ev.last === false) { return; }
        updateArm();
    });
    helpersFolder.expanded = true;
    vizFolder.expanded = true;

    const controlsFolder = pane.addFolder({ title: 'Control' });
    controlsFolder.addButton({ title: 'Reset' }).on('click', () => {
        resetAll();
    });
    controlsFolder.addBinding(solverParams, 'debug', { label: 'Debug' }).on('change', (ev) => {
        if (chainSolver) { chainSolver.debug = ev.value; }
    });
    controlsFolder.addBinding(solverParams, 'solveImmediately', { label: 'Solve Immediately' });
    controlsFolder
        .addBinding(solverParams, 'solverMethod', {
            label: 'Algorithm',
            options: {
                'Basic IK': 'Jacobian',
                DLS: 'DLS'
            }
        })
        .on('change', (ev) => {
            if (chainSolver) { chainSolver.solverMethod = ev.value; }
            queueSolveFromTarget();
        });
    controlsFolder
        .addBinding(solverParams, 'maxIter', { label: 'Max Iter', min: 1, max: 200, step: 1 })
        .on('change', (ev) => {
            if (chainSolver) { chainSolver.maxIter = ev.value; }
        });
    controlsFolder
        .addBinding(solverParams, 'alpha', { label: 'Alpha', min: 0.001, max: 0.5, step: 0.001 })
        .on('change', (ev) => {
            if (chainSolver) { chainSolver.alpha = ev.value; }
        });
    controlsFolder
        .addBinding(solverParams, 'damping', { label: 'Damping', min: 1e-5, max: 1, step: 0.001 })
        .on('change', (ev) => {
            if (chainSolver) { chainSolver.damping = ev.value; }
        });
    controlsFolder
        .addBinding(solverParams, 'dlsMaxDelta', { label: 'DLS Max Delta', min: 0.001, max: 0.5, step: 0.001 })
        .on('change', (ev) => {
            if (chainSolver) { chainSolver.dlsMaxDelta = ev.value; }
        });
    controlsFolder
        .addBinding(solverParams, 'tolerance', { label: 'Tolerance', min: 1e-5, max: 1e-1, step: 1e-5 })
        .on('change', (ev) => {
            if (chainSolver) { chainSolver.tolerance = ev.value; }
            targetTolerance = ev.value;
        });
    const statsFolder = controlsFolder.addFolder({ title: 'Solve Statistics' });
    solveStatsBlock = addSolveStatsBlock(statsFolder);
    updateSolveStatsBlock();
    statsFolder.expanded = true;
    controlsFolder.expanded = true;

    applyPresetStyle();
    buildRobot();
    frameActiveProfile();
    updateProfileInfo();
    updateModelBinding();

    window.addEventListener('resize', onResize);
    renderLoop.requestRender();
}

function addEnvironment() {
    const floor = new Mesh(
        new PlaneGeometry(20, 20),
        new MeshStandardMaterial({
            color: 0x596064,
            roughness: 0.82,
            metalness: 0.05
        })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.012;
    floor.receiveShadow = true;
    scene.add(floor);

    const grid = new GridHelper(20, 20, 0x7b8589, 0x687175);
    grid.position.y = -0.005;
    grid.material.transparent = true;
    grid.material.opacity = 0.24;
    scene.add(grid);

    scene.add(new AmbientLight(0xffffff, 0.58));

    const hemisphere = new HemisphereLight(0xf5fbff, 0x32383b, 1.45);
    hemisphere.position.set(0, 8, 0);
    scene.add(hemisphere);

    const key = new DirectionalLight(0xffffff, 4.2);
    key.position.set(5, 8, 6);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -3;
    key.shadow.camera.right = 3;
    key.shadow.camera.top = 4;
    key.shadow.camera.bottom = -2;
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far = 24;
    scene.add(key);

    const fill = new DirectionalLight(0xb9dcff, 1.3);
    fill.position.set(-5, 4, 4);
    scene.add(fill);

    const rim = new DirectionalLight(0xc0ecff, 1.45);
    rim.position.set(-3, 5, -6);
    scene.add(rim);
}

function createModelRig(presetKey) {
    const preset = modelPresets[presetKey];
    if (!preset) { return null; }

    const rig = presetKey === 'kuka-kr5'
        ? createKukaKr5Rig({ parent: scene, assetUrl: KUKA_MODEL_URL })
        : createUr3eRig({ parent: scene, assetUrl: UR3E_MODEL_URL });
    rig.syncBase({
        syncUp: styleParams.syncUp,
        offset: baseParams.baseOffset
    });
    rig.setJointValues(qCurrent);
    rig.setVisible(false);

    const entry = { rig, ready: false, loadPromise: null };
    modelRigEntries.set(presetKey, entry);
    return entry;
}

function getModelRigEntry(presetKey = modelParams.preset) {
    return modelRigEntries.get(presetKey) || createModelRig(presetKey);
}

function ensureModelRig(presetKey = modelParams.preset) {
    const entry = getModelRigEntry(presetKey);
    if (!entry) { return Promise.reject(new Error(`Unknown robot preset: ${presetKey}`)); }
    if (entry.ready) { return Promise.resolve(entry.rig); }
    if (entry.loadPromise) { return entry.loadPromise; }

    entry.loadPromise = entry.rig.load()
        .then(() => {
            entry.ready = true;
            return entry.rig;
        })
        .catch((error) => {
            console.error(`Unable to load the ${presetKey} model.`, error);
            entry.rig.removeFromParent();
            modelRigEntries.delete(presetKey);
            throw error;
        });
    return entry.loadPromise;
}

function syncModelRigTransforms() {
    for (const [presetKey, entry] of modelRigEntries) {
        entry.rig.syncBase({
            syncUp: styleParams.syncUp,
            offset: baseParams.baseOffset
        });
        if (presetKey === modelParams.preset) {
            entry.rig.setJointValues(qCurrent);
        }
    }
}

function syncActiveModelPose() {
    modelRigEntries.get(modelParams.preset)?.rig.setJointValues(qCurrent);
}

function updateModelPresentation() {
    syncModelRigTransforms();
    const shouldShowModel = viewParams.showModel;
    const activeEntry = shouldShowModel ? getModelRigEntry() : null;
    const modelVisible = shouldShowModel && activeEntry?.ready;

    for (const [presetKey, entry] of modelRigEntries) {
        entry.rig.setVisible(
            modelVisible && presetKey === modelParams.preset
        );
    }
    if (chain?.roboticArm) {
        chain.roboticArm.visible = !modelVisible;
    }

    if (shouldShowModel && activeEntry && !activeEntry.ready) {
        ensureModelRig()
            .then(() => {
                updateModelPresentation();
                renderLoop.requestRender();
            })
            .catch(() => {
                viewParams.showModel = false;
                updateModelBinding();
                updateModelPresentation();
                renderLoop.requestRender();
            });
    }
    renderLoop.requestRender();
}

function createActuator(scene, camera, domElement) {
    const object = new Object3D();
    object.name = 'actuator';
    object.matrixAutoUpdate = true;
    scene.add(object);

    const sphere = new Mesh(
        new SphereGeometry(0.04, 16, 16),
        new MeshBasicMaterial({ color: 0xff4444 })
    );
    object.add(sphere);

    const controls = new TransformControls(camera, domElement);
    controls.setMode('translate');
    controls.setSpace('local');
    controls.attach(object);
    scene.add(controls);

    return {
        object,
        controls,
        getWorldPosition(out = new Vector3()) {
            if (object.parent) {
                object.parent.updateMatrixWorld(true);
            } else {
                object.updateMatrixWorld(true, false);
            }
            return object.getWorldPosition(out);
        },
        getWorldQuaternion(out = new Quaternion()) {
            if (object.parent) {
                object.parent.updateMatrixWorld(true);
            } else {
                object.updateMatrixWorld(true, false);
            }
            return object.getWorldQuaternion(out);
        },
        setLocalPosition(localPosition) {
            object.position.copy(localPosition);
        },
        setLocalQuaternion(localQuaternion) {
            object.quaternion.copy(localQuaternion);
        }
    };
}

function buildRobot() {
    qCurrent = createInitialJointState(activeProfile);
    chain.update(createDhParametersFromJointState(qCurrent, activeProfile), styleParams, baseParams);
    attachActuator();
    updateActuator();
    if (chainSolver) { chainSolver.joints = chain.joints; }
    updateModelPresentation();
    renderLoop.requestRender();
}

function updateArm() {
    chain.update(createDhParametersFromJointState(qCurrent, activeProfile), styleParams, baseParams);
    attachActuator();
    updateActuator();
    if (chainSolver) { chainSolver.joints = chain.joints; }
    updateModelPresentation();
    renderLoop.requestRender();
}

function selectModelPreset(presetKey) {
    if (!modelPresets[presetKey]) { return; }
    pendingSolve = false;
    solveActive = false;
    isSolving = false;
    resetSolveStats();
    modelParams.preset = presetKey;
    activeProfile = modelPresets[presetKey].profile;
    updateModelBinding();
    applyPresetStyle();
    buildRobot();
    frameActiveProfile();
    updateProfileInfo();
    renderLoop.requestRender();
}

function applyPresetStyle() {
    const preset = modelPresets[modelParams.preset];
    if (!preset) { return; }
    Object.assign(styleParams, preset.style);
}

function updateModelBinding() {
    if (!showModelBinding) { return; }
    showModelBinding.disabled = false;
    showModelBinding.refresh();
}

function frameActiveProfile() {
    const preset = modelPresets[modelParams.preset];
    if (!preset) { return; }
    camera.position.fromArray(preset.cameraPosition);
    controls.target.fromArray(preset.cameraTarget);
    controls.update();
}

function addProfileInfoBlock(folder) {
    const block = document.createElement('div');
    block.style.boxSizing = 'border-box';
    block.style.width = '100%';
    block.style.maxHeight = '190px';
    block.style.overflow = 'auto';
    block.style.padding = '8px 10px';
    block.style.marginTop = '4px';
    block.style.borderTop = '1px solid rgba(255, 255, 255, 0.12)';
    block.style.background = 'rgba(0, 0, 0, 0.24)';
    block.style.color = '#d8fbff';
    block.style.fontFamily = 'monospace';
    block.style.fontSize = '10px';
    block.style.lineHeight = '1.45';
    block.style.whiteSpace = 'pre';
    folder.element.appendChild(block);
    return block;
}

function addSolveStatsBlock(folder) {
    const block = addProfileInfoBlock(folder);
    block.style.maxHeight = 'none';
    block.style.color = '#f4f7f8';
    return block;
}

function updateSolveStatsBlock() {
    if (!solveStatsBlock) { return; }
    const algorithm = solverParams.solverMethod === 'DLS'
        ? 'DLS'
        : 'Basic IK';
    solveStatsBlock.textContent = [
        `Algorithm    ${algorithm}`,
        `Status       ${solveStats.status}`,
        `Solve Time   ${solveStats.solveTime}`,
        `Wall Time    ${solveStats.wallTime}`,
        `Iterations   ${solveStats.iterations}`,
        `Solve Calls  ${solveStats.calls}`,
        `Residual     ${solveStats.error}`
    ].join('\n');
}

function resetSolveStats(status = 'Idle') {
    solveStartedAt = 0;
    accumulatedSolveMs = 0;
    accumulatedIterations = 0;
    solveCallCount = 0;
    solveStats.status = status;
    solveStats.solveTime = '--';
    solveStats.wallTime = '--';
    solveStats.iterations = '0';
    solveStats.calls = '0';
    solveStats.error = '--';
    updateSolveStatsBlock();
}

function beginSolveMeasurement() {
    resetSolveStats('Solving');
    solveStartedAt = performance.now();
    solveStats.solveTime = '0.000 ms';
    solveStats.wallTime = '0.000 ms';
    updateSolveStatsBlock();
}

function updateSolveMeasurement(stepSolveMs, remainingError, converged) {
    accumulatedSolveMs += stepSolveMs;
    accumulatedIterations += chainSolver.lastIterationCount;
    solveCallCount += 1;
    solveStats.status = converged ? 'Converged' : 'Solving';
    solveStats.solveTime = `${accumulatedSolveMs.toFixed(3)} ms`;
    solveStats.wallTime = `${(performance.now() - solveStartedAt).toFixed(3)} ms`;
    solveStats.iterations = String(accumulatedIterations);
    solveStats.calls = String(solveCallCount);
    solveStats.error = remainingError.toExponential(3);
    updateSolveStatsBlock();
}

function updateProfileInfo() {
    if (!profileInfoBlock || !activeProfile) { return; }
    const title = activeProfile === ur3eChainProfile
        ? 'UR3e standard DH (metres)'
        : 'KUKA KR5 DH (metres)';
    const rows = activeProfile.segments.map((segment, index) => {
        const d = segment.d.toFixed(5);
        const a = segment.a.toFixed(5);
        const alpha = `${segment.alpha}°`;
        return `J${index + 1}  d ${d}  a ${a}  α ${alpha}`;
    });
    profileInfoBlock.textContent = [title, ...rows].join('\n');
}

function attachActuator() {
    if (!chain.robotContainer) { return; }
    if (actuator.object.parent !== chain.robotContainer) {
        chain.robotContainer.attach(actuator.object);
    }
}

function updateActuator() {
    if (!chain.roboticArm) { return; }
    const actuatorLocalPosition = chain.getActuatorLocalPosition();
    const actuatorLocalQuaternion = chain.getActuatorLocalQuaternion(new Quaternion());
    if (actuatorLocalPosition) {
        isSyncingTarget = true;
        try {
            actuator.setLocalPosition(actuatorLocalPosition);
            if (actuatorLocalQuaternion) {
                actuator.setLocalQuaternion(actuatorLocalQuaternion);
            }
        } finally {
            isSyncingTarget = false;
        }
    }
}

function queueSolveFromTarget() {
    if (!chain.roboticArm || isSyncingTarget) { return; }

    syncPendingTargetFromControl();
    beginSolveMeasurement();
    pendingSolve = true;
    solveActive = true;
    renderLoop.requestRender();
}

function syncPendingTargetFromControl() {
    if (!actuator) { return; }
    actuator.getWorldPosition(pendingTarget);
    actuator.getWorldQuaternion(pendingTargetQuat);
}

function solveIfPending() {
    if ((!pendingSolve && !solveActive) || isSolving || !chain.roboticArm) { return; }
    pendingSolve = false;

    chainSolver.targetPosition.copy(pendingTarget);
    chainSolver.targetQuaternion.copy(pendingTargetQuat);
    isSolving = true;
    const solveStepStartedAt = performance.now();
    try {
        qCurrent = chainSolver.solve(qCurrent);
        chain.updateJoint(qCurrent);
        syncActiveModelPose();
    } finally {
        isSolving = false;
    }
    const solveStepMs = performance.now() - solveStepStartedAt;

    const remainingError = chainSolver.computeSolveErrorNorm(qCurrent);
    const converged = remainingError <= targetTolerance;
    updateSolveMeasurement(solveStepMs, remainingError, converged);
    if (!converged) {
        solveActive = true;
        pendingSolve = true;
    } else {
        solveActive = false;
    }
}

function resetAll() {
    pendingSolve = false;
    solveActive = false;
    isSolving = false;
    if (actuator && actuator.controls) {
        actuator.controls.setMode('translate');
    }
    if (actuator && actuator.object) {
        actuator.object.rotation.set(0, 0, 0);
    }
    resetSolveStats();
    buildRobot();
}

function onResize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderLoop.requestRender();
}

function renderFrame() {
    solveIfPending();
    renderer.render(scene, camera);
    if (pendingSolve || solveActive || isSolving) {
        renderLoop.requestRender();
    }
}
