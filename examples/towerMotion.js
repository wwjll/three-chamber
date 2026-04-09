import { AmbientLight, Box3, PerspectiveCamera, Scene, SpotLight, Vector3, WebGLRenderer } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import Stats from 'three/examples/jsm/libs/stats.module.js';
import { Pane } from 'tweakpane';

import { getAssetURL, getRenderLoopController } from '/extend/tools/Tool.js';
import { TowerMotionController } from '/extend/motion/Motion.js';

const assetUrl = getAssetURL();
const modelUrl = assetUrl + 'models/scenes/floors.glb';
const renderLoop = getRenderLoopController();

let camera, scene, renderer, controls;
let stats, pane;

const BG_COLOR = 0x333333;
const FRAME_RATE = 30;
const FRAME_DURATION = 1 / FRAME_RATE;

let windwoWidth = window.innerWidth;
let windowHeight = window.innerHeight;
const dimension = {
    center: new Vector3(),
    min: new Vector3(),
    max: new Vector3()
};

let floors = [];
let floorNumbers = [];

let motionController = null;
const easingNames = TowerMotionController.getEasingNames();

const params = {
    reset,
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
    renderer.setSize(windwoWidth, windowHeight);
    renderer.setClearColor(BG_COLOR, 1);

    document.body.appendChild(renderer.domElement);
    scene = new Scene();
    scene.add(new AmbientLight(0xf0f0f0, 3));

    camera = new PerspectiveCamera(70, windwoWidth / windowHeight, 1, 10000);
    scene.add(camera);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.addEventListener('change', () => {
        renderLoop.requestRender();
    });

    stats = new Stats();
    document.body.appendChild(stats.dom);

    motionController = new TowerMotionController({
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
                renderLoop.setContinuous(false);
                renderLoop.requestRender();
            }
        }
    });

    renderLoop.configure({
        fps: FRAME_RATE,
        render: renderFrame
    });
    renderLoop.setRenderOnIdle(params.renderOnIdle);

    new GLTFLoader().load(
        modelUrl,
        function (gltf) {
            const model = gltf.scene;
            floors = model.children;

            motionController.bindFloors(floors);
            floorNumbers = motionController.getOperableLevels();

            initGUI();

            scene.add(model);

            const box = new Box3();
            box.setFromObject(model);
            const size = box.getSize(new Vector3());
            const target = new Vector3();
            const center = box.getCenter(target);
            controls.target = target;

            dimension.min = box.min;
            dimension.max = box.max;
            dimension.center = center;
            dimension.size = size;

            camera.position.x = center.x + 1.2 * size.x;
            camera.position.y = center.y + 1 * size.y;
            camera.position.z = center.z + 1.2 * size.z;
            camera.updateProjectionMatrix();
            controls.update();

            const light = new SpotLight(0xf0f0f0, 2);
            light.position.copy(camera.position);
            light.position.y += 2 * size.y;
            light.lookAt(target.x, target.y, target.z);
            light.fov = 30;
            light.decay = 0.1;
            scene.add(light);

            window.addEventListener('resize', () => {
                windwoWidth = window.innerWidth;
                windowHeight = window.innerHeight;
                camera.aspect = windwoWidth / windowHeight;
                camera.updateProjectionMatrix();
                renderer.setSize(windwoWidth, windowHeight);
                renderLoop.requestRender();
            });

            renderLoop.requestRender();
        },
        function () {
        },
        function (error) {
            console.log(error);
        }
    );
}

function initGUI() {
    const operableLevels = motionController.getOperableLevels();
    const defaultLevel = operableLevels.length > 0
        ? operableLevels[operableLevels.length - 1]
        : 0;
    const levelParams = {
        level: defaultLevel,
    };
    const levelOptions = Object.fromEntries(
        (operableLevels.length > 0 ? operableLevels : [defaultLevel]).map((level) => [String(level), level])
    );

    pane = new Pane({ title: 'Tower Motion' });

    const actionFolder = pane.addFolder({ title: 'Action' });
    actionFolder.addButton({ title: 'Reset' }).on('click', () => {
        reset();
    });
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
    floorFolder.addBinding(levelParams, 'level', { label: 'Toggle Level', options: levelOptions }).on('change', (ev) => {
        if (motionController.isAnimating()) {
            console.log('Floors is animating!');
            return;
        }

        motionController.moveToLevel(ev.value, { queue: false });
        renderLoop.requestRender();
    });
    floorFolder.expanded = true;
}

function renderFrame(deltaSec = FRAME_DURATION) {
    const delta = Math.min(deltaSec, FRAME_DURATION);

    if (motionController) {
        motionController.update(delta);
    }

    stats.update();
    renderer.render(scene, camera);
}

function reset() {
    if (!motionController) return;
    motionController.reset();
    renderLoop.setContinuous(false);
    renderLoop.requestRender();
}
