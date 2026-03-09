/**
 * @fileoverview IK pick-and-place demo integrating Three.js rendering, IK solving,
 * and Rapier physics-based grasping.
 *
 * Runtime architecture:
 * - Rendering/UI: Three.js scene + OrbitControls + TransformControls + Tweakpane.
 * - Kinematics: `Chain` + `ChainSolver` drive arm joints from an IK target.
 * - End-effector: `Actuator` provides tool transform, jaw animation, and colliders.
 * - Physics: Rapier simulates cubes/ground/container and grasp joint constraints.
 *
 * Main flow:
 * 1) User picks a cube in the scene (`onScenePickClick`).
 * 2) Stage machine (`pickSequence`) runs approach -> descend -> grip -> lift -> carry -> drop.
 * 3) During grip, jaw contacts are evaluated and a fixed impulse joint is created.
 * 4) Release happens when jaw opening (`jawInnerGap`) reaches/exceeds cube size.
 *
 * Key state variables (names and roles):
 * - `scene`, `camera`, `renderer`, `controls`, `pane`: render/UI handles.
 * - `chain`, `actuator`, `ikTarget`, `chainSolver`: kinematic/actuator core objects.
 * - `qCurrent`: current joint configuration (radians).
 * - `isSolving`, `pendingSolve`, `solveActive`: IK scheduling/solve flags.
 * - `pendingTarget`, `pendingTargetQuat`: end-node world target derived from grip target.
 * - `pickSequence`: pick state machine context (`cube`, `stage`, timing fields).
 * - `stageTask`, `stageLerp`: generic staged wait/lerp execution state.
 * - `physicsWorld`, `physicsReady`: Rapier world lifecycle.
 * - `physicsCubes`: spawned dynamic cube records (`body`, `collider`, `mesh`, `size`).
 * - `graspJoint`: active fixed impulse joint between tool body and grabbed cube body.
 * - `graspedCube`: cube currently constrained by `graspJoint`.
 * - `containerBody`, `containerColliders`: fixed drop-zone physics bodies.
 * - `reachRangeGroup`, `reachInnerRing`, `reachOuterRing`: visual reach indicator meshes.
 *
 * Naming conventions:
 * - `tmp*` variables are reusable temporary vectors/quaternions to avoid allocations.
 * - `*Params` objects expose live-configurable parameters through UI.
 * - `*Folder` names correspond to Tweakpane sections.
 *
 * Collision-group helpers:
 * - `encodeInteractionGroups(memberships, filters)` packs 16-bit masks into uint32.
 * - `HELD_CUBE_INTERACTION_GROUPS` excludes `GRIPPER_GROUP` while grasped to reduce
 *   constraint-vs-contact fighting during carry.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import * as RAPIER from '@dimforge/rapier3d-compat';
import { Pane } from 'tweakpane';
import { getAssetURL, getRenderLoopController } from '../extend/tools/Tool.js';
import { Chain } from '../extend/kinematic/Chain.js';
import ChainSolver from '../extend/kinematic/ChainSolver.js';
import Actuator from '../extend/kinematic/Actuator.js';

let scene, camera, renderer, controls, pane;
let chain;
let actuator;
let ikTarget;
let chainSolver;
let targetModeBinding;
let qCurrent = [];
let isSolving = false;
let isDraggingTarget = false;
let pendingSolve = false;
const pendingTarget = new THREE.Vector3();
const pendingTargetQuat = new THREE.Quaternion();
const tmpGripTargetPos = new THREE.Vector3();
const tmpGripTargetQuat = new THREE.Quaternion();
const tmpSpawnTargetPos = new THREE.Vector3();
const tmpBasePos = new THREE.Vector3();
const tmpPickPos = new THREE.Vector3();
const tmpVerticalGraspQuat = new THREE.Quaternion();
const tmpContainerPos = new THREE.Vector3();
const tmpLerpTargetPos = new THREE.Vector3();
const tmpLerpTargetQuat = new THREE.Quaternion();
const tmpStageTaskPos = new THREE.Vector3();
const tmpStageTaskQuat = new THREE.Quaternion();
const tmpGraspWorldPos = new THREE.Vector3();
const tmpBodyPosA = new THREE.Vector3();
const tmpBodyPosB = new THREE.Vector3();
const tmpBodyQuatA = new THREE.Quaternion();
const tmpBodyQuatB = new THREE.Quaternion();
const tmpInvBodyQuat = new THREE.Quaternion();
const tmpLocalAnchorA = new THREE.Vector3();
const tmpLocalAnchorB = new THREE.Vector3();
const tmpJointLocalRotB = new THREE.Quaternion();
const tmpCubeWorldPos = new THREE.Vector3();
const tmpCubeLocalPos = new THREE.Vector3();
const pickRaycaster = new THREE.Raycaster();
const pickPointerNdc = new THREE.Vector2();
let solveActive = false;
let targetTolerance = 1e-2;
let pickSequence = null;
let stageLerp = null;
let stageTask = null;
let physicsWorld = null;
let physicsReady = false;
let physicsDebugLines = null;
let physicsDebugRgbBuffer = null;
let containerBody = null;
const containerColliders = [];
let reachRangeGroup = null;
let reachInnerRing = null;
let reachOuterRing = null;
let fixedDropLathe = null;
const physicsCubes = [];
const cubeGeometry = new THREE.BoxGeometry(1, 1, 1);
let graspJoint = null;
let graspedCube = null;
let prevJawInnerGap = null;
let isGripButtonHeld = false;

const BG_COLOR = 0x2b2b2b;
const FRAME_RATE = 60;
const PICK_STAGE_DELAY_MS = 50;
const DESCEND_STAGE_TOLERANCE = 0.008;
const DESCEND_STAGE_TIMEOUT_MS = 1200;
const PICK_STAGE_POSITION_TOLERANCE = 0.006;
const JAW_GAP_OPEN_EPS = 1e-4;
const INTERACTION_ALL = 0xffff;
const GRIPPER_GROUP = 1 << 1;
const INTERACTION_ALL_BUT_GRIPPER = INTERACTION_ALL & ~GRIPPER_GROUP;
const encodeInteractionGroups = (memberships, filters) => ((((memberships & 0xffff) << 16) | (filters & 0xffff)) >>> 0);
const DEFAULT_INTERACTION_GROUPS = encodeInteractionGroups(INTERACTION_ALL, INTERACTION_ALL);
const HELD_CUBE_INTERACTION_GROUPS = encodeInteractionGroups(INTERACTION_ALL, INTERACTION_ALL_BUT_GRIPPER);
const CONTAINER_RIM_HEIGHT = 0.22;
const CONTAINER_OUTER_RADIUS = 0.21;
const GRID_TEXTURE_URL = `${getAssetURL()}textures/grid.png`;
const renderControl = getRenderLoopController();
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
    showDOFHelper: true,
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
    maxIter: 15,
    alpha: 0.05,
    tolerance: targetTolerance,
    solveMode: 'Position + Rotation',
    target: 'Position',
    debug: true
};

const actuatorParams = {
    toolEuler: { x: 0, y: -90, z: 0 },
    showHelper: false,
};

const helperParams = {
    showPhysicsColliders: true,
    showColliderAxes: false,
};

const pickParams = {
    spawnCount: 10,
    outerRadius: 1.3,
    innerRadius: 1.1,
    dropHeight: 0.35,
    cubeSize: 0.04,
    graspHover: 0.5,
    stageDelayMs: PICK_STAGE_DELAY_MS,
    approachDurationMs: 300,
    descendDurationMs: 100,
    liftDurationMs: 200,
    carryDurationMs: 400,
    gripCloseStep: 0.02,
};

const kukaKr5 = [
    { theta: 0, axisSign: 1, thetaOffset: 0, d: 0.4, a: 0.18, alpha: 90, minAngle: -155, maxAngle: 155 },
    { theta: 90, axisSign: -1, thetaOffset: 0, d: 0, a: 0.6, alpha: 0, minAngle: -180, maxAngle: 65 },
    { theta: 0, axisSign: 1, thetaOffset: 0, d: 0, a: 0.12, alpha: 90, minAngle: -15, maxAngle: 158 },
    { theta: 0, axisSign: 1, thetaOffset: 0, d: 0.62, a: 0, alpha: -90, minAngle: -350, maxAngle: 350 },
    { theta: 0, axisSign: 1, thetaOffset: 0, d: 0, a: 0, alpha: 90, minAngle: -130, maxAngle: 130 },
    { theta: 0, axisSign: 1, thetaOffset: 0, d: 0.115, a: 0, alpha: 0, minAngle: -350, maxAngle: 350 }
];

init().catch((error) => {
    console.error('[IK Pick] init failed:', error);
});

async function init() {
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
        renderControl.requestRender();
    });

    const gridHelper = new THREE.GridHelper(8, 8);
    scene.add(gridHelper);
    await initPhysics();

    chain = new Chain(scene);
    actuator = new Actuator({
        scene,
        physicsWorld,
        toolEulerDeg: actuatorParams.toolEuler,
    });
    ikTarget = createIKTarget(scene, camera, renderer.domElement);
    ikTarget.controls.visible = actuatorParams.showHelper === true;
    ikTarget.marker.visible = actuatorParams.showHelper === true;
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
    ikTarget.controls.addEventListener('dragging-changed', (event) => {
        controls.enabled = !event.value;
        isDraggingTarget = event.value === true;
        if (!isDraggingTarget) {
            queueSolveFromTarget();
        }
        renderControl.requestRender();
    });
    ikTarget.controls.addEventListener('change', () => {
        renderControl.requestRender();
    });

    renderControl.configure({
        fps: FRAME_RATE,
        render: renderFrame
    });
    renderControl.setRenderOnIdle(renderLoopParams.renderOnIdle);

    pane = new Pane({ title: 'IK Pick' });
    pane.element.style.right = 'auto';
    pane.element.style.left = '0px';
    pane.element.style.top = '0px';
    pane.element.style.margin = '0px';
    pane.element.style.maxHeight = '100vh';
    pane.element.style.overflow = 'auto';

    const helpersFolder = pane.addFolder({ title: 'Helpers' });
    helpersFolder.addBinding(styleParams, 'showAxisHelper', { label: 'Axis Helper' }).on('change', (ev) => {
        if (ev.last === false) return;
        updateArm();
    });
    helpersFolder.addBinding(styleParams, 'showDOFHelper', { label: 'DOF Helper' }).on('change', (ev) => {
        if (ev.last === false) return;
        updateArm();
    });
    helpersFolder.addBinding(actuatorParams, 'showHelper', { label: 'Transform Helper' }).on('change', (ev) => {
        if (ikTarget?.controls) {
            ikTarget.controls.visible = ev.value === true;
        }
        if (ikTarget?.marker) {
            ikTarget.marker.visible = ev.value === true;
        }
        renderControl.requestRender();
    });
    helpersFolder.addBinding(helperParams, 'showPhysicsColliders', { label: 'Collider Debug' }).on('change', () => {
        renderControl.requestRender();
    });
    helpersFolder.addBinding(helperParams, 'showColliderAxes', { label: 'Collider Axes' }).on('change', () => {
        renderControl.requestRender();
    });
    helpersFolder.expanded = true;

    const controlsFolder = pane.addFolder({ title: 'Control' });
    controlsFolder.addButton({ title: 'Reset' }).on('click', () => {
        resetAll();
    });
    controlsFolder.addBinding(solverParams, 'debug', { label: 'Debug' }).on('change', (ev) => {
        if (chainSolver) chainSolver.debug = ev.value === true;
    });
    targetModeBinding = controlsFolder
        .addBinding(solverParams, 'target', { label: 'Target', options: { Position: 'Position', Rotate: 'Rotate' } })
        .on('change', (ev) => {
            ikTarget.controls.setMode(ev.value === 'Rotate' ? 'rotate' : 'translate');
            renderControl.requestRender();
        });
    controlsFolder
        .addBinding(solverParams, 'maxIter', { label: 'Max Iter', min: 10, max: 30, step: 1 })
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

    const pickFolder = pane.addFolder({ title: 'Pick' });
    pickFolder.addBinding(pickParams, 'spawnCount', { label: 'Count', min: 1, max: 20, step: 1 });
    pickFolder.addBinding(pickParams, 'outerRadius', { label: 'Outer R', min: 0.2, max: 3.0, step: 0.01 }).on('change', () => {
        sanitizePickRadii();
        rebuildReachRangeRings();
        renderControl.requestRender();
    });
    pickFolder.addBinding(pickParams, 'innerRadius', { label: 'Inner R', min: 0.0, max: 2.8, step: 0.01 }).on('change', () => {
        sanitizePickRadii();
        rebuildReachRangeRings();
        renderControl.requestRender();
    });
    pickFolder.addBinding(pickParams, 'cubeSize', { label: 'Cube Size', min: 0.02, max: 0.15, step: 0.005 });
    pickFolder.addBinding(pickParams, 'graspHover', { label: 'Hover', min: 0.1, max: 2.5, step: 0.01 });
    pickFolder.addBinding(pickParams, 'stageDelayMs', { label: 'Stage Delay', min: 0, max: 500, step: 50 });
    pickFolder.addBinding(pickParams, 'approachDurationMs', { label: 'Approach ms', min: 50, max: 2000, step: 10 });
    pickFolder.addBinding(pickParams, 'descendDurationMs', { label: 'Descend ms', min: 50, max: 2000, step: 10 });
    pickFolder.addBinding(pickParams, 'liftDurationMs', { label: 'Lift ms', min: 50, max: 2000, step: 10 });
    pickFolder.addBinding(pickParams, 'carryDurationMs', { label: 'Carry ms', min: 50, max: 3000, step: 10 });
    pickFolder.addBinding(pickParams, 'gripCloseStep', { label: 'Grip Step', min: 0.002, max: 0.05, step: 0.001 });
    pickFolder.addButton({ title: 'Spawn Cubes' }).on('click', () => {
        spawnPickCubes();
    });
    pickFolder.addButton({ title: 'Clear Cubes' }).on('click', () => {
        clearPickCubes();
    });
    const gripButton = pickFolder.addButton({ title: 'Grip' });
    gripButton.on('click', () => {
        runManualGripStep();
        renderControl.requestRender();
    });
    const gripButtonElement = gripButton.element.querySelector('button') ?? gripButton.element;
    gripButtonElement.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return;
        isGripButtonHeld = true;
        runManualGripStep();
        renderControl.requestRender();
    });
    window.addEventListener('pointerup', () => {
        isGripButtonHeld = false;
    });
    window.addEventListener('pointercancel', () => {
        isGripButtonHeld = false;
    });
    pickFolder.addButton({ title: 'Drop' }).on('click', () => {
        clearPickLerp();
        pickSequence = null;
        releaseGraspJoint();
        actuator?.open();
        renderControl.requestRender();
    });
    pickFolder.expanded = true;

    buildKuka();
    createFixedDropLathe();
    rebuildReachRangeRings();
    updateReachRangePose();

    window.addEventListener('resize', onResize);
    renderer.domElement.addEventListener('click', onScenePickClick);
    renderControl.requestRender();
}

function createIKTarget(sceneRef, cameraRef, domElement) {
    const object = new THREE.Object3D();
    object.name = 'ikTarget';
    object.matrixAutoUpdate = true;
    sceneRef.add(object);

    const marker = new THREE.Mesh(
        new THREE.SphereGeometry(0.03, 16, 12),
        new THREE.MeshBasicMaterial({ color: 0xff4444 })
    );
    object.add(marker);

    const targetControls = new TransformControls(cameraRef, domElement);
    targetControls.setMode('translate');
    targetControls.setSpace('local');
    targetControls.attach(object);
    sceneRef.add(targetControls);

    return { object, marker, controls: targetControls };
}

async function initPhysics() {
    if (physicsReady) return;
    await RAPIER.init();

    physicsWorld = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    createPhysicsGround();
    physicsReady = true;
}

function createPhysicsGround() {
    const ground = new THREE.Mesh(
        new THREE.BoxGeometry(8, 0.1, 8),
        new THREE.MeshBasicMaterial({
            color: 0x4a5560,
        }),
    );
    ground.position.y = -0.05;
    scene.add(ground);

    const groundBody = physicsWorld.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.05, 0),
    );
    physicsWorld.createCollider(
        RAPIER.ColliderDesc.cuboid(4, 0.05, 4).setFriction(0.9).setRestitution(0.05),
        groundBody,
    );
}

function ensurePhysicsDebugLines() {
    if (physicsDebugLines || !scene) return;
    const geometry = new THREE.BufferGeometry();
    const material = new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.75,
        depthWrite: false,
    });
    physicsDebugLines = new THREE.LineSegments(geometry, material);
    physicsDebugLines.name = 'physics_debug_lines';
    physicsDebugLines.frustumCulled = false;
    physicsDebugLines.renderOrder = 1000;
    physicsDebugLines.visible = false;
    scene.add(physicsDebugLines);
}

function updatePhysicsDebugLines() {
    if (!physicsWorld) return false;
    ensurePhysicsDebugLines();
    if (!physicsDebugLines) return false;
    if (!helperParams.showPhysicsColliders) {
        physicsDebugLines.visible = false;
        return false;
    }

    const { vertices, colors } = physicsWorld.debugRender();

    const isSingleAxisColor = (r, g, b) => {
        const eps = 1e-4;
        let nonZero = 0;
        if (Math.abs(r) > eps) nonZero += 1;
        if (Math.abs(g) > eps) nonZero += 1;
        if (Math.abs(b) > eps) nonZero += 1;
        return nonZero === 1;
    };

    let drawVertices = vertices;
    let drawColors = colors;
    if (!helperParams.showColliderAxes) {
        const filteredVertices = [];
        const filteredColors = [];
        const segmentCount = Math.floor(vertices.length / 6);
        for (let s = 0; s < segmentCount; s++) {
            const vBase = s * 6;
            const cBase = s * 8;
            const c1IsAxis = isSingleAxisColor(colors[cBase], colors[cBase + 1], colors[cBase + 2]);
            const c2IsAxis = isSingleAxisColor(colors[cBase + 4], colors[cBase + 5], colors[cBase + 6]);
            if (c1IsAxis && c2IsAxis) {
                continue;
            }
            filteredVertices.push(
                vertices[vBase], vertices[vBase + 1], vertices[vBase + 2],
                vertices[vBase + 3], vertices[vBase + 4], vertices[vBase + 5],
            );
            filteredColors.push(
                colors[cBase], colors[cBase + 1], colors[cBase + 2], colors[cBase + 3],
                colors[cBase + 4], colors[cBase + 5], colors[cBase + 6], colors[cBase + 7],
            );
        }
        drawVertices = new Float32Array(filteredVertices);
        drawColors = new Float32Array(filteredColors);
    }

    const vertexCount = drawVertices.length / 3;
    if (!physicsDebugRgbBuffer || physicsDebugRgbBuffer.length !== vertexCount * 3) {
        physicsDebugRgbBuffer = new Float32Array(vertexCount * 3);
    }
    for (let i = 0, j = 0; i < vertexCount; i++, j += 3) {
        const c = i * 4;
        physicsDebugRgbBuffer[j] = drawColors[c];
        physicsDebugRgbBuffer[j + 1] = drawColors[c + 1];
        physicsDebugRgbBuffer[j + 2] = drawColors[c + 2];
    }

    const geometry = physicsDebugLines.geometry;
    geometry.setAttribute('position', new THREE.BufferAttribute(drawVertices, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(physicsDebugRgbBuffer, 3));
    geometry.computeBoundingSphere();
    physicsDebugLines.visible = true;
    return vertexCount > 0;
}

function getContainerDims() {
    const wallThickness = 0.03;
    const floorThickness = 0.03;
    const innerHalf = CONTAINER_OUTER_RADIUS - wallThickness;
    const wallHalfHeight = CONTAINER_RIM_HEIGHT * 0.5;
    const wallCenter = innerHalf + wallThickness * 0.5;
    const wallHalfLong = innerHalf + wallThickness;
    return { wallThickness, floorThickness, innerHalf, wallHalfHeight, wallCenter, wallHalfLong };
}

function createFixedDropLathe() {
    if (fixedDropLathe || !ikTarget?.object) return;

    ikTarget.object.getWorldPosition(tmpSpawnTargetPos);
    const { wallThickness, floorThickness, innerHalf, wallHalfHeight, wallCenter, wallHalfLong } = getContainerDims();

    const group = new THREE.Group();
    group.name = 'fixedDropLathe';
    group.position.set(tmpSpawnTargetPos.x, 0.005, tmpSpawnTargetPos.z);

    const texture = new THREE.TextureLoader().load(GRID_TEXTURE_URL, () => {
        renderControl.requestRender();
    });
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(2, 2);
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.MeshBasicMaterial({
        map: texture,
        color: 0xffffff,
        wireframe: false,
        side: THREE.DoubleSide,
    });

    const floor = new THREE.Mesh(
        new THREE.BoxGeometry(innerHalf * 2, floorThickness, innerHalf * 2),
        material,
    );
    floor.position.y = floorThickness * 0.5;
    group.add(floor);

    const wallXPos = new THREE.Mesh(
        new THREE.BoxGeometry(wallThickness, CONTAINER_RIM_HEIGHT, wallHalfLong * 2),
        material,
    );
    wallXPos.position.set(wallCenter, wallHalfHeight, 0);
    group.add(wallXPos);

    const wallXNeg = wallXPos.clone();
    wallXNeg.position.x = -wallCenter;
    group.add(wallXNeg);

    const wallZPos = new THREE.Mesh(
        new THREE.BoxGeometry(wallHalfLong * 2, CONTAINER_RIM_HEIGHT, wallThickness),
        material,
    );
    wallZPos.position.set(0, wallHalfHeight, wallCenter);
    group.add(wallZPos);

    const wallZNeg = wallZPos.clone();
    wallZNeg.position.z = -wallCenter;
    group.add(wallZNeg);

    scene.add(group);
    fixedDropLathe = group;
    createContainerPhysicsAt(group.position);
}

function createContainerPhysicsAt(position) {
    if (!physicsWorld || containerBody) return;
    containerBody = physicsWorld.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(position.x, position.y, position.z),
    );

    const { wallThickness, floorThickness, innerHalf, wallHalfHeight, wallCenter, wallHalfLong } = getContainerDims();

    const floor = physicsWorld.createCollider(
        RAPIER.ColliderDesc.cuboid(innerHalf, floorThickness * 0.5, innerHalf)
            .setTranslation(0, floorThickness * 0.5, 0)
            .setFriction(0.9),
        containerBody,
    );
    containerColliders.push(floor);

    const wallXPos = physicsWorld.createCollider(
        RAPIER.ColliderDesc.cuboid(wallThickness * 0.5, wallHalfHeight, wallHalfLong)
            .setTranslation(wallCenter, wallHalfHeight, 0)
            .setFriction(0.9),
        containerBody,
    );
    containerColliders.push(wallXPos);

    const wallXNeg = physicsWorld.createCollider(
        RAPIER.ColliderDesc.cuboid(wallThickness * 0.5, wallHalfHeight, wallHalfLong)
            .setTranslation(-wallCenter, wallHalfHeight, 0)
            .setFriction(0.9),
        containerBody,
    );
    containerColliders.push(wallXNeg);

    const wallZPos = physicsWorld.createCollider(
        RAPIER.ColliderDesc.cuboid(wallHalfLong, wallHalfHeight, wallThickness * 0.5)
            .setTranslation(0, wallHalfHeight, wallCenter)
            .setFriction(0.9),
        containerBody,
    );
    containerColliders.push(wallZPos);

    const wallZNeg = physicsWorld.createCollider(
        RAPIER.ColliderDesc.cuboid(wallHalfLong, wallHalfHeight, wallThickness * 0.5)
            .setTranslation(0, wallHalfHeight, -wallCenter)
            .setFriction(0.9),
        containerBody,
    );
    containerColliders.push(wallZNeg);
}

function getContainerDropPoint(out = new THREE.Vector3()) {
    if (fixedDropLathe) {
        out.copy(fixedDropLathe.position);
        out.y += CONTAINER_RIM_HEIGHT;
        return out;
    }
    out.set(0, CONTAINER_RIM_HEIGHT, 0);
    return out;
}

function sanitizePickRadii() {
    if (!Number.isFinite(pickParams.outerRadius)) pickParams.outerRadius = 0.6;
    if (!Number.isFinite(pickParams.innerRadius)) pickParams.innerRadius = 0.2;
    pickParams.outerRadius = Math.max(0.2, pickParams.outerRadius);
    pickParams.innerRadius = THREE.MathUtils.clamp(pickParams.innerRadius, 0, pickParams.outerRadius - 1e-4);
}

function createRing(radius, color) {
    const segments = 96;
    const points = [];
    for (let i = 0; i < segments; i++) {
        const t = (i / segments) * Math.PI * 2;
        points.push(new THREE.Vector3(Math.cos(t) * radius, 0, Math.sin(t) * radius));
    }
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({ color });
    return new THREE.LineLoop(geometry, material);
}

function rebuildReachRangeRings() {
    sanitizePickRadii();
    if (!reachRangeGroup) {
        reachRangeGroup = new THREE.Group();
        reachRangeGroup.name = 'pickReachRange';
        reachRangeGroup.position.y = 0.002;
        scene.add(reachRangeGroup);
    }
    if (reachOuterRing) {
        reachOuterRing.geometry.dispose();
        reachOuterRing.material.dispose();
        reachRangeGroup.remove(reachOuterRing);
    }
    if (reachInnerRing) {
        reachInnerRing.geometry.dispose();
        reachInnerRing.material.dispose();
        reachRangeGroup.remove(reachInnerRing);
    }

    reachOuterRing = createRing(pickParams.outerRadius, 0x5bc0eb);
    reachInnerRing = createRing(pickParams.innerRadius, 0xffc857);
    reachRangeGroup.add(reachOuterRing, reachInnerRing);
}

function updateReachRangePose() {
    if (!reachRangeGroup) return;
    if (chain?.robotContainer) {
        chain.robotContainer.getWorldPosition(tmpBasePos);
        reachRangeGroup.position.set(tmpBasePos.x, 0.002, tmpBasePos.z);
        return;
    }
    reachRangeGroup.position.set(0, 0.002, 0);
}

function spawnPickCubes() {
    if (!physicsReady || !physicsWorld || !ikTarget) return;
    sanitizePickRadii();

    ikTarget.object.getWorldPosition(tmpSpawnTargetPos);
    if (chain?.robotContainer) {
        chain.robotContainer.getWorldPosition(tmpBasePos);
    } else {
        tmpBasePos.set(0, 0, 0);
    }
    const count = Math.max(1, Math.floor(pickParams.spawnCount));
    const maxRadius = pickParams.outerRadius;
    const minRadius = pickParams.innerRadius;
    const size = Math.max(0.01, pickParams.cubeSize);
    const baseY = Math.max(0.15, tmpSpawnTargetPos.y - Math.max(0.01, pickParams.dropHeight));

    for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const r2 = THREE.MathUtils.lerp(minRadius * minRadius, maxRadius * maxRadius, Math.random());
        const radius = Math.sqrt(r2);
        const x = tmpBasePos.x + Math.cos(angle) * radius;
        const y = baseY + Math.random() * 0.25;
        const z = tmpBasePos.z + Math.sin(angle) * radius;

        const body = physicsWorld.createRigidBody(
            RAPIER.RigidBodyDesc.dynamic()
                .setTranslation(x, y, z)
                .setLinearDamping(0.2)
                .setAngularDamping(0.3)
                .setCcdEnabled(true),
        );
        const collider = physicsWorld.createCollider(
            RAPIER.ColliderDesc.cuboid(size * 0.5, size * 0.5, size * 0.5)
                .setFriction(0.8)
                .setRestitution(0.1),
            body,
        );

        const randomColor = new THREE.Color().setHSL(Math.random(), 0.75, 0.55);
        const mesh = new THREE.Mesh(cubeGeometry, new THREE.MeshBasicMaterial({ color: randomColor }));
        mesh.scale.set(size, size, size);
        mesh.position.set(x, y, z);
        scene.add(mesh);

        const cubeItem = {
            body,
            collider,
            mesh,
            size,
            savedCollisionGroups: null,
            savedSolverGroups: null,
            gripFilterApplied: false,
        };
        mesh.userData.pickCube = cubeItem;
        physicsCubes.push(cubeItem);
    }

    renderControl.requestRender();
}

function clearPickCubes() {
    clearPickLerp();
    pickSequence = null;
    releaseGraspJoint();
    if (physicsWorld) {
        for (const item of physicsCubes) {
            if (item.collider) {
                physicsWorld.removeCollider(item.collider, true);
            }
            if (item.body) {
                physicsWorld.removeRigidBody(item.body);
            }
            if (item.mesh?.parent) {
                item.mesh.parent.remove(item.mesh);
            }
            item.mesh?.material?.dispose?.();
        }
    } else {
        for (const item of physicsCubes) {
            if (item.mesh?.parent) {
                item.mesh.parent.remove(item.mesh);
            }
            item.mesh?.material?.dispose?.();
        }
    }
    physicsCubes.length = 0;
    renderControl.requestRender();
}

function copyBodyPose(body, outPos, outQuat) {
    const t = body.translation();
    const r = body.rotation();
    outPos.set(t.x, t.y, t.z);
    outQuat.set(r.x, r.y, r.z, r.w);
}

function worldToBodyLocalPoint(body, worldPoint, out) {
    copyBodyPose(body, tmpBodyPosA, tmpBodyQuatA);
    tmpInvBodyQuat.copy(tmpBodyQuatA).invert();
    return out.copy(worldPoint).sub(tmpBodyPosA).applyQuaternion(tmpInvBodyQuat);
}

function applyHeldCubeCollisionFilter(cubeItem) {
    if (!cubeItem?.collider || cubeItem.gripFilterApplied) return;
    cubeItem.savedCollisionGroups = cubeItem.collider.collisionGroups();
    cubeItem.savedSolverGroups = cubeItem.collider.solverGroups();
    cubeItem.collider.setCollisionGroups(HELD_CUBE_INTERACTION_GROUPS);
    cubeItem.collider.setSolverGroups(HELD_CUBE_INTERACTION_GROUPS);
    cubeItem.gripFilterApplied = true;
}

function restoreHeldCubeCollisionFilter(cubeItem) {
    if (!cubeItem?.collider || !cubeItem.gripFilterApplied) return;
    const collisionGroups = Number.isFinite(cubeItem.savedCollisionGroups)
        ? cubeItem.savedCollisionGroups
        : DEFAULT_INTERACTION_GROUPS;
    const solverGroups = Number.isFinite(cubeItem.savedSolverGroups)
        ? cubeItem.savedSolverGroups
        : DEFAULT_INTERACTION_GROUPS;
    cubeItem.collider.setCollisionGroups(collisionGroups);
    cubeItem.collider.setSolverGroups(solverGroups);
    cubeItem.savedCollisionGroups = null;
    cubeItem.savedSolverGroups = null;
    cubeItem.gripFilterApplied = false;
}

function areCollidersTouching(colliderA, colliderB) {
    if (!physicsWorld || !colliderA || !colliderB) return false;
    let hasContact = false;
    physicsWorld.contactPair(colliderA, colliderB, () => {
        hasContact = true;
    });
    return hasContact || physicsWorld.intersectionPair(colliderA, colliderB);
}

function releaseGraspJoint() {
    restoreHeldCubeCollisionFilter(graspedCube);
    if (!physicsWorld || !graspJoint) {
        graspJoint = null;
        graspedCube = null;
        return;
    }
    physicsWorld.removeImpulseJoint(graspJoint, true);
    graspJoint = null;
    graspedCube = null;
}

function createGraspJointForCube(toolBody, cubeItem) {
    if (!toolBody || !cubeItem?.body || !physicsWorld) return false;
    const cubeT = cubeItem.body.translation();
    tmpGraspWorldPos.set(cubeT.x, cubeT.y, cubeT.z);
    worldToBodyLocalPoint(toolBody, tmpGraspWorldPos, tmpLocalAnchorA);
    tmpLocalAnchorB.set(0, 0, 0);
    copyBodyPose(toolBody, tmpBodyPosA, tmpBodyQuatA);
    copyBodyPose(cubeItem.body, tmpBodyPosB, tmpBodyQuatB);
    tmpJointLocalRotB.copy(tmpBodyQuatB).invert().multiply(tmpBodyQuatA).normalize();

    graspJoint = physicsWorld.createImpulseJoint(
        RAPIER.JointData.fixed(
            { x: tmpLocalAnchorA.x, y: tmpLocalAnchorA.y, z: tmpLocalAnchorA.z },
            { x: 0, y: 0, z: 0, w: 1 },
            { x: tmpLocalAnchorB.x, y: tmpLocalAnchorB.y, z: tmpLocalAnchorB.z },
            { x: tmpJointLocalRotB.x, y: tmpJointLocalRotB.y, z: tmpJointLocalRotB.z, w: tmpJointLocalRotB.w },
        ),
        toolBody,
        cubeItem.body,
        true,
    );
    graspedCube = cubeItem;
    applyHeldCubeCollisionFilter(cubeItem);
    cubeItem.body.wakeUp();
    return true;
}

function getJawContactState(cubeItem) {
    if (!physicsWorld || !actuator || !cubeItem?.collider) {
        return { left: false, right: false };
    }
    const { left, right } = actuator.getJawColliders();
    if (!left || !right) {
        return { left: false, right: false };
    }
    return {
        left: areCollidersTouching(left, cubeItem.collider),
        right: areCollidersTouching(right, cubeItem.collider),
    };
}

function pickJawContactCandidate(cubeList) {
    if (!actuator || !Array.isArray(cubeList) || cubeList.length === 0) return null;
    const jawGap = actuator.getJawInnerGap();
    for (const cubeItem of cubeList) {
        if (!cubeItem?.collider || !cubeItem?.body || !cubeItem?.mesh?.parent) continue;
        const contact = getJawContactState(cubeItem);
        const hasDual = contact.left && contact.right;
        if (!hasDual) continue;
        const cubeSize = Number.isFinite(cubeItem.size) ? cubeItem.size : pickParams.cubeSize;
        if (jawGap <= 0.92 * cubeSize) {
            return cubeItem;
        }
    }
    return null;
}

function startLiftAfterGrip(cubeItem) {
    if (!pickSequence || pickSequence.cube !== cubeItem) return;
    const ok = computePickTargetFromCube(cubeItem, pickParams.graspHover, tmpLerpTargetPos, tmpLerpTargetQuat);
    if (!ok) {
        pickSequence.stage = 'lift';
        queueSolveFromTarget();
        return;
    }
    pickSequence.stage = 'liftFlow';
    startStageTask(function* () {
        yield {
            name: 'liftLerp',
            position: () => tmpLerpTargetPos,
            quaternion: () => tmpLerpTargetQuat,
            duration: pickParams.liftDurationMs,
            solveWhileLerping: true,
        };
        if (!pickSequence || pickSequence.stage !== 'liftFlow') return;
        pickSequence.stage = 'lift';
        queueSolveFromTarget();
    });
    renderControl.requestRender();
}

function updateGripFlow() {
    if (!pickSequence || pickSequence.stage !== 'gripFlow' || !actuator) return;
    const cubeItem = pickSequence.cube;
    if (!cubeItem?.mesh?.parent || !cubeItem?.body || !cubeItem?.collider) {
        releaseGraspJoint();
        clearPickLerp();
        pickSequence = null;
        return;
    }
    const toolBody = actuator.getPhysicsBody();
    if (!toolBody) return;
    // Once grasp is locked, do not continue squeezing the jaws.
    if (graspJoint) {
        startLiftAfterGrip(cubeItem);
        return;
    }
    cubeItem.body.wakeUp();
    const candidate = pickJawContactCandidate([cubeItem]);
    if (candidate) {
        if (!graspJoint) {
            createGraspJointForCube(toolBody, candidate);
        }
        if (graspJoint) {
            startLiftAfterGrip(cubeItem);
        }
        return;
    }

    const openRatio = actuator.getOpenRatio();
    if (openRatio <= 0) {
        clearPickLerp();
        pickSequence = null;
        renderControl.requestRender();
        return;
    }

    const gripStep = Math.max(0.002, pickParams.gripCloseStep);
    actuator.setOpenRatio(Math.max(0, openRatio - gripStep));
    queueSolveFromTarget();
    renderControl.requestRender();
}

function runManualGripStep() {
    clearPickLerp();
    pickSequence = null;
    if (!actuator) return false;
    // Anti-penetration guard:
    // after grasp is established, keep current jaw opening and ignore further close commands.
    if (graspJoint && graspedCube) {
        return false;
    }
    const toolBody = actuator.getPhysicsBody();
    const candidate = pickJawContactCandidate(physicsCubes);
    if (candidate && toolBody && !graspJoint) {
        createGraspJointForCube(toolBody, candidate);
        return true;
    }
    if (!candidate) {
        const step = Math.max(0.002, pickParams.gripCloseStep);
        const nextRatio = Math.max(0, actuator.getOpenRatio() - step);
        actuator.setOpenRatio(nextRatio);
        return true;
    }
    return false;
}

function clearPickLerp() {
    // Clearing this resets any in-flight interpolation/wait transition.
    stageLerp = null;
    stageTask = null;
}

function computePickTargetFromCube(cubeItem, hover, outPos, outQuat) {
    if (!cubeItem?.mesh || !outPos || !outQuat) return false;
    cubeItem.mesh.getWorldPosition(tmpPickPos);
    const cubeSize = Number.isFinite(cubeItem.size) ? cubeItem.size : pickParams.cubeSize;
    const hoverOffset = Number.isFinite(hover) ? hover : pickParams.graspHover;
    const half = Math.max(0.001, cubeSize) * 0.5;

    if (actuator) {
        actuator.computeTopDownPickPose(tmpPickPos, cubeSize, hoverOffset, outPos, outQuat);
        return true;
    }
    outPos.set(tmpPickPos.x, tmpPickPos.y + half + Math.max(0, hoverOffset), tmpPickPos.z);
    outQuat.identity();
    return true;
}

function startStageTask(taskFactory, context = {}) {
    if (!ikTarget || typeof taskFactory !== 'function') return false;
    const iterator = taskFactory(context);
    if (!iterator || typeof iterator.next !== 'function') return false;
    stageTask = { iterator };
    return startNextStageStep();
}

function startNextStageStep(lastStep = null) {
    if (!ikTarget || !stageTask?.iterator) {
        stageTask = null;
        stageLerp = null;
        return false;
    }

    let nextState;
    try {
        nextState = stageTask.iterator.next(lastStep);
    } catch {
        stageTask = null;
        stageLerp = null;
        return false;
    }
    if (!nextState || nextState.done === true) {
        stageTask = null;
        stageLerp = null;
        return false;
    }

    const step = nextState.value ?? {};
    const durationMs = Math.max(1, Number.isFinite(step.duration) ? step.duration : 1);
    const solveWhileLerping = step.solveWhileLerping === true;
    resolveStageStepPosition(step.position, tmpStageTaskPos);
    resolveStageStepQuaternion(step.quaternion, tmpStageTaskQuat);

    stageLerp = {
        name: typeof step.name === 'string' ? step.name : '',
        startMs: performance.now(),
        durationMs,
        solveWhileLerping,
        fromPos: ikTarget.object.position.clone(),
        fromQuat: ikTarget.object.quaternion.clone(),
        toPos: tmpStageTaskPos.clone(),
        toQuat: tmpStageTaskQuat.clone(),
    };
    return true;
}

function resolveStageStepPosition(source, out) {
    if (!ikTarget) return out.set(0, 0, 0);
    if (typeof source === 'function') {
        source = source();
    }
    if (source?.isVector3 === true) {
        return out.copy(source);
    }
    if (Array.isArray(source) && source.length >= 3) {
        return out.set(source[0], source[1], source[2]);
    }
    return out.copy(ikTarget.object.position);
}

function resolveStageStepQuaternion(source, out) {
    if (!ikTarget) return out.identity();
    if (typeof source === 'function') {
        source = source();
    }
    if (source?.isQuaternion === true) {
        return out.copy(source);
    }
    if (Array.isArray(source) && source.length >= 4) {
        return out.set(source[0], source[1], source[2], source[3]).normalize();
    }
    return out.copy(ikTarget.object.quaternion);
}

function updateStageLerp() {
    if (!stageLerp || !ikTarget) return false;
    const now = performance.now();
    const t = Math.min(1, (now - stageLerp.startMs) / stageLerp.durationMs);
    ikTarget.object.position.lerpVectors(stageLerp.fromPos, stageLerp.toPos, t);
    ikTarget.object.quaternion.copy(stageLerp.fromQuat).slerp(stageLerp.toQuat, t);
    ikTarget.object.updateMatrixWorld(true);
    if (stageLerp.solveWhileLerping) {
        queueSolveFromTarget();
    }

    if (t >= 1) {
        const finished = { name: stageLerp.name };
        if (!startNextStageStep(finished)) {
            stageLerp = null;
        }
    }
    return true;
}

function setPickTargetToContainer(hover) {
    if (!ikTarget) return false;
    const hoverOffset = Number.isFinite(hover) ? hover : pickParams.graspHover;
    getContainerDropPoint(tmpContainerPos);

    tmpLerpTargetPos.set(tmpContainerPos.x, hoverOffset, tmpContainerPos.z);
    if (actuator) {
        actuator.getVerticalGripQuaternion(tmpVerticalGraspQuat);
        tmpLerpTargetQuat.copy(tmpVerticalGraspQuat);
    } else {
        tmpLerpTargetQuat.identity();
    }
    return true;
}

function getOpenStageHover(cubeItem) {
    const cubeSize = Number.isFinite(cubeItem?.size) ? cubeItem.size : pickParams.cubeSize;
    // setPickTargetFromCube uses: y = center + 0.5*size + hover
    // To reach y = center + 2*size for the open stage, hover = 1.5*size.
    return Math.max(0, cubeSize * 1.5);
}

function getDescendStageHover(cubeItem) {
    const cubeSize = Number.isFinite(cubeItem?.size) ? cubeItem.size : pickParams.cubeSize;
    return -Math.min(Math.max(cubeSize * 0.9 + 0.012, 0.018), 0.05);
}

function startPickSequence(cubeItem) {
    if (!cubeItem || !ikTarget) return;
    if (graspJoint) {
        console.warn('[IK Pick] Gripper is holding an object. Click Drop to release first.');
        return;
    }
    clearPickLerp();
    pickSequence = { cube: cubeItem, stage: 'approachFlow' };
    const ok = computePickTargetFromCube(cubeItem, getOpenStageHover(cubeItem), tmpLerpTargetPos, tmpLerpTargetQuat);
    if (!ok) return;
    startStageTask(function* () {
        yield {
            name: 'approachLerp',
            position: () => tmpLerpTargetPos,
            quaternion: () => tmpLerpTargetQuat,
            duration: pickParams.approachDurationMs,
            solveWhileLerping: true,
        };
        if (!pickSequence || pickSequence.stage !== 'approachFlow') return;
        pickSequence.stage = 'approach';
        queueSolveFromTarget();
    }, { cubeItem });
    renderControl.requestRender();
}

function positiveModulo(value, mod) {
    const out = value % mod;
    return out < 0 ? out + mod : out;
}

function isAngleWithinRangeDeg(angleDeg, minDeg, maxDeg) {
    const rawSpan = maxDeg - minDeg;
    if (rawSpan >= 360 || rawSpan <= -360) return true;

    let span = positiveModulo(rawSpan, 360);
    if (span <= 1e-9 && maxDeg !== minDeg) {
        span = 360;
    }
    if (span <= 1e-9) {
        const delta = Math.abs(positiveModulo(angleDeg - minDeg + 180, 360) - 180);
        return delta <= 1e-6;
    }

    const phase = positiveModulo(angleDeg - minDeg, 360);
    return phase <= span;
}

function getBaseAngleRangeCheck(cubeItem) {
    const baseJointNode = chain?.joints?.[0] || null;
    const baseJoint = kukaKr5[0];
    const minAngleDeg = Number.isFinite(baseJointNode?.minAngle)
        ? baseJointNode.minAngle
        : (Number.isFinite(baseJoint?.minAngle) ? baseJoint.minAngle : null);
    const maxAngleDeg = Number.isFinite(baseJointNode?.maxAngle)
        ? baseJointNode.maxAngle
        : (Number.isFinite(baseJoint?.maxAngle) ? baseJoint.maxAngle : null);
    const parentFrame = baseJointNode?.parent || chain?.robotContainer || null;
    if (!Number.isFinite(minAngleDeg) || !Number.isFinite(maxAngleDeg) || !cubeItem?.mesh || !parentFrame) {
        return { valid: true };
    }

    cubeItem.mesh.getWorldPosition(tmpCubeWorldPos);
    tmpCubeLocalPos.copy(tmpCubeWorldPos);
    parentFrame.worldToLocal(tmpCubeLocalPos);

    const planarRadius2 = tmpCubeLocalPos.x * tmpCubeLocalPos.x + tmpCubeLocalPos.y * tmpCubeLocalPos.y;
    if (planarRadius2 <= 1e-10) {
        return {
            valid: true,
            baseDhAngleDeg: 0,
            minAngleDeg,
            maxAngleDeg,
        };
    }

    // Joint rotates around local +Z, so the limit sector is on the local XY plane.
    const baseDhAngleDeg = THREE.MathUtils.radToDeg(Math.atan2(tmpCubeLocalPos.y, tmpCubeLocalPos.x));
    const valid = isAngleWithinRangeDeg(baseDhAngleDeg, minAngleDeg, maxAngleDeg);
    return {
        valid,
        baseDhAngleDeg,
        minAngleDeg,
        maxAngleDeg,
    };
}

function advancePickSequence() {
    if (!pickSequence) return;
    const cubeItem = pickSequence.cube;
    if (!cubeItem?.mesh?.parent) {
        clearPickLerp();
        pickSequence = null;
        return;
    }

    if (pickSequence.stage === 'approach') {
        pickSequence.stage = 'approachFlow';
        startStageTask(function* () {
            yield {
                name: 'waitOpen',
                duration: pickParams.stageDelayMs,
                solveWhileLerping: false,
            };
            if (!pickSequence || pickSequence.stage !== 'approachFlow') return;
            actuator?.open();

            yield {
                name: 'waitDescend',
                duration: pickParams.stageDelayMs,
                solveWhileLerping: false,
            };
            if (!pickSequence || pickSequence.stage !== 'approachFlow') return;
            const ok = computePickTargetFromCube(cubeItem, getDescendStageHover(cubeItem), tmpLerpTargetPos, tmpLerpTargetQuat);
            if (!ok) {
                pickSequence.stage = 'descend';
                pickSequence.descendStartedMs = performance.now();
                queueSolveFromTarget();
                return;
            }
            yield {
                name: 'descendLerp',
                position: () => tmpLerpTargetPos,
                quaternion: () => tmpLerpTargetQuat,
                duration: pickParams.descendDurationMs,
                solveWhileLerping: true,
            };
            if (!pickSequence || pickSequence.stage !== 'approachFlow') return;
            pickSequence.stage = 'descend';
            pickSequence.descendStartedMs = performance.now();
            queueSolveFromTarget();
            renderControl.requestRender();
        });
        return;
    }

    if (pickSequence.stage === 'descend') {
        pickSequence.stage = 'gripFlow';
        renderControl.requestRender();
        return;
    }

    if (pickSequence.stage === 'gripFlow') {
        return;
    }

    if (pickSequence.stage === 'lift') {
        pickSequence.stage = 'carryFlow';
        startStageTask(function* () {
            yield {
                name: 'waitCarry',
                duration: pickParams.stageDelayMs,
                solveWhileLerping: false,
            };
            if (!pickSequence || pickSequence.stage !== 'carryFlow') return;
            const ok = setPickTargetToContainer(pickParams.graspHover);
            if (!ok) {
                pickSequence.stage = 'carryToContainer';
                queueSolveFromTarget();
                return;
            }
            yield {
                name: 'carryLerp',
                position: () => tmpLerpTargetPos,
                quaternion: () => tmpLerpTargetQuat,
                duration: pickParams.carryDurationMs,
                solveWhileLerping: true,
            };
            if (!pickSequence || pickSequence.stage !== 'carryFlow') return;
            pickSequence.stage = 'carryToContainer';
            queueSolveFromTarget();
            renderControl.requestRender();
        });
        return;
    }

    if (pickSequence.stage === 'carryToContainer') {
        pickSequence.stage = 'dropFlow';
        startStageTask(function* () {
            yield {
                name: 'waitDrop',
                duration: pickParams.stageDelayMs,
                solveWhileLerping: false,
            };
            if (!pickSequence || pickSequence.stage !== 'dropFlow') return;
            actuator?.open();
            clearPickLerp();
            pickSequence = null;
            renderControl.requestRender();
        });
    }
}

function onScenePickClick(event) {
    if (event.button !== 0 || !ikTarget || !renderer || !camera) return;
    if (isDraggingTarget || ikTarget.controls?.dragging) return;
    if (physicsCubes.length === 0) return;

    const rect = renderer.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    pickPointerNdc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pickPointerNdc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    pickRaycaster.setFromCamera(pickPointerNdc, camera);

    const meshes = physicsCubes.map((item) => item.mesh);
    const hit = pickRaycaster.intersectObjects(meshes, false)[0];
    const picked = hit?.object?.userData?.pickCube;
    if (!picked) return;
    const baseAngleCheck = getBaseAngleRangeCheck(picked);
    if (!baseAngleCheck.valid) {
        alert(
            `This cube is outside the base joint angle range and cannot be picked.\nCurrent angle: ${baseAngleCheck.baseDhAngleDeg.toFixed(1)} deg\nAllowed range: [${baseAngleCheck.minAngleDeg} deg, ${baseAngleCheck.maxAngleDeg} deg]`
        );
        return;
    }
    startPickSequence(picked);
}

function stepPhysics() {
    if (!physicsReady || !physicsWorld) return false;
    actuator?.syncPhysics?.();
    if (graspJoint && graspedCube?.body) {
        graspedCube.body.wakeUp();
    }
    physicsWorld.step();
    if (graspJoint && actuator && graspedCube) {
        const jawGap = actuator.getJawInnerGap();
        const cubeSize = Number.isFinite(graspedCube.size) ? graspedCube.size : pickParams.cubeSize;
        const isOpening = Number.isFinite(prevJawInnerGap) && jawGap > (prevJawInnerGap + JAW_GAP_OPEN_EPS);
        if (jawGap >= cubeSize && isOpening) {
            releaseGraspJoint();
        }
    }
    if (graspJoint && !graspedCube?.mesh?.parent) {
        releaseGraspJoint();
    }
    updateGripFlow();
    if (isGripButtonHeld) {
        runManualGripStep();
    }
    prevJawInnerGap = actuator ? actuator.getJawInnerGap() : null;

    let hasActiveBody = false;
    for (const item of physicsCubes) {
        const t = item.body.translation();
        const r = item.body.rotation();
        item.mesh.position.set(t.x, t.y, t.z);
        item.mesh.quaternion.set(r.x, r.y, r.z, r.w);
        if (!item.body.isSleeping()) {
            hasActiveBody = true;
        }
    }

    return hasActiveBody;
}

function syncTargetFromActuator() {
    if (!ikTarget || !actuator) return;
    actuator.getGripWorldPosition(ikTarget.object.position);
    actuator.getGripWorldQuaternion(ikTarget.object.quaternion);
    ikTarget.object.updateMatrixWorld(true);
    syncPendingTargetFromControl();
}

function buildKuka() {
    qCurrent = kukaKr5.map((segment) => THREE.MathUtils.degToRad(Number.isFinite(segment.theta) ? segment.theta : 0));
    applyQToChain(qCurrent, { syncToolEuler: true, syncReachRange: true });
    releaseGraspJoint();
    actuator?.open();
    syncTargetFromActuator();
    renderControl.requestRender();
}

function updateArm() {
    applyQToChain(qCurrent, { syncToolEuler: true, syncReachRange: true });
    renderControl.requestRender();
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
    if (!chain.robotContainer || !actuator?.object) return;
    actuator.attach(chain, { preserveWorld: false });
}

function updateActuator() {
    if (!actuator) return;
    actuator.setToolEulerDeg(actuatorParams.toolEuler.x, actuatorParams.toolEuler.y, actuatorParams.toolEuler.z);
}

function syncChainAttachments({ syncToolEuler = false, syncReachRange = false } = {}) {
    attachActuator();
    if (syncToolEuler) {
        updateActuator();
    }
    if (syncReachRange) {
        updateReachRangePose();
    }
    if (chainSolver) chainSolver.joints = chain.joints;
}

function applyQToChain(q, { syncToolEuler = false, syncReachRange = false } = {}) {
    chain.update(getDhParametersFromQ(q), styleParams, baseParams);
    syncChainAttachments({ syncToolEuler, syncReachRange });
}

function queueSolveFromTarget() {
    if (!chain.roboticArm) return;

    syncPendingTargetFromControl();
    pendingSolve = true;
    solveActive = true;
    renderControl.requestRender();
}

function syncPendingTargetFromControl() {
    if (!ikTarget) return;
    ikTarget.object.getWorldPosition(tmpGripTargetPos);
    ikTarget.object.getWorldQuaternion(tmpGripTargetQuat);
    if (actuator) {
        actuator.computeEndTargetFromGripTarget(tmpGripTargetPos, tmpGripTargetQuat, pendingTarget, pendingTargetQuat);
        return;
    }
    pendingTarget.copy(tmpGripTargetPos);
    pendingTargetQuat.copy(tmpGripTargetQuat);
}

function solveIfPending() {
    if ((!pendingSolve && !solveActive) || isSolving || !chain.roboticArm) return;
    pendingSolve = false;

    chainSolver.targetPosition.copy(pendingTarget);
    chainSolver.targetQuaternion.copy(pendingTargetQuat);
    isSolving = true;
    try {
        qCurrent = chainSolver.solve(qCurrent);
        applyQToChain(qCurrent, { syncToolEuler: false, syncReachRange: false });
    } finally {
        isSolving = false;
    }

    const remainingError = chainSolver.computeSolveErrorNorm(qCurrent);
    const remainingPosError = chainSolver.computePositionError(qCurrent).length();
    const stagePosTolerance = pickSequence?.stage === 'descend'
        ? Math.min(targetTolerance, DESCEND_STAGE_TOLERANCE)
        : Math.max(targetTolerance, PICK_STAGE_POSITION_TOLERANCE);
    const descendContactReady = pickSequence?.stage === 'descend'
        && pickSequence?.cube
        && pickJawContactCandidate([pickSequence.cube]) !== null;
    const descendTimedOut = pickSequence?.stage === 'descend'
        && Number.isFinite(pickSequence?.descendStartedMs)
        && (performance.now() - pickSequence.descendStartedMs) >= DESCEND_STAGE_TIMEOUT_MS;
    const converged = pickSequence
        ? (remainingPosError <= stagePosTolerance || descendContactReady || descendTimedOut)
        : remainingError <= targetTolerance;

    if (!converged) {
        solveActive = true;
        pendingSolve = true;
    } else {
        solveActive = false;
        if (pickSequence && !stageLerp) {
            advancePickSequence();
        }
    }
}

function resetAll() {
    pendingSolve = false;
    solveActive = false;
    isSolving = false;
    clearPickLerp();
    pickSequence = null;
    solverParams.target = 'Position';
    if (targetModeBinding && typeof targetModeBinding.refresh === 'function') {
        targetModeBinding.refresh();
    }
    if (ikTarget?.controls) {
        ikTarget.controls.setMode('translate');
    }
    if (actuator?.object) {
        actuator.object.rotation.set(0, 0, 0);
    }
    isGripButtonHeld = false;
    releaseGraspJoint();
    actuatorParams.toolEuler.x = 0;
    actuatorParams.toolEuler.y = -90;
    actuatorParams.toolEuler.z = 0;
    clearPickCubes();
    buildKuka();
}

function onResize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderControl.requestRender();
}

function renderFrame() {
    const lerping = updateStageLerp();
    solveIfPending();
    const physicsActive = stepPhysics();
    updateReachRangePose();
    updatePhysicsDebugLines();
    renderer.render(scene, camera);
    if (pendingSolve || solveActive || isSolving || physicsActive || lerping || stageLerp || isGripButtonHeld) {
        renderControl.requestRender();
    }
}
