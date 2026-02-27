import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import Stats from 'three/examples/jsm/libs/stats.module.js';

import { getAssetURL, getRenderLoopController } from '/extend/tools/Tool.js';
import { TowerMotionController } from '/extend/motion/Motion.js';

const assetUrl = getAssetURL();
const modelUrl = assetUrl + 'models/floors.glb';
const renderLoop = getRenderLoopController();

let camera, scene, renderer, controls;
let stats, gui;

const BG_COLOR = 0x333333;
const FRAME_RATE = 30;
const FRAME_DURATION = 1 / FRAME_RATE;

let windwoWidth = window.innerWidth;
let windowHeight = window.innerHeight;
const dimension = {
    center: new THREE.Vector3(),
    min: new THREE.Vector3(),
    max: new THREE.Vector3()
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
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(windwoWidth, windowHeight);
    renderer.setClearColor(BG_COLOR, 1);

    document.body.appendChild(renderer.domElement);
    scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xf0f0f0, 3));

    camera = new THREE.PerspectiveCamera(70, windwoWidth / windowHeight, 1, 10000);
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

            const box = new THREE.Box3();
            box.setFromObject(model);
            const size = box.getSize(new THREE.Vector3());
            const target = new THREE.Vector3();
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

            const light = new THREE.SpotLight(0xf0f0f0, 2);
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
    gui = new GUI();
    const operableLevels = motionController.getOperableLevels();
    const defaultLevel = operableLevels.length > 0
        ? operableLevels[operableLevels.length - 1]
        : 0;

    gui.add(params, 'reset').name('Reset');
    gui.add(params, 'distance', 100, 3000).step(10).onChange((v) => {
        motionController.setConfig({ distance: v });
    });
    gui.add(params, 'duration', 0.1, 10).step(0.05).name('duration(s)').onChange((v) => {
        motionController.setConfig({ duration: v });
    });
    gui.add(params, 'easingName', easingNames).onChange((v) => {
        motionController.setConfig({ easingName: v });
    });
    gui.add(params, 'easingType', ['In', 'InOut', 'Out']).onChange((v) => {
        motionController.setConfig({ easingType: v });
    });
    gui.add(params, 'renderOnIdle').name('render On Idle').onChange((v) => {
        renderLoop.setRenderOnIdle(v);
    });

    gui.add({ level: defaultLevel }, 'level', operableLevels.length > 0 ? operableLevels : [defaultLevel])
        .name('toggle level')
        .onChange((v) => {
            if (motionController.isAnimating()) {
                console.log('Floors is animating!');
                return;
            }

            motionController.moveToLevel(v, { queue: false });
            renderLoop.requestRender();
        });
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
