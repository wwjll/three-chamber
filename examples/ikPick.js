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
const tmpGripWorldPos = new THREE.Vector3();
const tmpGripWorldQuat = new THREE.Quaternion();
const tmpContainerPos = new THREE.Vector3();
const tmpLerpTargetPos = new THREE.Vector3();
const tmpLerpTargetQuat = new THREE.Quaternion();
const tmpCubeWorldPos = new THREE.Vector3();
const tmpCubeLocalPos = new THREE.Vector3();
const pickRaycaster = new THREE.Raycaster();
const pickPointerNdc = new THREE.Vector2();
let solveActive = false;
let targetTolerance = 1e-2;
let pickSequence = null;
let stageLerp = null;
let physicsWorld = null;
let physicsReady = false;
let graspProbeBody = null;
let graspProbeCollider = null;
let grabbedCube = null;
let containerBody = null;
const containerColliders = [];
let reachRangeGroup = null;
let reachInnerRing = null;
let reachOuterRing = null;
let fixedDropLathe = null;
const physicsCubes = [];
const cubeGeometry = new THREE.BoxGeometry(1, 1, 1);

const BG_COLOR = 0x2b2b2b;
const FRAME_RATE = 60;
const PICK_STAGE_DELAY_MS = 50;
const PICK_DESCEND_HOVER = 0.005;
const GRASP_PROBE_RADIUS = 0.035;
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

const pickParams = {
    spawnCount: 6,
    outerRadius: 1.3,
    innerRadius: 1.1,
    dropHeight: 0.35,
    cubeSize: 0.06,
    graspHover: 0.5,
    stageDelayMs: PICK_STAGE_DELAY_MS,
    approachDurationMs: 300,
    descendDurationMs: 100,
    liftDurationMs: 200,
    carryDurationMs: 400,
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
    pickFolder.addButton({ title: 'Spawn Cubes' }).on('click', () => {
        spawnPickCubes();
    });
    pickFolder.addButton({ title: 'Clear Cubes' }).on('click', () => {
        clearPickCubes();
    });
    pickFolder.addButton({ title: 'Drop' }).on('click', () => {
        clearPickLerp();
        pickSequence = null;
        releaseGrabbedCube();
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
    createGraspProbe();
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

function createGraspProbe() {
    if (!physicsWorld || graspProbeBody || graspProbeCollider) return;
    graspProbeBody = physicsWorld.createRigidBody(
        RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, -10, 0),
    );
    graspProbeCollider = physicsWorld.createCollider(
        RAPIER.ColliderDesc.ball(GRASP_PROBE_RADIUS).setSensor(true),
        graspProbeBody,
    );
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
                .setAngularDamping(0.3),
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

        const cubeItem = { body, collider, mesh, size };
        mesh.userData.pickCube = cubeItem;
        physicsCubes.push(cubeItem);
    }

    renderControl.requestRender();
}

function clearPickCubes() {
    clearPickLerp();
    pickSequence = null;
    releaseGrabbedCube();
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

function clearPickLerp() {
    // Clearing this resets any in-flight interpolation/wait transition.
    stageLerp = null;
}

function releaseGrabbedCube() {
    if (!grabbedCube?.body) return;
    grabbedCube.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    grabbedCube = null;
}

function syncGraspProbePose() {
    if (!graspProbeBody || !actuator) return;
    actuator.getGripWorldPosition(tmpGripWorldPos);
    graspProbeBody.setNextKinematicTranslation({
        x: tmpGripWorldPos.x,
        y: tmpGripWorldPos.y,
        z: tmpGripWorldPos.z,
    });
}

function syncGrabbedCubeWithGrip() {
    if (!grabbedCube?.body || !actuator) return;
    actuator.getGripWorldPosition(tmpGripWorldPos);
    actuator.getGripWorldQuaternion(tmpGripWorldQuat);
    grabbedCube.body.setNextKinematicTranslation({
        x: tmpGripWorldPos.x,
        y: tmpGripWorldPos.y,
        z: tmpGripWorldPos.z,
    });
    grabbedCube.body.setNextKinematicRotation({
        x: tmpGripWorldQuat.x,
        y: tmpGripWorldQuat.y,
        z: tmpGripWorldQuat.z,
        w: tmpGripWorldQuat.w,
    });
}

function tryGrabCubeAtGrip() {
    if (!physicsWorld || !graspProbeCollider) return null;
    let candidate = null;
    let bestDist2 = Infinity;
    actuator?.getGripWorldPosition(tmpGripWorldPos);

    for (const item of physicsCubes) {
        if (!item?.collider || !item?.body || item === grabbedCube) continue;
        let intersected = false;
        if (typeof physicsWorld.intersectionPair === 'function') {
            intersected = physicsWorld.intersectionPair(graspProbeCollider, item.collider) === true;
        }
        if (!intersected && typeof physicsWorld.contactPair === 'function') {
            let hasContact = false;
            physicsWorld.contactPair(graspProbeCollider, item.collider, () => {
                hasContact = true;
            });
            intersected = hasContact;
        }
        if (!intersected) continue;

        const p = item.body.translation();
        const dx = p.x - tmpGripWorldPos.x;
        const dy = p.y - tmpGripWorldPos.y;
        const dz = p.z - tmpGripWorldPos.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < bestDist2) {
            bestDist2 = d2;
            candidate = item;
        }
    }

    if (!candidate) return null;
    grabbedCube = candidate;
    grabbedCube.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    syncGrabbedCubeWithGrip();
    return grabbedCube;
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

function startStageLerpFromCurrent(targetPos, targetQuat, durationMs, onComplete = null, solveWhileLerping = true) {
    if (!ikTarget) return;
    stageLerp = {
        startMs: performance.now(),
        durationMs: Math.max(1, Number.isFinite(durationMs) ? durationMs : 1),
        onComplete,
        solveWhileLerping,
        fromPos: ikTarget.object.position.clone(),
        fromQuat: ikTarget.object.quaternion.clone(),
        toPos: targetPos.clone(),
        toQuat: targetQuat.clone(),
    };
}

function startStageWait(durationMs, onComplete = null) {
    if (!ikTarget) return;
    startStageLerpFromCurrent(
        ikTarget.object.position,
        ikTarget.object.quaternion,
        durationMs,
        onComplete,
        false,
    );
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
        const done = stageLerp.onComplete;
        stageLerp = null;
        if (typeof done === 'function') done();
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

function startPickSequence(cubeItem) {
    if (!cubeItem || !ikTarget) return;
    clearPickLerp();
    pickSequence = { cube: cubeItem, stage: 'approachLerp' };
    const ok = computePickTargetFromCube(cubeItem, getOpenStageHover(cubeItem), tmpLerpTargetPos, tmpLerpTargetQuat);
    if (!ok) return;
    startStageLerpFromCurrent(tmpLerpTargetPos, tmpLerpTargetQuat, pickParams.approachDurationMs, () => {
        if (!pickSequence || pickSequence.stage !== 'approachLerp') return;
        pickSequence.stage = 'approach';
        queueSolveFromTarget();
    });
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
        pickSequence.stage = 'waitOpen';
        startStageWait(pickParams.stageDelayMs, () => {
            if (!pickSequence || pickSequence.stage !== 'waitOpen') return;
            actuator?.open();
            pickSequence.stage = 'waitDescend';

            startStageWait(pickParams.stageDelayMs, () => {
                if (!pickSequence || pickSequence.stage !== 'waitDescend') return;
                const ok = computePickTargetFromCube(cubeItem, PICK_DESCEND_HOVER, tmpLerpTargetPos, tmpLerpTargetQuat);
                if (!ok) {
                    pickSequence.stage = 'descend';
                    queueSolveFromTarget();
                    return;
                }
                pickSequence.stage = 'descendLerp';
                startStageLerpFromCurrent(tmpLerpTargetPos, tmpLerpTargetQuat, pickParams.descendDurationMs, () => {
                    if (!pickSequence || pickSequence.stage !== 'descendLerp') return;
                    pickSequence.stage = 'descend';
                    queueSolveFromTarget();
                });
                renderControl.requestRender();
            });
            renderControl.requestRender();
        });
        return;
    }

    if (pickSequence.stage === 'descend') {
        syncGraspProbePose();
        if (!grabbedCube) {
            tryGrabCubeAtGrip();
        }
        actuator?.close();
        const ok = computePickTargetFromCube(cubeItem, pickParams.graspHover, tmpLerpTargetPos, tmpLerpTargetQuat);
        if (!ok) {
            pickSequence.stage = 'lift';
            queueSolveFromTarget();
            return;
        }
        pickSequence.stage = 'liftLerp';
        startStageLerpFromCurrent(tmpLerpTargetPos, tmpLerpTargetQuat, pickParams.liftDurationMs, () => {
            if (!pickSequence || pickSequence.stage !== 'liftLerp') return;
            pickSequence.stage = 'lift';
            queueSolveFromTarget();
        });
        renderControl.requestRender();
        return;
    }

    if (pickSequence.stage === 'lift') {
        pickSequence.stage = 'waitCarry';
        startStageWait(pickParams.stageDelayMs, () => {
            if (!pickSequence || pickSequence.stage !== 'waitCarry') return;
            const ok = setPickTargetToContainer(pickParams.graspHover);
            if (!ok) {
                pickSequence.stage = 'carryToContainer';
                queueSolveFromTarget();
                return;
            }
            pickSequence.stage = 'carryLerp';
            startStageLerpFromCurrent(tmpLerpTargetPos, tmpLerpTargetQuat, pickParams.carryDurationMs, () => {
                if (!pickSequence || pickSequence.stage !== 'carryLerp') return;
                pickSequence.stage = 'carryToContainer';
                queueSolveFromTarget();
            });
            renderControl.requestRender();
        });
        return;
    }

    if (pickSequence.stage === 'carryLerp') {
        return;
    }

    if (pickSequence.stage === 'carryToContainer') {
        pickSequence.stage = 'waitDrop';
        startStageWait(pickParams.stageDelayMs, () => {
            if (!pickSequence || pickSequence.stage !== 'waitDrop') return;
            releaseGrabbedCube();
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
    syncGraspProbePose();
    syncGrabbedCubeWithGrip();
    physicsWorld.step();

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
    if (remainingError > targetTolerance) {
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
    const physicsActive = stepPhysics();
    updateReachRangePose();
    const lerping = updateStageLerp();
    solveIfPending();
    renderer.render(scene, camera);
    if (pendingSolve || solveActive || isSolving || physicsActive || lerping || stageLerp) {
        renderControl.requestRender();
    }
}
