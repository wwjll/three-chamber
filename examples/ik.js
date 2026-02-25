import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { Chain } from '../extend/kinematic/Chain.js';
import ChainSolver from '../extend/kinematic/ChainSolver.js';

let scene, camera, renderer, controls, gui;
let chain;
let endEffector;
let chainSolver;
let targetModeController;
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
    target: 'Position',
    debug: true
};

const kukaKr5 = [
    { theta: 0, d: 0.4, a: 0.18, alpha: 90, minAngle: -185, maxAngle: 185 },
    { theta: 90, d: 0, a: 0.6, alpha: 0, minAngle: -155, maxAngle: 35 },
    { theta: 0, d: 0, a: 0.12, alpha: 90, minAngle: -130, maxAngle: 154 },
    { theta: 0, d: 0.62, a: 0, alpha: -90, minAngle: -350, maxAngle: 350 },
    { theta: 0, d: 0, a: 0, alpha: 90, minAngle: -130, maxAngle: 130 },
    { theta: 0, d: 0.115, a: 0, alpha: 0, minAngle: -350, maxAngle: 350 }
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

    const gridHelper = new THREE.GridHelper(20, 20);
    scene.add(gridHelper);

    chain = new Chain(scene);
    endEffector = createEndEffector(scene, camera, renderer.domElement);
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
    endEffector.controls.addEventListener('dragging-changed', (event) => {
        controls.enabled = !event.value;
        isDraggingTarget = event.value === true;
        if (!isDraggingTarget) {
            // Keep converging toward the last target after drag ends.
            solveActive = true;
            pendingSolve = true;
        }
    });
    endEffector.controls.addEventListener('change', () => {
        if (isDraggingTarget) {
            queueSolveFromTarget();
        }
    });

    gui = new GUI({ title: 'GUI' });
    gui.domElement.style.right = 'auto';
    gui.domElement.style.left = '0px';
    gui.domElement.style.top = '0px';
    gui.domElement.style.margin = '0px';
    gui.domElement.style.maxHeight = '100vh';
    gui.domElement.style.overflow = 'auto';

    const vizFolder = gui.addFolder('Viz');
    vizFolder.add(styleParams, 'syncUp').name('Sync Up').onFinishChange(updateArm);
    const helpersFolder = vizFolder.addFolder('Helpers');
    helpersFolder
        .add(styleParams, 'showAxisHelper')
        .name('Axis Helper')
        .onFinishChange(updateArm);
    helpersFolder
        .add(styleParams, 'showDOFHelper')
        .name('DOF Helper')
        .onFinishChange(updateArm);
    helpersFolder.open();
    vizFolder.open();

    const controlsFolder = gui.addFolder('Control');
    controlsFolder.add({ reset: resetAll }, 'reset').name('Reset');
    controlsFolder
        .add(solverParams, 'debug')
        .name('Debug')
        .onChange((value) => {
            if (chainSolver) chainSolver.debug = value === true;
        });
    targetModeController = controlsFolder
        .add(solverParams, 'target', ['Position', 'Rotate'])
        .name('Target')
        .onChange((value) => {
            if (!endEffector || !endEffector.controls) return;
            endEffector.controls.setMode(value === 'Rotate' ? 'rotate' : 'translate');
        });
    controlsFolder
        .add(solverParams, 'solveMode', ['Position Only', 'Position + Rotation'])
        .name('IK Mode')
        .onChange((value) => {
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
                updateEndEffector();
                syncPendingTargetFromControl();
            }
            syncPendingTargetFromControl();
            pendingSolve = true;
            solveActive = true;
        });
    controlsFolder
        .add(solverParams, 'maxIter', 1, 200, 1)
        .name('Max Iter')
        .onChange((value) => {
            if (chainSolver) chainSolver.maxIter = value;
        });
    controlsFolder
        .add(solverParams, 'alpha', 0.001, 0.5, 0.001)
        .name('Alpha')
        .onChange((value) => {
            if (chainSolver) chainSolver.alpha = value;
        });
    controlsFolder
        .add(solverParams, 'tolerance', 1e-5, 1e-1, 1e-5)
        .name('Tolerance')
        .onChange((value) => {
            if (chainSolver) chainSolver.tolerance = value;
            targetTolerance = value;
        });
    controlsFolder.open();

    buildKuka();

    window.addEventListener('resize', onResize);
    animate();
}

function createEndEffector(scene, camera, domElement) {
    const object = new THREE.Object3D();
    object.name = 'endEffector';
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
    qCurrent = kukaKr5.map(segment => THREE.MathUtils.degToRad(segment.theta));
    chain.update(getDhParametersFromQ(qCurrent), styleParams, baseParams);
    attachEndEffector();
    updateEndEffector();
    if (chainSolver) chainSolver.joints = chain.joints;
}

function updateArm() {
    chain.update(getDhParametersFromQ(qCurrent), styleParams, baseParams);
    attachEndEffector();
    updateEndEffector();
    if (chainSolver) chainSolver.joints = chain.joints;
}

function getDhParametersFromQ(q) {
    return kukaKr5.map((segment, index) => {
        const theta = Number.isFinite(q[index]) ? q[index] : 0;
        const thetaOffset = THREE.MathUtils.degToRad(segment.thetaOffset ?? 0);
        const d = segment.d;
        const a = segment.a;
        const alpha = THREE.MathUtils.degToRad(segment.alpha);
        return [theta, d, a, alpha, thetaOffset, segment.minAngle, segment.maxAngle];
    });
}

function attachEndEffector() {
    if (!chain.robotContainer) return;
    if (endEffector.object.parent !== chain.robotContainer) {
        chain.robotContainer.attach(endEffector.object);
    }
}

function updateEndEffector() {
    if (!chain.roboticArm) return;
    const endEffectorLocalPosition = chain.getEndEffectorLocalPosition();
    const endEffectorLocalQuaternion = chain.getEndEffectorLocalQuaternion(new THREE.Quaternion());
    if (endEffectorLocalPosition) {
        isSyncingTarget = true;
        try {
            endEffector.setLocalPosition(endEffectorLocalPosition);
            if (endEffectorLocalQuaternion) {
                endEffector.setLocalQuaternion(endEffectorLocalQuaternion);
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
}

function syncPendingTargetFromControl() {
    if (!endEffector) return;
    endEffector.getWorldPosition(pendingTarget);
    endEffector.getWorldQuaternion(pendingTargetQuat);
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
        attachEndEffector();
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
    if (targetModeController) targetModeController.updateDisplay();
    if (endEffector && endEffector.controls) {
        endEffector.controls.setMode('translate');
    }
    if (endEffector && endEffector.object) {
        endEffector.object.rotation.set(0, 0, 0);
    }
    buildKuka();
}

function onResize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
}

function animate() {
    requestAnimationFrame(animate);
    solveIfPending();
    renderer.render(scene, camera);
}
