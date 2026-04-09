import { BoxGeometry, BufferAttribute, BufferGeometry, Color, DoubleSide, GridHelper, Group, LineBasicMaterial, LineLoop, LineSegments, MathUtils, Mesh, MeshBasicMaterial, Object3D, PerspectiveCamera, Raycaster, RepeatWrapping, SRGBColorSpace, Scene, SphereGeometry, TextureLoader, Vector2, Vector3, WebGLRenderer } from 'three';
import { ColliderDesc, RigidBodyDesc, World, init as initRapier } from '@dimforge/rapier3d-compat';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { Pane } from 'tweakpane';
import { getAssetURL, getRenderLoopController } from '../extend/tools/Tool.js';
import { Actuator, Chain } from '../extend/kinematic/Chain.js';
import ChainController, {
    getBaseAngleRangeCheck,
    createDhParametersFromJointState,
    createInitialJointState,
    kukaKr5ChainProfile,
} from '../extend/kinematic/ChainController.js';
import { SequencePlayer } from '../extend/kinematic/Sequence.js';

let scene, camera, renderer, controls, pane;
let chain;
let ikTarget;
let sequencePlayer;
let chainController;
let targetModeBinding;
let isDraggingTarget = false;
const tmpSpawnTargetPos = new Vector3();
const tmpBasePos = new Vector3();
const pickRaycaster = new Raycaster();
const pickPointerNdc = new Vector2();
let targetTolerance = 1e-2;
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
const cubeGeometry = new BoxGeometry(1, 1, 1);
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

const kukaKr5Profile = kukaKr5ChainProfile;

init().catch((error) => {
    console.error('[IK Pick] init failed:', error);
});

async function init() {
    scene = new Scene();
    scene.background = new Color(BG_COLOR);

    camera = new PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(2, 2, 2);

    renderer = new WebGLRenderer({ antialias: true });
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

    const gridHelper = new GridHelper(8, 8);
    scene.add(gridHelper);
    await initPhysics();

    chain = new Chain(scene);
    chain.attachActuator(new Actuator({
        scene,
        physicsWorld,
        toolEulerDeg: actuatorParams.toolEuler,
    }), { preserveWorld: false });
    ikTarget = createIKTarget(scene, camera, renderer.domElement);
    ikTarget.controls.visible = actuatorParams.showHelper === true;
    ikTarget.marker.visible = actuatorParams.showHelper === true;
    chainController = new ChainController({
        chain,
        getSequencePlayer: () => sequencePlayer,
        profile: kukaKr5Profile,
        styleParams,
        baseParams,
        createInitialJointStateFn: createInitialJointState,
        createDhParametersFromJointStateFn: createDhParametersFromJointState,
        getToolEuler: () => actuatorParams.toolEuler,
        updateReachRangePose,
    });
    sequencePlayer = new SequencePlayer({
        getTargetObject: () => ikTarget?.object ?? null,
        chain,
        requestRender: () => renderControl.requestRender(),
        now: () => performance.now(),
        getPickParams: () => pickParams,
        getContainerDropPoint,
        getPhysicsWorld: () => physicsWorld,
        getPhysicsCubes: () => physicsCubes,
        isCubeValid: (cubeItem) => Boolean(cubeItem?.mesh?.parent),
        defaultInteractionGroups: DEFAULT_INTERACTION_GROUPS,
        heldCubeInteractionGroups: HELD_CUBE_INTERACTION_GROUPS,
        jawGapOpenEps: JAW_GAP_OPEN_EPS,
        forwardKinematics: (q, options) => chainController?.updateJointState(q, options),
        applyQToChain: (q, options) => chainController?.rebuildJointState(q, options),
        getInitialQ: () => createInitialJointState(kukaKr5Profile),
        maxIter: solverParams.maxIter,
        alpha: solverParams.alpha,
        tolerance: solverParams.tolerance,
        solveMode: solverParams.solveMode,
        debug: solverParams.debug,
    });
    ikTarget.controls.addEventListener('dragging-changed', (event) => {
        controls.enabled = !event.value;
        isDraggingTarget = event.value === true;
        if (!isDraggingTarget) {
            sequencePlayer?.queueSolveFromTarget();
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
        sequencePlayer?.setSolverConfig({ debug: ev.value === true });
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
            sequencePlayer?.setSolverConfig({ maxIter: ev.value });
        });
    controlsFolder
        .addBinding(solverParams, 'alpha', { label: 'Alpha', min: 0.001, max: 0.5, step: 0.001 })
        .on('change', (ev) => {
            sequencePlayer?.setSolverConfig({ alpha: ev.value });
        });
    controlsFolder
        .addBinding(solverParams, 'tolerance', { label: 'Tolerance', min: 1e-5, max: 1e-1, step: 1e-5 })
        .on('change', (ev) => {
            sequencePlayer?.setSolverConfig({ tolerance: ev.value });
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
        sequencePlayer?.reset();
        chain?.openActuator?.();
        renderControl.requestRender();
    });
    pickFolder.expanded = true;

    buildKuka({ requestRender: false });
    createFixedDropLathe();
    rebuildReachRangeRings();
    updateReachRangePose();
    spawnPickCubes({ requestRender: false });

    window.addEventListener('resize', onResize);
    renderer.domElement.addEventListener('click', onScenePickClick);
    renderControl.requestRender();
}

function createIKTarget(sceneRef, cameraRef, domElement) {
    const object = new Object3D();
    object.name = 'ikTarget';
    object.matrixAutoUpdate = true;
    sceneRef.add(object);

    const marker = new Mesh(
        new SphereGeometry(0.03, 16, 12),
        new MeshBasicMaterial({ color: 0xff4444 })
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
    await initRapier();

    physicsWorld = new World({ x: 0, y: -9.81, z: 0 });
    createPhysicsGround();
    physicsReady = true;
}

function createPhysicsGround() {
    const ground = new Mesh(
        new BoxGeometry(8, 0.1, 8),
        new MeshBasicMaterial({
            color: 0x4a5560,
        }),
    );
    ground.position.y = -0.05;
    scene.add(ground);

    const groundBody = physicsWorld.createRigidBody(
        RigidBodyDesc.fixed().setTranslation(0, -0.05, 0),
    );
    physicsWorld.createCollider(
        ColliderDesc.cuboid(4, 0.05, 4).setFriction(0.9).setRestitution(0.05),
        groundBody,
    );
}

function ensurePhysicsDebugLines() {
    if (physicsDebugLines || !scene) return;
    const geometry = new BufferGeometry();
    const material = new LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.75,
        depthWrite: false,
    });
    physicsDebugLines = new LineSegments(geometry, material);
    physicsDebugLines.name = 'physics_debug_lines';
    physicsDebugLines.frustumCulled = false;
    physicsDebugLines.renderOrder = 1000;
    physicsDebugLines.visible = false;
    scene.add(physicsDebugLines);
}

function updatePhysicsDebugLines() {
    if (!physicsWorld) return false;
    if (!helperParams.showPhysicsColliders) {
        if (physicsDebugLines) {
            physicsDebugLines.visible = false;
        }
        return false;
    }
    ensurePhysicsDebugLines();
    if (!physicsDebugLines) return false;

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
    const showColliderAxes = helperParams.showColliderAxes === true;
    if (!showColliderAxes) {
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
    geometry.setAttribute('position', new BufferAttribute(drawVertices, 3));
    geometry.setAttribute('color', new BufferAttribute(physicsDebugRgbBuffer, 3));
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

    const group = new Group();
    group.name = 'fixedDropLathe';
    group.position.set(tmpSpawnTargetPos.x, 0.005, tmpSpawnTargetPos.z);

    const texture = new TextureLoader().load(GRID_TEXTURE_URL, () => {
        renderControl.requestRender();
    });
    texture.wrapS = RepeatWrapping;
    texture.wrapT = RepeatWrapping;
    texture.repeat.set(2, 2);
    texture.colorSpace = SRGBColorSpace;
    const material = new MeshBasicMaterial({
        map: texture,
        color: 0xffffff,
        wireframe: false,
        side: DoubleSide,
    });

    const floor = new Mesh(
        new BoxGeometry(innerHalf * 2, floorThickness, innerHalf * 2),
        material,
    );
    floor.position.y = floorThickness * 0.5;
    group.add(floor);

    const wallXPos = new Mesh(
        new BoxGeometry(wallThickness, CONTAINER_RIM_HEIGHT, wallHalfLong * 2),
        material,
    );
    wallXPos.position.set(wallCenter, wallHalfHeight, 0);
    group.add(wallXPos);

    const wallXNeg = wallXPos.clone();
    wallXNeg.position.x = -wallCenter;
    group.add(wallXNeg);

    const wallZPos = new Mesh(
        new BoxGeometry(wallHalfLong * 2, CONTAINER_RIM_HEIGHT, wallThickness),
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
        RigidBodyDesc.fixed().setTranslation(position.x, position.y, position.z),
    );

    const { wallThickness, floorThickness, innerHalf, wallHalfHeight, wallCenter, wallHalfLong } = getContainerDims();

    const floor = physicsWorld.createCollider(
        ColliderDesc.cuboid(innerHalf, floorThickness * 0.5, innerHalf)
            .setTranslation(0, floorThickness * 0.5, 0)
            .setFriction(0.9),
        containerBody,
    );
    containerColliders.push(floor);

    const wallXPos = physicsWorld.createCollider(
        ColliderDesc.cuboid(wallThickness * 0.5, wallHalfHeight, wallHalfLong)
            .setTranslation(wallCenter, wallHalfHeight, 0)
            .setFriction(0.9),
        containerBody,
    );
    containerColliders.push(wallXPos);

    const wallXNeg = physicsWorld.createCollider(
        ColliderDesc.cuboid(wallThickness * 0.5, wallHalfHeight, wallHalfLong)
            .setTranslation(-wallCenter, wallHalfHeight, 0)
            .setFriction(0.9),
        containerBody,
    );
    containerColliders.push(wallXNeg);

    const wallZPos = physicsWorld.createCollider(
        ColliderDesc.cuboid(wallHalfLong, wallHalfHeight, wallThickness * 0.5)
            .setTranslation(0, wallHalfHeight, wallCenter)
            .setFriction(0.9),
        containerBody,
    );
    containerColliders.push(wallZPos);

    const wallZNeg = physicsWorld.createCollider(
        ColliderDesc.cuboid(wallHalfLong, wallHalfHeight, wallThickness * 0.5)
            .setTranslation(0, wallHalfHeight, -wallCenter)
            .setFriction(0.9),
        containerBody,
    );
    containerColliders.push(wallZNeg);
}

function getContainerDropPoint(out = new Vector3()) {
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
    pickParams.innerRadius = MathUtils.clamp(pickParams.innerRadius, 0, pickParams.outerRadius - 1e-4);
}

function createRing(radius, color) {
    const segments = 96;
    const points = [];
    for (let i = 0; i < segments; i++) {
        const t = (i / segments) * Math.PI * 2;
        points.push(new Vector3(Math.cos(t) * radius, 0, Math.sin(t) * radius));
    }
    const geometry = new BufferGeometry().setFromPoints(points);
    const material = new LineBasicMaterial({ color });
    return new LineLoop(geometry, material);
}

function rebuildReachRangeRings() {
    sanitizePickRadii();
    if (!reachRangeGroup) {
        reachRangeGroup = new Group();
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

function spawnPickCubes({ requestRender = true } = {}) {
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
        const r2 = MathUtils.lerp(minRadius * minRadius, maxRadius * maxRadius, Math.random());
        const radius = Math.sqrt(r2);
        const x = tmpBasePos.x + Math.cos(angle) * radius;
        const y = baseY + Math.random() * 0.25;
        const z = tmpBasePos.z + Math.sin(angle) * radius;

        const body = physicsWorld.createRigidBody(
            RigidBodyDesc.dynamic()
                .setTranslation(x, y, z)
                .setLinearDamping(0.2)
                .setAngularDamping(0.3)
                .setCcdEnabled(true),
        );
        const collider = physicsWorld.createCollider(
            ColliderDesc.cuboid(size * 0.5, size * 0.5, size * 0.5)
                .setFriction(0.8)
                .setRestitution(0.1),
            body,
        );

        const randomColor = new Color().setHSL(Math.random(), 0.75, 0.55);
        const mesh = new Mesh(cubeGeometry, new MeshBasicMaterial({ color: randomColor }));
        mesh.scale.set(size, size, size);
        mesh.position.set(x, y, z);
        scene.add(mesh);

        const cubeItem = {
            body,
            collider,
            mesh,
            size,
            isSleeping: false,
            savedCollisionGroups: null,
            savedSolverGroups: null,
            gripFilterApplied: false,
        };
        mesh.userData.pickCube = cubeItem;
        physicsCubes.push(cubeItem);
    }

    if (requestRender) {
        renderControl.requestRender();
    }
}

function clearPickCubes({ requestRender = true } = {}) {
    sequencePlayer?.reset();
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
    if (requestRender) {
        renderControl.requestRender();
    }
}

function runManualGripStep() {
    return sequencePlayer?.runManualGripStep() === true;
}

function startPickSequence(cubeItem) {
    if (!cubeItem || !ikTarget) return;
    if (sequencePlayer?.hasGraspJoint()) {
        console.warn('[IK Pick] Gripper is holding an object. Click Drop to release first.');
        return;
    }
    sequencePlayer?.startPickSequence(cubeItem);
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
    const baseAngleCheck = getBaseAngleRangeCheck({ chain, cubeItem: picked, profile: kukaKr5Profile });
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
    chain?.getActuator?.()?.syncPhysics?.();
    sequencePlayer?.beforePhysicsStep();
    physicsWorld.step();
    sequencePlayer?.afterPhysicsStep();
    if (isGripButtonHeld) {
        runManualGripStep();
    }

    let hasActiveBody = false;
    for (const item of physicsCubes) {
        const isSleeping = item.body.isSleeping();
        if (!isSleeping || item.isSleeping === false) {
            const t = item.body.translation();
            const r = item.body.rotation();
            item.mesh.position.set(t.x, t.y, t.z);
            item.mesh.quaternion.set(r.x, r.y, r.z, r.w);
        }
        item.isSleeping = isSleeping;
        if (!isSleeping) {
            hasActiveBody = true;
        }
    }

    return hasActiveBody;
}

function buildKuka({ requestRender = true } = {}) {
    chainController?.build({ targetObject: ikTarget?.object });
    if (requestRender) {
        renderControl.requestRender();
    }
}

function updateArm() {
    chainController?.updateArm();
    renderControl.requestRender();
}

function solveIfPending() {
    sequencePlayer?.solveIfPending({
        targetTolerance,
        pickStagePositionTolerance: PICK_STAGE_POSITION_TOLERANCE,
        descendStageTolerance: DESCEND_STAGE_TOLERANCE,
        descendTimeoutMs: DESCEND_STAGE_TIMEOUT_MS,
    });
}

function resetAll() {
    sequencePlayer?.reset();
    solverParams.target = 'Position';
    if (targetModeBinding && typeof targetModeBinding.refresh === 'function') {
        targetModeBinding.refresh();
    }
    if (ikTarget?.controls) {
        ikTarget.controls.setMode('translate');
    }
    const actuator = chain?.getActuator?.();
    if (actuator?.object) {
        actuator.object.rotation.set(0, 0, 0);
    }
    isGripButtonHeld = false;
    sequencePlayer?.releaseGraspJoint();
    actuatorParams.toolEuler.x = 0;
    actuatorParams.toolEuler.y = -90;
    actuatorParams.toolEuler.z = 0;
    clearPickCubes({ requestRender: false });
    buildKuka({ requestRender: false });
    renderControl.requestRender();
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
    const lerping = sequencePlayer?.updateStageLerp() === true;
    solveIfPending();
    const physicsActive = stepPhysics();
    updateReachRangePose();
    updatePhysicsDebugLines();
    renderer.render(scene, camera);
    if (sequencePlayer?.hasPendingSolve() || sequencePlayer?.isSolving() || physicsActive || lerping || sequencePlayer?.isLerping() || isGripButtonHeld) {
        renderControl.requestRender();
    }
}
