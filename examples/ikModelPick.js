import {
    ACESFilmicToneMapping,
    AmbientLight,
    BoxGeometry,
    Color,
    CylinderGeometry,
    DirectionalLight,
    DoubleSide,
    GridHelper,
    Group,
    HemisphereLight,
    Matrix4,
    MathUtils,
    Mesh,
    MeshBasicMaterial,
    MeshStandardMaterial,
    Object3D,
    PCFSoftShadowMap,
    PerspectiveCamera,
    PlaneGeometry,
    Quaternion,
    Raycaster,
    Scene,
    SphereGeometry,
    SRGBColorSpace,
    TorusGeometry,
    Vector2,
    Vector3,
    WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
    ColliderDesc,
    RigidBodyDesc,
    World,
    init as initRapier,
} from '@dimforge/rapier3d-compat';
import { Actuator, Chain } from '../extend/kinematic/Chain.js';
import {
    createDhParametersFromJointState,
    ur3eChainProfile,
} from '../extend/kinematic/ChainController.js';
import ChainSolver from '../extend/kinematic/ChainSolver.js';
import { SequencePlayer } from '../extend/kinematic/SequencePlayer.js';
import {
    CLOSE_ACTION,
    HOLD_ACTION,
    OPEN_ACTION,
    SequenceGenerator,
} from '../extend/kinematic/SequenceGenerator.js';
import { IndexedDbSequenceStore } from '../extend/kinematic/SequenceStore.js';
import { createUr3eRobotiqRig } from '../extend/kinematic/Ur3eRobotiqRig.js';
import { getAssetURL, getRenderLoopController } from '../extend/tools/Tool.js';

let scene, camera, renderer, controls;
let chain, actuator, chainSolver, robotRig, sequencePlayer, sequenceGenerator;
let sequenceTarget;
let qCurrent = [];
let placedCount = 0;
let physicsWorld = null;
let actuatorColliderDebug = null;
let gripPointDebug = null;
let sequenceStore = null;
let solverMetricOutputs = null;
let lastSolverMetricRevision = -1;

const FRAME_RATE = 60;
const SEQUENCE_STORAGE_ID = 'ik-model-pick-keyframes';
const ROBOT_PEDESTAL_HEIGHT = 0.15;
const ROBOT_PEDESTAL_PLATE_THICKNESS = 0.018;
const ROBOT_PEDESTAL_COLUMN_RADIUS = 0.12;
const ROBOT_PEDESTAL_PLATE_RADIUS = 0.145;
const SOURCE_PLATFORM_Z = 0.4;
const TARGET_PLATFORM_Z = -0.4;
const PLATFORM_TOP_Y = 0.105;
const PLATFORM_TOP_THICKNESS = 0.025;
const BASKET_RIM_HEIGHT = 0.14;
const BASKET_FLOOR_THICKNESS = 0.025;
const BASKET_WALL_THICKNESS = 0.025;
const BASKET_INNER_RADIUS = 0.13;
const BASKET_WALL_SEGMENTS = 24;
const BASKET_DROP_HEIGHT = 0.04;
const CUBE_SIZE = 0.028;
const PAD_APPROACH_HALF_LENGTH = 0.0375 * 0.5;
const TABLE_CLEARANCE = 0.004;
const DEFAULT_Q_SEED = [0, -78, 102, -114, -90, 0].map(MathUtils.degToRad);
const UR3E_MODEL_URL = `${getAssetURL()}models/ur3e/visual/`;
const GRIPPER_MODEL_URL = `${getAssetURL()}models/robotiq-2f-85/visual/`;
const renderLoop = getRenderLoopController();
const pickRaycaster = new Raycaster();
const pickPointer = new Vector2();
const pendingTarget = new Vector3();
const pendingTargetQuaternion = new Quaternion();
const colliderReferenceInverse = new Matrix4();
const colliderWorldMatrix = new Matrix4();
const colliderLocalMatrix = new Matrix4();
const colliderOffsetMatrix = new Matrix4();
const colliderLocalPosition = new Vector3();
const colliderLocalQuaternion = new Quaternion();
const colliderLocalScale = new Vector3();
const basketWallQuaternion = new Quaternion();
const worldUpAxis = new Vector3(0, 1, 0);
const cubes = [];
const INTERACTION_ALL = 0xffff;
const GRIPPER_GROUP = 1 << 1;
const INTERACTION_ALL_BUT_GRIPPER = INTERACTION_ALL & ~GRIPPER_GROUP;
const encodeInteractionGroups = (memberships, filters) => (
    (((memberships & 0xffff) << 16) | (filters & 0xffff)) >>> 0
);
const DEFAULT_INTERACTION_GROUPS = encodeInteractionGroups(
    INTERACTION_ALL,
    INTERACTION_ALL,
);
const HELD_CUBE_INTERACTION_GROUPS = encodeInteractionGroups(
    INTERACTION_ALL,
    INTERACTION_ALL_BUT_GRIPPER,
);

const styleParams = {
    jointColor: 0x7d7d7d,
    linkColor: 0x171a1c,
    randomJointColor: false,
    randomLinkColor: false,
    jointRadius: 0.0125,
    jointHeight: 0.06,
    linkRadius: 0.008,
    trimLinksAtJoints: true,
    linkJointOverlap: 0.01,
    showAxisHelper: false,
    showDOFHelper: false,
    syncUp: true,
};

const baseParams = {
    mdhMode: false,
    baseOffset: { x: 0, y: 0, z: ROBOT_PEDESTAL_HEIGHT },
};

const solverParams = {
    solverMethod: 'DLS',
    maxIter: 24,
    alpha: 0.05,
    tolerance: 0.006,
    damping: 0.04,
    dlsMaxDelta: 0.08,
    rotationWeight: 0.25,
    rotationTolerance: 0.03,
    constrainOrientation: true,
    debug: false,
};

const moveParams = {
    gripDurationMs: 450,
};

const DYNAMIC_CUBE_TARGET_KIND = 'ikModelPickCubeTarget';
const PLAYBACK_MODE_PREVIEW = 'trajectoryPreview';
const PLAYBACK_MODE_PICK = 'pickAndReturn';

function getSolverMode() {
    return solverParams.constrainOrientation
        ? 'Position + Rotation'
        : 'Position Only';
}

const ur3eMaterials = {
    linkGrey: new MeshStandardMaterial({
        color: 0xd1d1d1,
        roughness: 0.42,
        metalness: 0.32,
    }),
    jointGrey: new MeshStandardMaterial({
        color: 0x474747,
        roughness: 0.46,
        metalness: 0.32,
    }),
    urBlue: new MeshStandardMaterial({
        color: 0x7dadcc,
        roughness: 0.38,
        metalness: 0.18,
    }),
    black: new MeshStandardMaterial({
        color: 0x101010,
        roughness: 0.58,
        metalness: 0.2,
    }),
    gripperBlueGrey: new MeshStandardMaterial({
        color: 0xcad1ee,
        roughness: 0.46,
        metalness: 0.22,
    }),
    gripperBlack: new MeshStandardMaterial({
        color: 0x181a1c,
        roughness: 0.56,
        metalness: 0.18,
    }),
};

const sourceCubePositions = [
    [-0.08, SOURCE_PLATFORM_Z - 0.035],
    [0, SOURCE_PLATFORM_Z - 0.035],
    [0.08, SOURCE_PLATFORM_Z - 0.035],
    [-0.04, SOURCE_PLATFORM_Z + 0.045],
    [0.04, SOURCE_PLATFORM_Z + 0.045],
];

const defaultRecordedKeyframes = [
    {
        label: 'Keyframe 1',
        position: [0.015, 0.289, 0.381],
        rotation: [-0.8, 1.2, -88.8],
        chainPose: [
            71.3,
            -76.1,
            83.4,
            -97.6,
            -88.6,
            70.2,
        ].map((value) => MathUtils.degToRad(value)),
    },
    {
        label: 'Keyframe 2',
        position: [0.310, 0.342, 0.239],
        rotation: [-26.3, 1.2, -88.7],
        chainPose: [
            132.4,
            -85.5,
            94.6,
            -120.0,
            -106.4,
            127.9,
        ].map((value) => MathUtils.degToRad(value)),
    },
    {
        label: 'Keyframe 3',
        position: [0.458, 0.404, -0.068],
        rotation: [86.5, -45.6, -16.8],
        chainPose: [
            157.3,
            -89.6,
            99.4,
            -136.5,
            -60.9,
            248.9,
        ].map((value) => MathUtils.degToRad(value)),
        durationMs: 504.20836181867094,
    },
    {
        label: 'Keyframe 5',
        position: [0.043, 0.288, -0.414],
        rotation: [1.0, 1.0, -90.3],
        chainPose: [
            245.4,
            -67.5,
            72.4,
            -95.7,
            -89.3,
            244.4,
        ].map((value) => MathUtils.degToRad(value)),
        gripAction: OPEN_ACTION,
    },
];

const debugParams = {
    showActuatorColliders: true,
    showEndControl: true,
    showTrajectory: true,
};

init().catch((error) => {
    console.error('[IK Model Pick] init failed:', error);
    setLoadingState('Unable to initialize IK Model Pick.');
    setStatus('Initialization failed');
});

async function init() {
    scene = new Scene();
    scene.background = new Color(0x242a2e);

    camera = new PerspectiveCamera(48, window.innerWidth / window.innerHeight, 0.05, 100);
    camera.position.set(1.15, 0.82, 1.25);

    renderer = new WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFSoftShadowMap;
    document.body.appendChild(renderer.domElement);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0.28, 0);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 0.55;
    controls.maxDistance = 3;
    controls.update();
    controls.addEventListener('change', () => {
        renderLoop.requestRender();
    });

    await initPhysics();
    addEnvironment();
    createPlatforms();
    createCubes();
    createKinematicChain();
    createRobotRig();
    createSequencePlayer();
    sequenceStore = new IndexedDbSequenceStore();
    const storedKeyframes = await loadStoredKeyframes();
    createSequenceGenerator(
        storedKeyframes?.length
            ? storedKeyframes
            : defaultRecordedKeyframes,
    );
    createToolDock();

    renderer.domElement.addEventListener('click', onSceneClick);
    window.addEventListener('resize', onResize);

    renderLoop.configure({
        fps: FRAME_RATE,
        render: renderFrame,
    });
    renderLoop.setContinuous(false);
    renderLoop.setRenderOnIdle(false);
    renderLoop.requestRender();

    await robotRig.load();
    robotRig.setVisible(true);
    syncActuatorCollidersFromRobotRig();
    restoreInitialRobotPose();
    createActuatorColliderDebug();
    setLoadingState('');
    setStatus('Ready');
    renderLoop.requestRender();
}

async function initPhysics() {
    await initRapier();
    physicsWorld = new World({ x: 0, y: -9.81, z: 0 });
}

function addEnvironment() {
    const floor = new Mesh(
        new PlaneGeometry(3, 3),
        new MeshStandardMaterial({
            color: 0x596064,
            roughness: 0.82,
            metalness: 0.05,
        }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.006;
    floor.receiveShadow = true;
    scene.add(floor);

    const groundBody = physicsWorld.createRigidBody(
        RigidBodyDesc.fixed().setTranslation(0, -0.025, 0),
    );
    physicsWorld.createCollider(
        ColliderDesc.cuboid(1.5, 0.025, 1.5)
            .setFriction(0.9)
            .setRestitution(0.02),
        groundBody,
    );
    createRobotPedestal();

    const grid = new GridHelper(3, 30, 0x7b8589, 0x687175);
    grid.position.y = -0.003;
    grid.material.transparent = true;
    grid.material.opacity = 0.2;
    scene.add(grid);

    scene.add(new AmbientLight(0xffffff, 0.55));

    const hemisphere = new HemisphereLight(0xf5fbff, 0x32383b, 1.35);
    hemisphere.position.set(0, 3, 0);
    scene.add(hemisphere);

    const key = new DirectionalLight(0xffffff, 4.1);
    key.position.set(1.4, 2.1, 1.3);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -1.4;
    key.shadow.camera.right = 1.4;
    key.shadow.camera.top = 1.6;
    key.shadow.camera.bottom = -0.8;
    key.shadow.camera.near = 0.1;
    key.shadow.camera.far = 6;
    scene.add(key);

    const fill = new DirectionalLight(0xb9dcff, 1.1);
    fill.position.set(-1.2, 1.1, 0.8);
    scene.add(fill);

    const rim = new DirectionalLight(0xc0ecff, 1.25);
    rim.position.set(-0.8, 1.2, -1.4);
    scene.add(rim);
}

function createRobotPedestal() {
    const columnHeight = ROBOT_PEDESTAL_HEIGHT
        - ROBOT_PEDESTAL_PLATE_THICKNESS;
    const columnMaterial = new MeshStandardMaterial({
        color: 0x30383c,
        roughness: 0.52,
        metalness: 0.48,
    });
    const plateMaterial = new MeshStandardMaterial({
        color: 0x657177,
        roughness: 0.42,
        metalness: 0.58,
    });

    const column = new Mesh(
        new CylinderGeometry(
            ROBOT_PEDESTAL_COLUMN_RADIUS,
            ROBOT_PEDESTAL_COLUMN_RADIUS * 1.14,
            columnHeight,
            36,
        ),
        columnMaterial,
    );
    column.position.y = columnHeight * 0.5;
    column.castShadow = true;
    column.receiveShadow = true;
    scene.add(column);

    const topPlate = new Mesh(
        new CylinderGeometry(
            ROBOT_PEDESTAL_PLATE_RADIUS,
            ROBOT_PEDESTAL_PLATE_RADIUS,
            ROBOT_PEDESTAL_PLATE_THICKNESS,
            36,
        ),
        plateMaterial,
    );
    topPlate.position.y = columnHeight
        + ROBOT_PEDESTAL_PLATE_THICKNESS * 0.5;
    topPlate.castShadow = true;
    topPlate.receiveShadow = true;
    scene.add(topPlate);

    const pedestalBody = physicsWorld.createRigidBody(RigidBodyDesc.fixed());
    physicsWorld.createCollider(
        ColliderDesc.cylinder(
            columnHeight * 0.5,
            ROBOT_PEDESTAL_COLUMN_RADIUS * 1.14,
        )
            .setTranslation(0, columnHeight * 0.5, 0)
            .setFriction(0.9),
        pedestalBody,
    );
    physicsWorld.createCollider(
        ColliderDesc.cylinder(
            ROBOT_PEDESTAL_PLATE_THICKNESS * 0.5,
            ROBOT_PEDESTAL_PLATE_RADIUS,
        )
            .setTranslation(0, topPlate.position.y, 0)
            .setFriction(0.9),
        pedestalBody,
    );
}

function createPlatforms() {
    createPlatform({
        name: 'sourcePlatform',
        z: SOURCE_PLATFORM_Z,
        topColor: 0x467783,
        trimColor: 0x19363d,
    });
    createTargetBasket();
}

function createPlatform({ name, z, topColor, trimColor }) {
    const topMaterial = new MeshStandardMaterial({
        color: topColor,
        roughness: 0.48,
        metalness: 0.18,
    });
    const trimMaterial = new MeshStandardMaterial({
        color: trimColor,
        roughness: 0.62,
        metalness: 0.28,
    });

    const top = new Mesh(
        new BoxGeometry(0.44, PLATFORM_TOP_THICKNESS, 0.28),
        topMaterial,
    );
    top.name = `${name}Top`;
    top.position.set(
        0,
        PLATFORM_TOP_Y - PLATFORM_TOP_THICKNESS * 0.5,
        z,
    );
    top.castShadow = true;
    top.receiveShadow = true;
    scene.add(top);

    const platformBody = physicsWorld.createRigidBody(
        RigidBodyDesc.fixed().setTranslation(
            top.position.x,
            top.position.y,
            top.position.z,
        ),
    );
    physicsWorld.createCollider(
        ColliderDesc.cuboid(0.22, PLATFORM_TOP_THICKNESS * 0.5, 0.14)
            .setFriction(0.9)
            .setRestitution(0.02),
        platformBody,
    );

    const legHeight = PLATFORM_TOP_Y - PLATFORM_TOP_THICKNESS;
    const legGeometry = new BoxGeometry(0.045, legHeight, 0.045);
    for (const x of [-0.17, 0.17]) {
        for (const zOffset of [-0.09, 0.09]) {
            const leg = new Mesh(legGeometry, trimMaterial);
            leg.position.set(x, legHeight * 0.5, z + zOffset);
            leg.castShadow = true;
            leg.receiveShadow = true;
            scene.add(leg);
        }
    }
}

function createTargetBasket() {
    const basketMaterial = new MeshStandardMaterial({
        color: 0x58a178,
        roughness: 0.54,
        metalness: 0.12,
        side: DoubleSide,
    });
    const rimMaterial = new MeshStandardMaterial({
        color: 0x214c36,
        roughness: 0.65,
        metalness: 0.2,
    });
    const outerRadius = BASKET_INNER_RADIUS + BASKET_WALL_THICKNESS;
    const floor = new Mesh(
        new CylinderGeometry(
            outerRadius,
            outerRadius,
            BASKET_FLOOR_THICKNESS,
            64,
        ),
        basketMaterial,
    );
    floor.name = 'targetBasketFloor';
    floor.position.set(
        0,
        BASKET_FLOOR_THICKNESS * 0.5,
        TARGET_PLATFORM_Z,
    );
    floor.castShadow = true;
    floor.receiveShadow = true;
    scene.add(floor);

    const basketBody = physicsWorld.createRigidBody(
        RigidBodyDesc.fixed().setTranslation(0, 0, TARGET_PLATFORM_Z),
    );
    physicsWorld.createCollider(
        ColliderDesc.cylinder(
            BASKET_FLOOR_THICKNESS * 0.5,
            outerRadius,
        )
            .setTranslation(0, BASKET_FLOOR_THICKNESS * 0.5, 0)
            .setFriction(0.9)
            .setRestitution(0.02),
        basketBody,
    );

    const wallHeight = BASKET_RIM_HEIGHT - BASKET_FLOOR_THICKNESS;
    const wallCenterY = BASKET_FLOOR_THICKNESS + wallHeight * 0.5;
    const wall = new Mesh(
        new CylinderGeometry(
            outerRadius,
            outerRadius,
            wallHeight,
            64,
            1,
            true,
        ),
        basketMaterial,
    );
    wall.name = 'targetBasketWall';
    wall.position.set(0, wallCenterY, TARGET_PLATFORM_Z);
    wall.castShadow = true;
    wall.receiveShadow = true;
    scene.add(wall);

    const rim = new Mesh(
        new TorusGeometry(
            BASKET_INNER_RADIUS + BASKET_WALL_THICKNESS * 0.5,
            BASKET_WALL_THICKNESS * 0.5,
            10,
            64,
        ),
        rimMaterial,
    );
    rim.name = 'targetBasketRim';
    rim.rotation.x = Math.PI * 0.5;
    rim.position.set(0, BASKET_RIM_HEIGHT, TARGET_PLATFORM_Z);
    rim.castShadow = true;
    rim.receiveShadow = true;
    scene.add(rim);

    const colliderRadius = BASKET_INNER_RADIUS
        + BASKET_WALL_THICKNESS * 0.5;
    const segmentHalfLength = Math.tan(
        Math.PI / BASKET_WALL_SEGMENTS,
    ) * outerRadius;
    for (let index = 0; index < BASKET_WALL_SEGMENTS; index++) {
        const angle = index / BASKET_WALL_SEGMENTS * Math.PI * 2;
        const x = Math.cos(angle) * colliderRadius;
        const z = Math.sin(angle) * colliderRadius;
        basketWallQuaternion.setFromAxisAngle(
            worldUpAxis,
            Math.PI * 0.5 - angle,
        );
        physicsWorld.createCollider(
            ColliderDesc.cuboid(
                segmentHalfLength,
                wallHeight * 0.5,
                BASKET_WALL_THICKNESS * 0.5,
            )
                .setTranslation(x, wallCenterY, z)
                .setRotation({
                    x: basketWallQuaternion.x,
                    y: basketWallQuaternion.y,
                    z: basketWallQuaternion.z,
                    w: basketWallQuaternion.w,
                })
                .setFriction(0.8)
                .setRestitution(0.04),
            basketBody,
        );
    }
}

function createCubes() {
    const geometry = new BoxGeometry(CUBE_SIZE, CUBE_SIZE, CUBE_SIZE);
    const colors = [0xff5c65, 0xffb84d, 0x5dd39e, 0x55a7ff, 0xe980e7];
    for (let index = 0; index < sourceCubePositions.length; index++) {
        const [x, z] = sourceCubePositions[index];
        const material = new MeshStandardMaterial({
            color: colors[index % colors.length],
            roughness: 0.38,
            metalness: 0.08,
        });
        const mesh = new Mesh(geometry, material);
        mesh.name = `pickCube${index + 1}`;
        mesh.position.set(x, PLATFORM_TOP_Y + CUBE_SIZE * 0.5, z);
        mesh.castShadow = true;
        mesh.receiveShadow = true;

        const body = physicsWorld.createRigidBody(
            RigidBodyDesc.dynamic()
                .setTranslation(mesh.position.x, mesh.position.y, mesh.position.z)
                .setLinearDamping(0.35)
                .setAngularDamping(0.55)
                .setCcdEnabled(true),
        );
        const collider = physicsWorld.createCollider(
            ColliderDesc.cuboid(CUBE_SIZE * 0.5, CUBE_SIZE * 0.5, CUBE_SIZE * 0.5)
                .setFriction(0.9)
                .setRestitution(0.04),
            body,
        );

        const item = {
            mesh,
            body,
            collider,
            size: CUBE_SIZE,
            placed: false,
            sourcePosition: mesh.position.clone(),
            savedCollisionGroups: null,
            savedSolverGroups: null,
        };
        mesh.userData.pickItem = item;
        cubes.push(item);
        scene.add(mesh);
    }
}

function createKinematicChain() {
    chain = new Chain(scene);
    actuator = new Actuator({
        scene,
        physicsWorld,
        size: 0.044,
        visualConfig: {
            gripForwardScale: 1.45,
        },
        toolEulerDeg: { x: 0, y: -90, z: 0 },
    });
    actuator.modelGroup.visible = false;

    qCurrent = DEFAULT_Q_SEED.slice();
    chain.update(
        createDhParametersFromJointState(qCurrent, ur3eChainProfile),
        styleParams,
        baseParams,
    );
    chain.attachActuator(actuator, { preserveWorld: false });
    chain.roboticArm.visible = false;

    chainSolver = new ChainSolver({
        targetPosition: pendingTarget,
        targetQuaternion: pendingTargetQuaternion,
        chain,
        maxIter: solverParams.maxIter,
        alpha: solverParams.alpha,
        tolerance: solverParams.tolerance,
        solveMode: getSolverMode(),
        solverMethod: solverParams.solverMethod,
        damping: solverParams.damping,
        dlsMaxDelta: solverParams.dlsMaxDelta,
        rotationWeight: solverParams.rotationWeight,
        rotationTolerance: solverParams.rotationTolerance,
        debug: solverParams.debug,
        forwardKinematics: (q) => {
            chain.updateJoint(q);
            syncRobotPose(q);
        },
    });
    chainSolver.joints = chain.joints;
}

function createRobotRig() {
    robotRig = createUr3eRobotiqRig({
        parent: scene,
        ur3eAssetUrl: UR3E_MODEL_URL,
        gripperAssetUrl: GRIPPER_MODEL_URL,
        // Match the 2F-85 +Z approach axis to the actuator +X axis after toolEuler.y = -90°.
        gripperRootTransform: {
            rpy: [0, Math.PI / 2, 0],
        },
        ur3eMaterialResolver: getUr3eMaterial,
        gripperMaterialResolver: getGripperMaterial,
        padMaterial: ur3eMaterials.gripperBlueGrey,
    });
    robotRig.syncBase({
        syncUp: styleParams.syncUp,
        offset: baseParams.baseOffset,
    });
    robotRig.setVisible(false);
    robotRig.setJointValues(qCurrent);
    robotRig.setGripperOpen(1);
}

function createSequencePlayer() {
    sequenceTarget = new Object3D();
    sequenceTarget.name = 'IK model pick sequence target';
    scene.add(sequenceTarget);
    sequencePlayer = new SequencePlayer({
        sequence: { name: 'generated-keyframes', version: 1, steps: [] },
        getTargetObject: () => sequenceTarget,
        chain,
        requestRender: () => renderLoop.requestRender(),
        now: () => performance.now(),
        getPickParams: () => moveParams,
        getPhysicsWorld: () => physicsWorld,
        getPhysicsCubes: () => cubes,
        isCubeValid: (cubeItem) => Boolean(cubeItem?.mesh?.parent),
        defaultInteractionGroups: DEFAULT_INTERACTION_GROUPS,
        heldCubeInteractionGroups: HELD_CUBE_INTERACTION_GROUPS,
        jawGapOpenEps: 1e-4,
        jawContactGapRatio: 1.05,
        moveSettleTimeoutMs: 900,
        getJawInnerGap: () => (
            Math.max(0, (robotRig?.getPadCenterGap?.() ?? 0) - 0.00635)
        ),
        resolveTarget: (
            targetSpec,
            context,
            outPosition,
            outQuaternion,
        ) => {
            if (targetSpec?.kind === DYNAMIC_CUBE_TARGET_KIND) {
                return getCubePosition(context, outPosition, outQuaternion);
            }
            return sequenceGenerator?.resolveTarget(
                targetSpec,
                context,
                outPosition,
                outQuaternion,
            ) === true;
        },
        resolveJointState: (...args) => (
            sequenceGenerator?.resolveJointState(...args) === true
        ),
        onActuatorChange: syncGripperFromActuator,
        onStepEnter: updateSequenceStatus,
        onPoseReached: selectReachedSequenceKeyframe,
        onComplete: completePickSequence,
        forwardKinematics: (q) => {
            chain.updateJoint(q);
        },
        applyQToChain: (q) => {
            qCurrent = q.slice();
            chain.updateJoint(qCurrent);
            syncRobotPose(qCurrent);
        },
        getInitialQ: () => qCurrent,
        maxIter: solverParams.maxIter,
        alpha: solverParams.alpha,
        tolerance: solverParams.tolerance,
        solveMode: getSolverMode(),
        solverMethod: solverParams.solverMethod,
        damping: solverParams.damping,
        dlsMaxDelta: solverParams.dlsMaxDelta,
        rotationWeight: solverParams.rotationWeight,
        rotationTolerance: solverParams.rotationTolerance,
        debug: solverParams.debug,
    });
}

async function loadStoredKeyframes() {
    try {
        return await sequenceStore.load(SEQUENCE_STORAGE_ID);
    } catch (error) {
        console.warn('[IK Model Pick] unable to load saved keyframes:', error);
        return null;
    }
}

function saveSequenceKeyframes(keyframes) {
    sequenceStore?.save(SEQUENCE_STORAGE_ID, keyframes).catch((error) => {
        console.warn('[IK Model Pick] unable to save keyframes:', error);
    });
}

function createSequenceGenerator(initialKeyframes) {
    let isHydratingKeyframes = true;
    sequenceGenerator = new SequenceGenerator({
        scene,
        camera,
        domElement: renderer.domElement,
        orbitControls: controls,
        targetObject: sequenceTarget,
        sequencePlayer,
        requestRender: () => renderLoop.requestRender(),
        defaultDurationMs: 500,
        defaultGripDurationMs: moveParams.gripDurationMs,
        getCurrentPose: (outPosition, outQuaternion) => {
            if (!actuator) {
                return false;
            }
            actuator.getGripWorldPosition(outPosition);
            actuator.getGripWorldQuaternion(outQuaternion);
            return true;
        },
        getCurrentChainPose: () => qCurrent.slice(),
        setCurrentChainPose: (chainPose) => {
            sequencePlayer.setJointState(chainPose, {
                syncToolEuler: false,
                syncReachRange: false,
            });
        },
        sampleChainPose: (chainPose, outPosition, outQuaternion) => {
            if (!chain || !actuator || chainPose.length !== qCurrent.length) {
                return false;
            }
            chain.updateJoint(chainPose);
            try {
                actuator.getGripWorldPosition(outPosition);
                actuator.getGripWorldQuaternion(outQuaternion);
                return true;
            } finally {
                chain.updateJoint(qCurrent);
            }
        },
        isOrientationConstrained: () => solverParams.constrainOrientation,
        editorOpen: true,
        visualizationVisible: debugParams.showEndControl,
        trajectoryVisible: debugParams.showTrajectory,
        onSequenceChange: (sequence, keyframes) => {
            sequencePlayer.loadSequence(sequence);
            if (!isHydratingKeyframes) {
                saveSequenceKeyframes(keyframes);
            }
        },
        onPlay: startTrajectoryPreview,
        onStop: stopGeneratedSequence,
        onStatus: setStatus,
        onEditorVisibilityChange: () => {
            onResize();
            syncToolDockState();
        },
    });
    sequenceGenerator.addRecordedKeyframes(
        initialKeyframes.map((keyframe) => ({
            ...keyframe,
            durationMs: keyframe.durationMs ?? 500,
            holdMs: keyframe.holdMs ?? 0,
            gripAction: keyframe.gripAction ?? HOLD_ACTION,
            gripDurationMs: (
                keyframe.gripDurationMs
                ?? moveParams.gripDurationMs
            ),
        })),
        { selectedIndex: 0 },
    );
    isHydratingKeyframes = false;
    saveSequenceKeyframes(sequenceGenerator.getKeyframes());
    onResize();
}

function createToolDock() {
    const sceneButton = document.querySelector('[data-tool="scene"]');
    const vizButton = document.querySelector('[data-tool="viz"]');
    const solverButton = document.querySelector('[data-tool="solver"]');
    const sequenceButton = document.querySelector('[data-tool="sequence"]');
    const scenePanel = document.querySelector('[data-tool-panel="scene"]');
    const vizPanel = document.querySelector('[data-tool-panel="viz"]');
    const solverPanel = document.querySelector('[data-tool-panel="solver"]');
    const colliderToggle = document.getElementById('show-actuator-colliders');
    const endControlToggle = document.getElementById('show-end-control');
    const trajectoryToggle = document.getElementById('show-trajectory');

    sceneButton?.addEventListener('click', () => {
        const shouldOpen = scenePanel?.hidden !== false;
        setToolPanel(shouldOpen ? 'scene' : null);
    });
    vizButton?.addEventListener('click', () => {
        const shouldOpen = vizPanel?.hidden !== false;
        setToolPanel(shouldOpen ? 'viz' : null);
    });
    solverButton?.addEventListener('click', () => {
        const shouldOpen = solverPanel?.hidden !== false;
        setToolPanel(shouldOpen ? 'solver' : null);
    });
    sequenceButton?.addEventListener('click', () => {
        setToolPanel(null);
        sequenceGenerator?.setEditorOpen(!sequenceGenerator.isEditorOpen());
    });
    document.getElementById('reset-cubes')?.addEventListener(
        'click',
        resetCubes,
    );
    document.getElementById('reset-robot')?.addEventListener(
        'click',
        resetRobot,
    );

    if (colliderToggle) {
        colliderToggle.checked = debugParams.showActuatorColliders;
        colliderToggle.addEventListener('change', () => {
            debugParams.showActuatorColliders = colliderToggle.checked;
            syncActuatorColliderDebug();
            renderLoop.requestRender();
        });
    }
    if (endControlToggle) {
        endControlToggle.checked = debugParams.showEndControl;
        endControlToggle.addEventListener('change', () => {
            debugParams.showEndControl = endControlToggle.checked;
            sequenceGenerator?.setVisualizationVisible(
                debugParams.showEndControl,
            );
        });
    }
    if (trajectoryToggle) {
        trajectoryToggle.checked = debugParams.showTrajectory;
        trajectoryToggle.addEventListener('change', () => {
            debugParams.showTrajectory = trajectoryToggle.checked;
            sequenceGenerator?.setTrajectoryVisible(
                debugParams.showTrajectory,
            );
        });
    }
    createSolverControls();
    syncToolDockState();
}

function createSolverControls() {
    solverMetricOutputs = {
        position: document.getElementById('solver-position-error'),
        rotation: document.getElementById('solver-rotation-error'),
        iterations: document.getElementById('solver-iterations'),
    };
    lastSolverMetricRevision = -1;
    const orientationToggle = document.getElementById(
        'solver-constrain-orientation',
    );
    if (orientationToggle) {
        orientationToggle.checked = solverParams.constrainOrientation;
        orientationToggle.addEventListener('change', () => {
            solverParams.constrainOrientation = orientationToggle.checked;
            applySolverParams();
            syncSolverControlState();
        });
    }
    for (
        const button
        of document.querySelectorAll('[data-solver-method]')
    ) {
        button.addEventListener('click', () => {
            const method = button.dataset.solverMethod;
            if (method !== 'Jacobian' && method !== 'DLS') {
                return;
            }
            solverParams.solverMethod = method;
            applySolverParams();
            syncSolverControlState();
        });
    }

    const bindings = [
        ['solver-max-iter', 'maxIter', true],
        ['solver-tolerance', 'tolerance', false],
        ['solver-alpha', 'alpha', false],
        ['solver-damping', 'damping', false],
        ['solver-max-delta', 'dlsMaxDelta', false],
        ['solver-rotation-weight', 'rotationWeight', false],
        ['solver-rotation-tolerance', 'rotationTolerance', false],
    ];
    for (const [id, key, integer] of bindings) {
        const input = document.getElementById(id);
        if (!input) {
            continue;
        }
        input.value = String(solverParams[key]);
        input.addEventListener('change', () => {
            let value = Number(input.value);
            if (!Number.isFinite(value)) {
                input.value = String(solverParams[key]);
                return;
            }
            const min = Number(input.min);
            const max = Number(input.max);
            if (Number.isFinite(min)) {
                value = Math.max(min, value);
            }
            if (Number.isFinite(max)) {
                value = Math.min(max, value);
            }
            solverParams[key] = integer ? Math.round(value) : value;
            input.value = String(solverParams[key]);
            applySolverParams();
        });
    }
    syncSolverControlState();
    updateSolverMetrics();
}

function applySolverParams() {
    const solveMode = getSolverMode();
    if (chainSolver) {
        chainSolver.solverMethod = solverParams.solverMethod;
        chainSolver.maxIter = solverParams.maxIter;
        chainSolver.alpha = solverParams.alpha;
        chainSolver.tolerance = solverParams.tolerance;
        chainSolver.damping = solverParams.damping;
        chainSolver.dlsMaxDelta = solverParams.dlsMaxDelta;
        chainSolver.rotationWeight = solverParams.rotationWeight;
        chainSolver.rotationTolerance = solverParams.rotationTolerance;
        chainSolver.solveMode = solveMode;
    }
    sequencePlayer?.setSolverConfig({ ...solverParams, solveMode });
    if (!sequencePlayer?.isActive()) {
        sequencePlayer?.queueSolveFromTarget();
    }
    renderLoop.requestRender();
}

function syncSolverControlState() {
    for (
        const button
        of document.querySelectorAll('[data-solver-method]')
    ) {
        const active = button.dataset.solverMethod
            === solverParams.solverMethod;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-pressed', String(active));
    }
    for (
        const field
        of document.querySelectorAll('[data-solver-field]')
    ) {
        const matchesMethod = field.dataset.solverField
            === solverParams.solverMethod;
        const matchesOrientation = !field.hasAttribute(
            'data-orientation-only',
        ) || solverParams.constrainOrientation;
        field.hidden = !matchesMethod || !matchesOrientation;
    }
    for (
        const element
        of document.querySelectorAll(
            '[data-orientation-only]:not([data-solver-field])',
        )
    ) {
        element.hidden = !solverParams.constrainOrientation;
    }
}

function updateSolverMetrics() {
    if (!sequencePlayer || !solverMetricOutputs) {
        return;
    }
    const revision = sequencePlayer.getSolveRevision();
    if (revision === lastSolverMetricRevision) {
        return;
    }
    const metrics = sequencePlayer?.getSolveMetrics();
    lastSolverMetricRevision = revision;
    if (!metrics) {
        return;
    }
    const positionValue = `${(metrics.positionError * 1000).toFixed(2)} mm`;
    const rotationValue = `${MathUtils.radToDeg(metrics.rotationError).toFixed(2)
        } deg`;
    const iterationsValue = String(metrics.iterations);
    if (
        solverMetricOutputs.position
        && solverMetricOutputs.position.value !== positionValue
    ) {
        solverMetricOutputs.position.value = positionValue;
    }
    if (
        solverMetricOutputs.rotation
        && solverMetricOutputs.rotation.value !== rotationValue
    ) {
        solverMetricOutputs.rotation.value = rotationValue;
    }
    if (
        solverMetricOutputs.iterations
        && solverMetricOutputs.iterations.value !== iterationsValue
    ) {
        solverMetricOutputs.iterations.value = iterationsValue;
    }
}

function setToolPanel(panelName) {
    for (const panel of document.querySelectorAll('[data-tool-panel]')) {
        panel.hidden = panel.dataset.toolPanel !== panelName;
    }
    syncToolDockState(panelName);
}

function syncToolDockState(openPanel) {
    const visiblePanel = document.querySelector(
        '[data-tool-panel]:not([hidden])',
    );
    const resolvedOpenPanel = openPanel
        ?? visiblePanel?.dataset.toolPanel
        ?? null;
    for (const button of document.querySelectorAll('[data-tool]')) {
        const isActive = button.dataset.tool === 'sequence'
            ? Boolean(sequenceGenerator?.isEditorOpen())
            : button.dataset.tool === resolvedOpenPanel;
        button.classList.toggle('is-active', isActive);
        button.setAttribute('aria-pressed', String(isActive));
    }
}

function createColliderBoxFromNode({
    name,
    role,
    node,
    halfExtents,
    center = { x: 0, y: 0, z: 0 },
}) {
    node.updateWorldMatrix(true, false);
    colliderOffsetMatrix.makeTranslation(center.x, center.y, center.z);
    colliderWorldMatrix.copy(node.matrixWorld).multiply(colliderOffsetMatrix);
    colliderLocalMatrix
        .copy(colliderReferenceInverse)
        .multiply(colliderWorldMatrix)
        .decompose(
            colliderLocalPosition,
            colliderLocalQuaternion,
            colliderLocalScale,
        );
    return {
        name,
        role,
        halfExtents: {
            x: halfExtents.x * Math.abs(colliderLocalScale.x),
            y: halfExtents.y * Math.abs(colliderLocalScale.y),
            z: halfExtents.z * Math.abs(colliderLocalScale.z),
        },
        position: {
            x: colliderLocalPosition.x,
            y: colliderLocalPosition.y,
            z: colliderLocalPosition.z,
        },
        quaternion: {
            x: colliderLocalQuaternion.x,
            y: colliderLocalQuaternion.y,
            z: colliderLocalQuaternion.z,
            w: colliderLocalQuaternion.w,
        },
    };
}

function syncActuatorCollidersFromRobotRig() {
    if (!actuator || !robotRig?.gripperRig) {
        return;
    }
    actuator.toolGroup.updateWorldMatrix(true, false);
    colliderReferenceInverse.copy(actuator.toolGroup.matrixWorld).invert();
    robotRig.gripperRig.root.updateWorldMatrix(true, true);

    const boxes = [
        createColliderBoxFromNode({
            name: 'Robotiq palm',
            role: 'rail',
            node: robotRig.gripperRig.root,
            center: { x: 0, y: 0, z: 0.03 },
            halfExtents: { x: 0.0425, y: 0.0425, z: 0.03 },
        }),
        createColliderBoxFromNode({
            name: 'Robotiq left pad',
            role: 'leftJaw',
            node: robotRig.gripperRig.resolveNode('leftPad'),
            halfExtents: { x: 0.011, y: 0.003175, z: 0.01875 },
        }),
        createColliderBoxFromNode({
            name: 'Robotiq right pad',
            role: 'rightJaw',
            node: robotRig.gripperRig.resolveNode('rightPad'),
            halfExtents: { x: 0.011, y: 0.003175, z: 0.01875 },
        }),
    ];
    actuator.setPhysicsColliderBoxes(boxes);
    actuator.gripPoint.position.set(
        (boxes[1].position.x + boxes[2].position.x) * 0.5,
        (boxes[1].position.y + boxes[2].position.y) * 0.5,
        (boxes[1].position.z + boxes[2].position.z) * 0.5,
    );
    syncActuatorColliderDebug();
}

function createActuatorColliderDebug() {
    actuatorColliderDebug = new Group();
    actuatorColliderDebug.name = 'actuatorColliderDebug';
    actuatorColliderDebug.matrixAutoUpdate = false;
    actuatorColliderDebug.userData.entries = [];

    const colorByRole = {
        rail: 0x2ee8ff,
        leftJaw: 0xffd43b,
        rightJaw: 0xff7a45,
    };
    for (const box of actuator.getPhysicsColliderBoxes()) {
        const debugMesh = new Mesh(
            new BoxGeometry(1, 1, 1),
            new MeshBasicMaterial({
                color: colorByRole[box.role] ?? 0xffffff,
                wireframe: true,
                transparent: true,
                opacity: 0.95,
                depthTest: false,
            }),
        );
        debugMesh.renderOrder = 1000;
        actuatorColliderDebug.add(debugMesh);
        actuatorColliderDebug.userData.entries.push(debugMesh);
    }

    gripPointDebug = new Mesh(
        new SphereGeometry(0.006, 16, 10),
        new MeshBasicMaterial({
            color: 0xff3bd5,
            depthTest: false,
        }),
    );
    gripPointDebug.renderOrder = 1001;
    actuatorColliderDebug.add(gripPointDebug);
    scene.add(actuatorColliderDebug);
    syncActuatorColliderDebug();
}

function syncActuatorColliderDebug() {
    if (!actuatorColliderDebug || !actuator) {
        return;
    }
    actuator.toolGroup.updateWorldMatrix(true, false);
    actuatorColliderDebug.matrix.copy(actuator.toolGroup.matrixWorld);
    actuatorColliderDebug.matrixWorldNeedsUpdate = true;
    const boxes = actuator.getPhysicsColliderBoxes();
    for (let index = 0; index < boxes.length; index++) {
        const box = boxes[index];
        const debugMesh = actuatorColliderDebug.userData.entries[index];
        if (!debugMesh) {
            continue;
        }
        debugMesh.position.set(
            box.position.x,
            box.position.y,
            box.position.z,
        );
        debugMesh.quaternion.set(
            box.quaternion.x,
            box.quaternion.y,
            box.quaternion.z,
            box.quaternion.w,
        );
        debugMesh.scale.set(
            box.halfExtents.x * 2,
            box.halfExtents.y * 2,
            box.halfExtents.z * 2,
        );
    }
    gripPointDebug.position.copy(actuator.gripPoint.position);
    actuatorColliderDebug.visible = debugParams.showActuatorColliders;
}

function getUr3eMaterial(sourceMaterial) {
    if (Array.isArray(sourceMaterial)) {
        return sourceMaterial.map(getUr3eMaterial);
    }
    const materialName = sourceMaterial?.name?.toLowerCase() || '';
    if (materialName.includes('linkgrey')) {
        return ur3eMaterials.linkGrey;
    }
    if (materialName.includes('jointgrey')) {
        return ur3eMaterials.jointGrey;
    }
    if (materialName.includes('urblue')) {
        return ur3eMaterials.urBlue;
    }
    return ur3eMaterials.black;
}

function getGripperMaterial(sourceMaterial, object, spec) {
    if (Array.isArray(sourceMaterial)) {
        return sourceMaterial.map((material) => getGripperMaterial(material, object, spec));
    }
    if (spec.file.includes('outer_knuckle')) {
        return ur3eMaterials.gripperBlueGrey;
    }
    return sourceMaterial || ur3eMaterials.gripperBlack;
}

function getCubePosition(context, outPosition, outQuaternion) {
    const cubeItem = context?.cubeItem;
    if (!cubeItem?.mesh || !actuator) {
        return false;
    }
    cubeItem.mesh.getWorldPosition(outPosition);
    const gripCenterY = PLATFORM_TOP_Y
        + PAD_APPROACH_HALF_LENGTH
        + TABLE_CLEARANCE;
    outPosition.y = Math.max(outPosition.y, gripCenterY);
    actuator.getVerticalGripQuaternion(outQuaternion);
    return true;
}

function solveIfPending() {
    sequencePlayer?.solveIfPending({
        targetTolerance: solverParams.tolerance,
        pickStagePositionTolerance: solverParams.tolerance,
        descendStageTolerance: solverParams.tolerance,
        descendTimeoutMs: 1200,
    });
}

function syncSequenceTargetFromGrip() {
    if (!sequenceTarget || !actuator) {
        return;
    }
    actuator.getGripWorldPosition(sequenceTarget.position);
    actuator.getGripWorldQuaternion(sequenceTarget.quaternion);
    sequenceTarget.updateMatrixWorld(true);
}

function syncSequenceEditorFromGrip() {
    syncSequenceTargetFromGrip();
    sequenceGenerator?.syncFromTarget();
}

function restoreInitialRobotPose() {
    if (sequenceGenerator?.selectKeyframe(0, { preview: true })) {
        return;
    }
    sequencePlayer?.setJointState(DEFAULT_Q_SEED, {
        syncToolEuler: false,
        syncReachRange: false,
    });
    syncSequenceEditorFromGrip();
}

function syncGripperFromActuator() {
    if (!robotRig || !actuator) {
        return;
    }
    robotRig.setGripperOpen(actuator.getOpenRatio());
    syncActuatorCollidersFromRobotRig();
}

function updateSequenceStatus(step) {
    if (step?.dynamicCubeTarget) {
        setStatus('Solving selected cube target');
        return;
    }
    if (step?.returnStep) {
        setStatus(`Returning via ${step.keyframeLabel}`);
        return;
    }
    const keyframeNumber = Number.isInteger(step?.keyframeIndex)
        ? step.keyframeIndex + 1
        : null;
    if (keyframeNumber && step?.type === 'grip') {
        const action = step.mode === 'open' ? 'opening' : 'closing';
        setStatus(`Keyframe ${keyframeNumber}: ${action} gripper`);
        return;
    }
    if (keyframeNumber && step?.keyframeLabel) {
        setStatus(`Keyframe ${keyframeNumber}: ${step.keyframeLabel}`);
    }
}

function completePickSequence(cubeItem, context = {}) {
    sequenceGenerator?.setPlaybackActive(false);
    if (context.playbackMode === PLAYBACK_MODE_PREVIEW) {
        setStatus('Trajectory preview complete');
        return;
    }
    if (sequencePlayer?.hasGraspJoint()) {
        setStatus('Sequence complete; cube remains held');
        return;
    }
    if (cubeItem && !cubeItem.placed) {
        cubeItem.placed = true;
        placedCount += 1;
        sequenceGenerator?.setContext(null, { previewFirst: false });
        setStatus(`Placed ${placedCount} / ${cubes.length}`);
        return;
    }
    setStatus('Ready');
}

function selectReachedSequenceKeyframe(step) {
    if (!Number.isInteger(step?.keyframeIndex)) {
        return;
    }
    sequenceGenerator?.selectKeyframe(
        step.keyframeIndex,
        { preview: false },
    );
}

function syncRobotPose(q) {
    robotRig?.setJointValues(q);
    chain?.roboticArm && (chain.roboticArm.visible = false);
}

function onSceneClick(event) {
    if (
        event.button !== 0
        || sequencePlayer?.isActive()
        || sequencePlayer?.hasGraspJoint()
        || sequenceGenerator?.isInteracting()
        || !renderer
        || !camera
    ) {
        return;
    }
    const rect = renderer.domElement.getBoundingClientRect();
    pickPointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pickPointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    pickRaycaster.setFromCamera(pickPointer, camera);

    const candidates = cubes
        .filter((item) => (
            !item.placed && item !== sequencePlayer?.getGraspedCube()
        ))
        .map((item) => item.mesh);
    const hit = pickRaycaster.intersectObjects(candidates, false)[0];
    const cubeItem = hit?.object?.userData?.pickItem;
    if (!cubeItem) {
        return;
    }

    const context = createPickContext(cubeItem);
    sequenceGenerator.setContext(context, { previewFirst: false });
    startPickAndReturn(context);
}

function createPickContext(cubeItem) {
    return {
        cubeItem,
        sequenceContext: {
            basketPosition: {
                x: 0,
                y: BASKET_RIM_HEIGHT + BASKET_DROP_HEIGHT,
                z: TARGET_PLATFORM_Z,
            },
        },
    };
}

function cloneSequenceStep(step) {
    return {
        ...step,
        target: step.target ? { ...step.target } : undefined,
    };
}

function createTrajectoryPreviewSequence(sequence) {
    return {
        ...sequence,
        name: `${sequence.name}-preview`,
        steps: sequence.steps
            .filter((step) => step.type !== 'grip')
            .map(cloneSequenceStep),
    };
}

function createPickAndReturnSequence(sequence) {
    const forwardSteps = sequence.steps.map(cloneSequenceStep);
    const recordedPoseSteps = forwardSteps.filter(
        (step) => (
            typeof step.keyframeId === 'string'
            && step.keyframeKind === 'recorded'
            && (step.type === 'move' || step.type === 'joint')
        ),
    );
    const returnSteps = recordedPoseSteps
        .slice(0, -1)
        .reverse()
        .map((step) => ({
            ...cloneSequenceStep(step),
            id: `return-${step.id}`,
            returnStep: true,
        }));
    return {
        ...sequence,
        name: `${sequence.name}-pick-and-return`,
        steps: [
            {
                id: 'dynamic-cube-target-pose',
                type: 'move',
                target: { kind: DYNAMIC_CUBE_TARGET_KIND },
                durationMs: 500,
                interpolation: 'smooth',
                rotationInterpolation: 'eulerXYZ',
                solveWhileLerping: true,
                completion: 'solve',
                toleranceProfile: 'descend',
                dynamicCubeTarget: true,
            },
            {
                id: 'dynamic-cube-target-hold',
                type: 'wait',
                durationMs: 80,
                dynamicCubeTarget: true,
            },
            {
                id: 'dynamic-cube-target-grip',
                type: 'grip',
                mode: CLOSE_ACTION,
                durationMs: moveParams.gripDurationMs,
                dynamicCubeTarget: true,
            },
            ...forwardSteps,
            ...returnSteps,
        ],
    };
}

function startTrajectoryPreview(_context, sequence) {
    if (sequencePlayer?.isActive()) {
        return false;
    }
    const previewSequence = createTrajectoryPreviewSequence(sequence);
    if (previewSequence.steps.length === 0) {
        return false;
    }
    syncSequenceTargetFromGrip();
    sequencePlayer.loadSequence(previewSequence);
    setStatus(`Previewing ${sequenceGenerator.getKeyframes().length} keyframes`);
    return sequencePlayer.startSequence({
        playbackMode: PLAYBACK_MODE_PREVIEW,
    });
}

function startPickAndReturn(context) {
    const cubeItem = context?.cubeItem;
    if (!cubeItem || sequencePlayer?.isActive()) {
        return false;
    }
    const sequence = createPickAndReturnSequence(
        sequenceGenerator.buildSequence(),
    );
    syncSequenceTargetFromGrip();
    sequencePlayer.loadSequence(sequence);
    setStatus(`Picking ${cubeItem.mesh.name}`);
    const started = sequencePlayer.startPickSequence(
        cubeItem,
        {
            ...(context.sequenceContext ?? {}),
            playbackMode: PLAYBACK_MODE_PICK,
        },
    );
    sequenceGenerator.setPlaybackActive(started);
    return started;
}

function stopGeneratedSequence() {
    sequencePlayer?.reset();
    actuator?.setOpenRatio(1);
    syncGripperFromActuator();
    syncSequenceEditorFromGrip();
    sequenceGenerator?.setPlaybackActive(false);
    setStatus('Sequence stopped');
    renderLoop.requestRender();
}

function resetCubes() {
    sequencePlayer?.reset();
    sequenceGenerator?.setPlaybackActive(false);
    placedCount = 0;
    actuator.setOpenRatio(1);
    syncGripperFromActuator();
    for (const item of cubes) {
        item.body.setTranslation({
            x: item.sourcePosition.x,
            y: item.sourcePosition.y,
            z: item.sourcePosition.z,
        }, true);
        item.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
        item.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        item.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
        item.placed = false;
        item.gripFilterApplied = false;
    }
    syncPhysicsCubes();
    sequenceGenerator?.clearContext();
    syncSequenceEditorFromGrip();
    setStatus('Ready');
    renderLoop.requestRender();
}

function resetRobot() {
    sequencePlayer?.reset();
    sequenceGenerator?.setPlaybackActive(false);
    actuator.setOpenRatio(1);
    syncGripperFromActuator();
    restoreInitialRobotPose();
    setStatus('Ready');
    renderLoop.requestRender();
}

function syncPhysicsCubes() {
    for (const item of cubes) {
        const translation = item.body.translation();
        const rotation = item.body.rotation();
        item.mesh.position.set(translation.x, translation.y, translation.z);
        item.mesh.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
    }
}

function stepPhysics() {
    if (!physicsWorld) {
        return;
    }
    actuator?.syncPhysics();
    sequencePlayer?.beforePhysicsStep();
    physicsWorld.step();
    sequencePlayer?.afterPhysicsStep();
    syncPhysicsCubes();
}

function setLoadingState(message) {
    const loading = document.getElementById('loading');
    if (!loading) {
        return;
    }
    loading.textContent = message;
    loading.hidden = message === '';
}

function setStatus(message) {
    const status = document.getElementById('status');
    if (status) {
        status.textContent = message;
    }
}

function onResize() {
    const width = window.innerWidth;
    const height = Math.max(
        240,
        window.innerHeight - (sequenceGenerator?.getEditorHeight() ?? 0),
    );
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderLoop.requestRender();
}

function hasAwakePhysicsBodies() {
    return cubes.some((item) => (
        item.body
        && typeof item.body.isSleeping === 'function'
        && !item.body.isSleeping()
    ));
}

function renderFrame() {
    sequencePlayer?.updateStageLerp();
    solveIfPending();
    updateSolverMetrics();
    stepPhysics();
    syncActuatorColliderDebug();
    const controlsChanged = controls.update();
    renderer.render(scene, camera);
    if (
        controlsChanged
        || sequencePlayer?.isActive()
        || sequencePlayer?.isLerping()
        || sequencePlayer?.hasPendingSolve()
        || hasAwakePhysicsBodies()
    ) {
        renderLoop.requestRender();
    }
}
