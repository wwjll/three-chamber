import {
    Box3, BoxGeometry, DirectionalLight, Group, HemisphereLight, Mesh, MeshStandardMaterial,
    PerspectiveCamera, Scene, Vector3, WebGLRenderer
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Pane } from 'tweakpane';

import { getRenderLoopController } from '/extend/tools/Tool.js';
import { TowerMotionController } from '/extend/motion/Motion.js';

const renderLoop = getRenderLoopController();

let camera, scene, renderer;

const BG_COLOR = 0x333333;
const FRAME_RATE = 30;
const FRAME_DURATION = 1 / FRAME_RATE;

const LEVELS = [-1, 0, 1, 2, 3, 4];
const FLOOR_WIDTH = 1300;
const FLOOR_DEPTH = 1800;
const STORY_HEIGHT = 300;
const ENTRY_HEIGHT = 150;
const SLAB_THICKNESS = 32;
const COLUMN_X = [-580, 0, 580];
const COLUMN_Z = [-820, -280, 280, 820];

let motionController = null;
let pendingLevel = null;
const easingNames = TowerMotionController.getEasingNames();

const params = {
    distance: 1000,
    duration: 1.0,
    easingName: 'Linear',
    easingType: 'In',
    renderOnIdle: false
};

init();

function init() {
    renderer = new WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(BG_COLOR, 1);

    document.body.appendChild(renderer.domElement);
    scene = new Scene();
    const tower = createTower();
    scene.add(tower, new HemisphereLight(0xebf0ff, 0x9c8b7b, 1.9));
    const keyLight = new DirectionalLight(0xffefe1, 2.2);
    keyLight.position.set(1800, 2700, 1400);
    scene.add(keyLight);

    camera = new PerspectiveCamera(70, window.innerWidth / window.innerHeight, 1, 10000);
    scene.add(camera);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.addEventListener('change', () => {
        renderLoop.requestRender();
    });

    motionController = new TowerMotionController({
        floors: tower.children,
        floorNumbers: LEVELS,
        frameRate: FRAME_RATE,
        distance: params.distance,
        duration: params.duration,
        easingName: params.easingName,
        easingType: params.easingType,
        allowQueue: false,
        callbacks: {
            onStart: () => {
                renderLoop.setContinuous(true);
            },
            onFinish: () => {
                if (pendingLevel !== null) {
                    const level = pendingLevel;
                    pendingLevel = null;
                    motionController.moveToLevel(level, { queue: false });
                }
                renderLoop.setContinuous(motionController.isAnimating());
                renderLoop.requestRender();
            }
        }
    });

    renderLoop.configure({
        fps: FRAME_RATE,
        render: renderFrame
    });
    renderLoop.setRenderOnIdle(params.renderOnIdle);

    const bounds = new Box3().setFromObject(tower);
    const size = bounds.getSize(new Vector3());
    bounds.getCenter(controls.target);
    // Leave headroom for the upper floors at the default lift distance.
    controls.target.y += params.distance * 0.15;
    const cameraOffset = new Vector3(1.2 * size.x, size.y, 1.2 * size.z).multiplyScalar(1.12);
    camera.position.copy(controls.target).add(cameraOffset);
    controls.update();
    initGUI();

    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderLoop.requestRender();
    });

    renderLoop.requestRender();
}

function createTower() {
    const tower = new Group();
    const box = new BoxGeometry(1, 1, 1);
    const concrete = new MeshStandardMaterial({ color: 0xdce4ec, roughness: 0.85 });
    const frame = new MeshStandardMaterial({ color: 0x9cabb8, roughness: 0.8 });
    const footing = new MeshStandardMaterial({ color: 0xc9843d, roughness: 0.85 });

    for (const level of LEVELS) {
        const floor = new Group();
        floor.name = `Floor.${level}`;
        floor.position.y = level === -1 ? 0 : ENTRY_HEIGHT + level * STORY_HEIGHT;
        tower.add(floor);

        const addBox = (material, width, height, depth, x, y, z) => {
            const part = new Mesh(box, material);
            part.scale.set(width, height, depth);
            part.position.set(x, y, z);
            floor.add(part);
        };

        if (level === -1) {
            for (const x of COLUMN_X) {
                for (const z of COLUMN_Z) {
                    addBox(footing, 150, 32, 150, x, 16, z);
                    addBox(frame, 52, ENTRY_HEIGHT - 32, 52, x, (ENTRY_HEIGHT + 32) / 2, z);
                }
                addBox(frame, 48, 30, 2 * COLUMN_Z.at(-1), x, 62, 0);
            }
            for (const z of COLUMN_Z) {
                addBox(frame, 2 * COLUMN_X.at(-1), 30, 48, 0, 62, z);
            }
            continue;
        }

        const roof = level === LEVELS.at(-1);
        const shaftWidth = 280;
        const shaftDepth = 440;
        const wingWidth = (FLOOR_WIDTH - shaftWidth) / 2;
        const landingDepth = (FLOOR_DEPTH - shaftDepth) / 2;
        const slabCenter = SLAB_THICKNESS / 2;
        if (roof) {
            addBox(concrete, FLOOR_WIDTH, SLAB_THICKNESS, FLOOR_DEPTH, 0, slabCenter, 0);
            addBox(frame, 340, 84, 500, 0, SLAB_THICKNESS + 42, 0);
        } else {
            // Leave the stairwell open through the occupied floors.
            for (const side of [-1, 1]) {
                addBox(concrete, wingWidth, SLAB_THICKNESS, FLOOR_DEPTH, side * (shaftWidth + wingWidth) / 2, slabCenter, 0);
                addBox(concrete, shaftWidth, SLAB_THICKNESS, landingDepth, 0, slabCenter, side * (shaftDepth + landingDepth) / 2);
            }

            const columnHeight = STORY_HEIGHT - SLAB_THICKNESS;
            for (const x of COLUMN_X) {
                for (const z of COLUMN_Z) {
                    addBox(frame, 48, columnHeight, 48, x, SLAB_THICKNESS + columnHeight / 2, z);
                }
            }
        }

        for (const side of [-1, 1]) {
            addBox(frame, 55, 42, FLOOR_DEPTH, side * COLUMN_X.at(-1), -6, 0);
            addBox(frame, FLOOR_WIDTH, 42, 55, 0, -6, side * COLUMN_Z.at(-1));
        }
    }

    return tower;
}

function initGUI() {
    const operableLevels = motionController.getOperableLevels();
    const topLevel = operableLevels.at(-1);
    const levelParams = { level: topLevel };

    const pane = new Pane({ title: 'Tower Motion' });

    const actionFolder = pane.addFolder({ title: 'Action' });
    const resetButton = actionFolder.addButton({ title: 'Reset' });
    actionFolder.expanded = true;

    const motionFolder = pane.addFolder({ title: 'Motion' });
    motionFolder.addBinding(params, 'distance', { min: 100, max: 3000, step: 10, label: 'Distance' }).on('change', (ev) => {
        motionController.setConfig({ distance: ev.value });
        renderLoop.requestRender();
    });
    motionFolder.addBinding(params, 'duration', { min: 0.1, max: 10, step: 0.05, label: 'Duration (s)' }).on('change', (ev) => {
        motionController.setConfig({ duration: ev.value });
        renderLoop.requestRender();
    });
    motionFolder.addBinding(params, 'easingName', { label: 'Easing', options: Object.fromEntries(easingNames.map((name) => [name, name])) }).on('change', (ev) => {
        motionController.setConfig({ easingName: ev.value });
    });
    motionFolder.addBinding(params, 'easingType', { label: 'Type', options: { In: 'In', InOut: 'InOut', Out: 'Out' } }).on('change', (ev) => {
        motionController.setConfig({ easingType: ev.value });
    });
    motionFolder.expanded = true;

    const renderFolder = pane.addFolder({ title: 'Render' });
    renderFolder.addBinding(params, 'renderOnIdle', { label: 'Render On Idle' }).on('change', (ev) => {
        renderLoop.setRenderOnIdle(ev.value);
    });
    renderFolder.expanded = true;

    const floorFolder = pane.addFolder({ title: 'Floors' });
    const levelSlider = floorFolder.addBinding(levelParams, 'level', {
        label: 'Level',
        min: operableLevels[0],
        max: topLevel,
        step: 1,
    });
    levelSlider.on('change', ({ value, last }) => {
        if (!last) {
            return;
        }
        if (motionController.isAnimating()) {
            pendingLevel = value;
            return;
        }
        motionController.moveToLevel(value, { queue: false });
        renderLoop.requestRender();
    });
    floorFolder.expanded = true;

    resetButton.on('click', () => {
        pendingLevel = null;
        motionController.reset();
        levelParams.level = topLevel;
        levelSlider.refresh();
        renderLoop.setContinuous(false);
        renderLoop.requestRender();
    });
}

function renderFrame(deltaSec = FRAME_DURATION) {
    const delta = Math.min(deltaSec, FRAME_DURATION);

    if (motionController) {
        motionController.update(delta);
    }

    renderer.render(scene, camera);
}
