import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader.js";
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import Stats from 'three/examples/jsm/libs/stats.module.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { SceneGenerator } from "../extend/path-tracing/SceneGenerator";
import { PathTracer } from "../extend/path-tracing/PathTracer";

import { getAssetURL } from '/extend/tools/index.js'

const assetUrl = getAssetURL();
// const modelUrl = assetUrl + "models/bunny.glb";
const modelUrl = assetUrl + "models/dragon.glb";

const envUrl = assetUrl + "hdrs/kiara_5_noon_2k.hdr";
const info = document.querySelector("#info");

let renderer, scene, camera, controls, stats, clock;
let pathTracer;
const BG_COLOR = 0x333333;

let cameraMoving = false;
let mouseDown = false;

init();

async function init() {

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(BG_COLOR, 1);
    renderer.setPixelRatio(1);
    renderer.autoClear = false;
    document.body.appendChild(renderer.domElement);

    const WIDTH = window.innerWidth;
    const HEIGHT = window.innerHeight;

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(60, WIDTH / HEIGHT, 0.1, 10000);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.target = new THREE.Vector3(0, 0, 0);
    clock = new THREE.Clock();
    stats = new Stats();
    document.body.appendChild(stats.dom);

    const [envTexture, gltf] = await Promise.all([
        new RGBELoader().loadAsync(envUrl),
        new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(modelUrl),
    ]);


    let model = gltf.scene;
    scene.add(model);

    const box = new THREE.Box3();
    box.setFromObject(model);
    const size = box.getSize(new THREE.Vector3());

    if (modelUrl.includes("dragon")) {
        camera.position.x = 100 * size.z;
        camera.position.y = 150 * size.y;
        camera.position.z = 100 * size.x;
    }
    else if (modelUrl.includes("bunny")) {
        camera.position.x = -2 * size.x;
        camera.position.y = 2 * size.y;
        camera.position.z = 2 * size.z;
    }
    camera.updateProjectionMatrix();
    controls.update();

    const sceneGenerator = new SceneGenerator(model);
    const { triangle, bvh } = sceneGenerator.generate();

    pathTracer = new PathTracer(renderer, scene, camera);
    pathTracer.setSize(WIDTH, HEIGHT);
    pathTracer.setBounce(3);
    pathTracer.setHdrTexture(envTexture);
    pathTracer.setDataTexture(triangle, bvh);

    event();

    animate();

}

function event() {

    window.addEventListener('resize', () => {
        const { innerWidth, innerHeight } = window;
        pathTracer.camera.aspect = innerWidth / innerHeight;
        pathTracer.reset();
        pathTracer.setSize(innerWidth, innerHeight);
        pathTracer.update();
    });

    function addStopWheelEvent(element, callback) {
        let handle = null;
        function onScroll() {
            if (handle) {
                clearTimeout(handle);
            }
            cameraMoving = true;
            handle = setTimeout(callback, 50);
        };
        element.addEventListener('wheel', onScroll);
    }

    window.addEventListener("mousedown", () => {
        mouseDown = true;
    });

    window.addEventListener("mouseup", () => {
        if (mouseDown) {
            mouseDown = false;
            cameraMoving = false;
        }
    });
    window.addEventListener("mousemove", () => {
        if (mouseDown) {
            cameraMoving = true;
        }
    });

    addStopWheelEvent(window, function () {
        cameraMoving = false;
    });
}

function animate() {
    requestAnimationFrame(animate);

    stats.update()
    controls.update();

    if (cameraMoving) {
        pathTracer.reset();
    }

    pathTracer.update();

    info.innerText = `Samples: ${pathTracer.samples}`

}