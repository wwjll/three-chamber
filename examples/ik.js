import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { Pane } from 'tweakpane';
import { getRenderLoopController } from '../extend/tools/Tool.js';
import { Chain } from '../extend/kinematic/Chain.js';
import ChainSolver from '../extend/kinematic/ChainSolver.js';

let scene, camera, renderer, controls, pane;
let chain;
let actuator;
let chainSolver;
let targetModeBinding;
let qCurrent = [];
let isSolving = false;
let isSyncingTarget = false;
let isDraggingTarget = false;
let pendingSolve = false;
const pendingTarget = new THREE.Vector3();
const pendingTargetQuat = new THREE.Quaternion();
const tmpQuat = new THREE.Quaternion();
let solveActive = false;
let targetTolerance = 1e-2;

const BG_COLOR = 0x2b2b2b;
const FRAME_RATE = 60;
const renderLoop = getRenderLoopController();
const renderLoopParams = {
    renderOnIdle: false
};

const styleParams = {
    jointColor: 0x7d7d7d,
    linkColor: 0x000000,
    randomJointColor: true,
    randomLinkColor: false,
    jointRadius: 0.025,
    jointHeight: 0.12,
    linkRadius: 0.01,
    showAxisHelper: false,
    showDOFHelper: false,
    dofColor: 0xffa500,
    dofOpacity: 0.25,
    dofUseJointColor: true,
    dofUseAutoRadius: false,
    dofRadius: 0.1,
    dofRadiusScale: 0.25,
    dofThicknessRatio: 0.3,
    dofSegments: 64,
    dofOffsetZ: 1e-4,
    axisHelperSize: 0.1,
    syncUp: true
};

const baseParams = {
    mdhMode: false,
    baseOffset: { x: 0, y: 0, z: 0 }
};

const solverParams = {
    maxIter: 20,
    alpha: 0.05,
    tolerance: targetTolerance,
    solveMode: 'Position + Rotation',
    solveImmediately: false,
    target: 'Position',
    debug: true
};

const kukaKr5 = [
    { theta: 0, axisSign: 1, thetaOffset: 0, d: 0.4, a: 0.18, alpha: 90, minAngle: -155, maxAngle: 155 },
    { theta: 90, axisSign: -1, thetaOffset: 0, d: 0, a: 0.6, alpha: 0, minAngle: -180, maxAngle: 65 },
    { theta: 0, axisSign: 1, thetaOffset: 0, d: 0, a: 0.12, alpha: 90, minAngle: -15, maxAngle: 158 },
    { theta: 0, axisSign: 1, thetaOffset: 0, d: 0.62, a: 0, alpha: -90, minAngle: -350, maxAngle: 350 },
    { theta: 0, axisSign: 1, thetaOffset: 0, d: 0, a: 0, alpha: 90, minAngle: -130, maxAngle: 130 },
    { theta: 0, axisSign: 1, thetaOffset: 0, d: 0.115, a: 0, alpha: 0, minAngle: -350, maxAngle: 350 }
];

init();

function init() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(BG_COLOR);

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(2, 2, 2);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(BG_COLOR, 1);
    document.body.appendChild(renderer.domElement);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0, 0.5);
    controls.update();
    controls.addEventListener('change', () => {
        renderLoop.requestRender();
    });

    const gridHelper = new THREE.GridHelper(20, 20);
    scene.add(gridHelper);

    chain = new Chain(scene);
    actuator = createActuator(scene, camera, renderer.domElement);
    chainSolver = new ChainSolver({
        targetPosition: new THREE.Vector3(),
        targetQuaternion: new THREE.Quaternion(),
        chain,
        maxIter: solverParams.maxIter,
        alpha: solverParams.alpha,
        tolerance: solverParams.tolerance,
        solveMode: solverParams.solveMode,
        debug: solverParams.debug,
        forwardKinematics: (q) => {
            chain.updateJoint(q);
        }
    });
    actuator.controls.addEventListener('dragging-changed', (event) => {
        controls.enabled = !event.value;
        isDraggingTarget = event.value === true;
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
    renderLoop.setRenderOnIdle(renderLoopParams.renderOnIdle);

    pane = new Pane({ title: 'IK' });
    pane.element.style.right = 'auto';
    pane.element.style.left = '0px';
    pane.element.style.top = '0px';
    pane.element.style.margin = '0px';
    pane.element.style.maxHeight = '100vh';
    pane.element.style.overflow = 'auto';

    const vizFolder = pane.addFolder({ title: 'Viz' });
    vizFolder.addBinding(styleParams, 'syncUp', { label: 'Sync Up' }).on('change', (ev) => {
        if (ev.last === false) return;
        updateArm();
    });
    const helpersFolder = vizFolder.addFolder({ title: 'Helpers' });
    helpersFolder.addBinding(styleParams, 'showAxisHelper', { label: 'Axis Helper' }).on('change', (ev) => {
        if (ev.last === false) return;
        updateArm();
    });
    helpersFolder.addBinding(styleParams, 'showDOFHelper', { label: 'DOF Helper' }).on('change', (ev) => {
        if (ev.last === false) return;
        updateArm();
    });
    helpersFolder.expanded = true;
    vizFolder.expanded = true;

    const controlsFolder = pane.addFolder({ title: 'Control' });
    controlsFolder.addButton({ title: 'Reset' }).on('click', () => {
        resetAll();
    });
    controlsFolder.addBinding(solverParams, 'debug', { label: 'Debug' }).on('change', (ev) => {
        if (chainSolver) chainSolver.debug = ev.value === true;
    });
    controlsFolder.addBinding(solverParams, 'solveImmediately', { label: 'Solve Immediately' });
    controlsFolder.addBinding(renderLoopParams, 'renderOnIdle', { label: 'Render On Idle' }).on('change', (ev) => {
        renderLoop.setRenderOnIdle(ev.value === true);
    });
    targetModeBinding = controlsFolder
        .addBinding(solverParams, 'target', { label: 'Target', options: { Position: 'Position', Rotate: 'Rotate' } })
        .on('change', (ev) => {
            if (!actuator || !actuator.controls) return;
            actuator.controls.setMode(ev.value === 'Rotate' ? 'rotate' : 'translate');
            renderLoop.requestRender();
        });
    controlsFolder
        .addBinding(solverParams, 'solveMode', {
            label: 'IK Mode',
            options: {
                'Position Only': 'Position Only',
                'Position + Rotation': 'Position + Rotation'
            }
        })
        .on('change', (ev) => {
            const value = ev.value;
            if (chainSolver) chainSolver.solveMode = value;
            if (value === 'Position Only') {
                // Reset orientation target to current robot pose when leaving orientation IK.
                const currentQuat = chain.getEndEffectorWorldQuaternion(tmpQuat);
                if (currentQuat && chainSolver) {
                    pendingTargetQuat.copy(currentQuat);
                    chainSolver.targetQuaternion.copy(currentQuat);
                }
            } else {
                // Re-sync gizmo to current EE pose before enabling orientation objective.
                updateActuator();
                syncPendingTargetFromControl();
            }
            syncPendingTargetFromControl();
            pendingSolve = true;
            solveActive = true;
            renderLoop.requestRender();
        });
    controlsFolder
        .addBinding(solverParams, 'maxIter', { label: 'Max Iter', min: 1, max: 200, step: 1 })
        .on('change', (ev) => {
            if (chainSolver) chainSolver.maxIter = ev.value;
        });
    controlsFolder
        .addBinding(solverParams, 'alpha', { label: 'Alpha', min: 0.001, max: 0.5, step: 0.001 })
        .on('change', (ev) => {
            if (chainSolver) chainSolver.alpha = ev.value;
        });
    controlsFolder
        .addBinding(solverParams, 'tolerance', { label: 'Tolerance', min: 1e-5, max: 1e-1, step: 1e-5 })
        .on('change', (ev) => {
            if (chainSolver) chainSolver.tolerance = ev.value;
            targetTolerance = ev.value;
        });
    controlsFolder.expanded = true;

    buildKuka();

    window.addEventListener('resize', onResize);
    renderLoop.requestRender();
}

function createActuator(scene, camera, domElement) {
    const object = new THREE.Object3D();
    object.name = 'actuator';
    object.matrixAutoUpdate = true;
    scene.add(object);

    const sphere = new THREE.Mesh(
        new THREE.SphereGeometry(0.04, 16, 16),
        new THREE.MeshBasicMaterial({ color: 0xff4444 })
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
        getWorldPosition(out = new THREE.Vector3()) {
            if (object.parent) {
                object.parent.updateMatrixWorld(true);
            } else {
                object.updateMatrixWorld(true, false);
            }
            return object.getWorldPosition(out);
        },
        getWorldQuaternion(out = new THREE.Quaternion()) {
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

function buildKuka() {
    qCurrent = kukaKr5.map((segment) => THREE.MathUtils.degToRad(Number.isFinite(segment.theta) ? segment.theta : 0));
    chain.update(getDhParametersFromQ(qCurrent), styleParams, baseParams);
    attachActuator();
    updateActuator();
    if (chainSolver) chainSolver.joints = chain.joints;
    renderLoop.requestRender();
}

function updateArm() {
    chain.update(getDhParametersFromQ(qCurrent), styleParams, baseParams);
    attachActuator();
    updateActuator();
    if (chainSolver) chainSolver.joints = chain.joints;
    renderLoop.requestRender();
}

function getDhParametersFromQ(q) {
    return kukaKr5.map((segment, index) => {
        const theta = Number.isFinite(q[index]) ? q[index] : 0;
        const axisSign = segment.axisSign === -1 ? -1 : 1;
        const thetaOffsetDeg = Number.isFinite(segment.thetaOffset) ? segment.thetaOffset : 0;
        const thetaOffset = THREE.MathUtils.degToRad(thetaOffsetDeg);
        const d = segment.d;
        const a = segment.a;
        const alpha = THREE.MathUtils.degToRad(segment.alpha);
        const [minDhDeg, maxDhDeg] = convertAxisLimitsToDh(segment, axisSign, thetaOffsetDeg);
        return [theta, d, a, alpha, thetaOffset, minDhDeg, maxDhDeg];
    });
}

function convertAxisLimitsToDh(segment, axisSign, thetaOffsetDeg) {
    // Convert controller/axis-space limits to DH-space limits.
    // If the source interval is wrap-around (min > max), keep wrap semantics.
    const minAxisDeg = Number.isFinite(segment.minAngle) ? segment.minAngle : -185;
    const maxAxisDeg = Number.isFinite(segment.maxAngle) ? segment.maxAngle : 185;
    const isWrap = minAxisDeg > maxAxisDeg;

    const mappedMin = axisSign * minAxisDeg + thetaOffsetDeg;
    const mappedMax = axisSign * maxAxisDeg + thetaOffsetDeg;

    if (!isWrap) {
        return mappedMin <= mappedMax
            ? [mappedMin, mappedMax]
            : [mappedMax, mappedMin];
    }

    return axisSign === 1
        ? [mappedMin, mappedMax]
        : [mappedMax, mappedMin];
}

function attachActuator() {
    if (!chain.robotContainer) return;
    if (actuator.object.parent !== chain.robotContainer) {
        chain.robotContainer.attach(actuator.object);
    }
}

function updateActuator() {
    if (!chain.roboticArm) return;
    const actuatorLocalPosition = chain.getEndEffectorLocalPosition();
    const actuatorLocalQuaternion = chain.getEndEffectorLocalQuaternion(new THREE.Quaternion());
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
    if (!chain.roboticArm || isSyncingTarget) return;

    syncPendingTargetFromControl();
    pendingSolve = true;
    solveActive = true;
    renderLoop.requestRender();
}

function syncPendingTargetFromControl() {
    if (!actuator) return;
    actuator.getWorldPosition(pendingTarget);
    actuator.getWorldQuaternion(pendingTargetQuat);
}

function solveIfPending() {
    if ((!pendingSolve && !solveActive) || isSolving || !chain.roboticArm) return;
    pendingSolve = false;

    chainSolver.targetPosition.copy(pendingTarget);
    chainSolver.targetQuaternion.copy(pendingTargetQuat);
    isSolving = true;
    try {
        qCurrent = chainSolver.solve(qCurrent);
        chain.update(getDhParametersFromQ(qCurrent), styleParams, baseParams);
        attachActuator();
        chainSolver.joints = chain.joints;
    } finally {
        isSolving = false;
    }

    const remainingError = chainSolver.computeSolveErrorNorm(qCurrent);
    if (remainingError > targetTolerance) {
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
    solverParams.target = 'Position';
    if (targetModeBinding && typeof targetModeBinding.refresh === 'function') {
        targetModeBinding.refresh();
    }
    if (actuator && actuator.controls) {
        actuator.controls.setMode('translate');
    }
    if (actuator && actuator.object) {
        actuator.object.rotation.set(0, 0, 0);
    }
    buildKuka();
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
