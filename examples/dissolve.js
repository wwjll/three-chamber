
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TextureLoader } from 'three/src/loaders/TextureLoader.js';
import { Pane } from 'tweakpane';
import Stats from 'three/examples/jsm/libs/stats.module.js';

import { getAssetURL, getRenderLoopController } from '/extend/tools/Tool.js';
import {
    DISSOLVE_VERTEX_COMMON,
    DISSOLVE_VERTEX_UV,
    DISSOLVE_FRAGMENT_COMMON,
    DISSOLVE_FRAGMENT_TYPE0,
    DISSOLVE_FRAGMENT_TYPE1
} from '/extend/effect/legacy/Effect.js';

const assetUrl = getAssetURL();
const renderLoop = getRenderLoopController();
const noiseTexture = assetUrl + 'textures/noise.png';
const fireTexture = assetUrl + 'textures/fire.jpg';
const modelUrl = assetUrl + 'models/soldier.glb';

let camera, scene, renderer, controls, mixer;
let stats, pane;

/* defines */
const BG_COLOR = 0x111111;
const FRAME_RATE = 30;

/* global variables */
let windwoWidth = window.innerWidth;
let windowHeight = window.innerHeight;
const dimension = {
    center: new THREE.Vector3(),
    min: new THREE.Vector3(),
    max: new THREE.Vector3()
};
let shaders = [];
let isDissolving = false;
let hasMixerAnimation = false;
let params = {
    times: 'repeat',
    frameRate: FRAME_RATE,
    edgeColor: '#fa9200',
    edgeWidth: 0.1,
    dissolveSpeed: 0.01,
    dissolveProgress: 0,
    noiseTexture: new TextureLoader().load(noiseTexture),
    edgeColorTexture: new TextureLoader().load(fireTexture),
    appear: appear,
    disappear: disappear
};
let signedDissolveSpeed = params.dissolveSpeed;

init();

function init() {
    renderer = new THREE.WebGLRenderer({ antialias: false });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(windwoWidth, windowHeight);
    renderer.setClearColor(BG_COLOR, 1);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    document.body.appendChild(renderer.domElement);
    scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xf0f0f0, 3));

    camera = new THREE.PerspectiveCamera(70, windwoWidth / windowHeight, 0.1, 1000);
    scene.add(camera);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.addEventListener('change', () => {
        renderLoop.requestRender();
    });

    stats = new Stats();
    document.body.appendChild(stats.dom);
    renderLoop.configure({
        fps: params.frameRate,
        render: renderFrame
    });
    renderLoop.setRenderOnIdle(false);

    new GLTFLoader().load(modelUrl,

        function (gltf) {
            let model = gltf.scene;

            model.frustumCulled = false;
            model.traverse(object => {
                if (object.isMesh) {
                    object.castShadow = true;
                    object.receiveShadow = true;
                    object.frustumCulled = false;

                    const material = object.material;

                    // must be active to use type1 shader
                    material.transparent = true;

                    material.onBeforeCompile = shader => {

                        shaders.push(shader);

                        setDissolveShader(shader);

                    };

                }
            });

            scene.add(model);

            /* GUI */
            {
                pane = new Pane({ title: 'Dissolve' });
                pane.addBinding(params, 'frameRate', { min: 5, max: 120, step: 1 }).on('change', (ev) => {
                    renderLoop.setFPS(ev.value);
                    renderLoop.requestRender();
                });
                pane.addBinding(params, 'edgeColor', { view: 'color' }).on('change', (ev) => {
                    for (let shader of shaders) {
                        if (shader.uniforms.edgeColor) {
                            shader.uniforms.edgeColor.value.set(ev.value);
                        }
                    }
                    renderLoop.requestRender();
                });
                pane.addBinding(params, 'edgeWidth', { min: 0.01, max: 1, step: 0.01 }).on('change', (ev) => {
                    for (let shader of shaders) {
                        if (shader.uniforms.edgeWidth) {
                            shader.uniforms.edgeWidth.value = ev.value;
                        }
                    }
                    renderLoop.requestRender();
                });
                pane.addBinding(params, 'dissolveSpeed', { min: 0.01, max: 0.1, step: 0.01 }).on('change', () => {
                    renderLoop.requestRender();
                });
                pane.addButton({ title: 'appear' }).on('click', () => appear());
                pane.addButton({ title: 'disappear' }).on('click', () => disappear());
            }

            // animations
            const animations = gltf.animations;
            mixer = new THREE.AnimationMixer(model);

            if (animations && animations.length > 0) {
                const animationAction = mixer.clipAction(animations[3]);
                animationAction.play();
                animationAction.paused = false;
                hasMixerAnimation = true;
                updateContinuousState();
            }

            // shadowPlane
            const plane = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.ShadowMaterial({ color: 0xffffff, opacity: 0.25, transparent: true }));
            plane.rotation.x = - Math.PI / 2;
            plane.receiveShadow = true;
            plane.scale.setScalar(50);
            scene.add(plane);

            const box = new THREE.Box3();
            box.setFromObject(model);
            const size = box.getSize(new THREE.Vector3());
            const target = new THREE.Vector3();
            const center = box.getCenter(target);
            target.y += 2 * size.y;
            controls.target = target;

            dimension.min = box.min;
            dimension.max = box.max;
            dimension.center = center;
            dimension.size = size;

            camera.position.x = center.x - 5 * size.x;
            camera.position.y = center.y + 5 * size.y;
            camera.position.z = center.z - 5 * size.z;
            camera.updateProjectionMatrix();
            controls.update();

            // illuminate the scene for better view
            const light = new THREE.DirectionalLight(0xffffff, 5);
            light.position.copy(camera.position);
            light.castShadow = true;

            light.lookAt(target.x, target.y, target.z);
            light.angle = Math.PI * 0.2;
            light.decay = 0;
            light.shadow.mapSize.setScalar(1024);

            const shadowCam = light.shadow.camera;
            shadowCam.near = 0.01;
            shadowCam.far = 2000;
            shadowCam.bias = 1e-5;
            shadowCam.left = shadowCam.bottom = -10;
            shadowCam.right = shadowCam.top = 10;
            scene.add(light);

            /* events */
            window.addEventListener('resize', e => {

                windwoWidth = window.innerWidth;
                windowHeight = window.innerHeight;
                camera.aspect = windwoWidth / windowHeight;
                camera.updateProjectionMatrix();

                renderer.setSize(windwoWidth, windowHeight);
                renderLoop.requestRender();
            });

            renderLoop.requestRender();

        },
        function (xhr) {
            // console.log((xhr.loaded / xhr.total * 100) + '% loaded');
        },
        function (error) {
            console.log(error);
        });
}

function renderFrame(deltaSec = 1 / FRAME_RATE) {
    const delta = Math.min(deltaSec, 1 / params.frameRate);

    stats.update();
    if (mixer) {
        mixer.update(delta);
    }

    if (isDissolving) {
        let hasActiveDissolve = false;
        for (let shader of shaders) {
            let { dissolveProgress, dissolveSpeed } = shader.uniforms;
            dissolveProgress.value += dissolveSpeed.value;
            if (dissolveProgress.value >= 0 && dissolveProgress.value <= 1) {
                hasActiveDissolve = true;
            }
        }

        if (!hasActiveDissolve) {
            isDissolving = false;
            updateContinuousState();
        }
    }

    renderer.render(scene, camera);
}

function updateContinuousState() {
    const shouldContinuousRender = hasMixerAnimation || isDissolving;
    renderLoop.setContinuous(shouldContinuousRender);
    if (!shouldContinuousRender) {
        renderLoop.requestRender();
    }
}

/* utils */

function setDissolveShader(shader, type = 1) {
    function setCommon(shader) {

        shader.uniforms.edgeColor = { value: new THREE.Color(params.edgeColor) };
        shader.uniforms.edgeWidth = { value: params.edgeWidth };
        shader.uniforms.dissolveSpeed = { value: params.dissolveSpeed };
        shader.uniforms.dissolveProgress = { value: params.dissolveProgress };
        shader.uniforms.noiseTexture = { value: params.noiseTexture };
        shader.uniforms.edgeColorTexture = { value: params.edgeColorTexture };

        shader.vertexShader = shader.vertexShader.replace(
            '#include <common>',
            DISSOLVE_VERTEX_COMMON
        );

        shader.vertexShader = shader.vertexShader.replace(
            '#include <uv_vertex>',
            DISSOLVE_VERTEX_UV
        );

        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <common>',
            DISSOLVE_FRAGMENT_COMMON
        );
    }

    setCommon(shader);
    const fragmentBody = type === 0 ? DISSOLVE_FRAGMENT_TYPE0 : DISSOLVE_FRAGMENT_TYPE1;
    shader.fragmentShader = shader.fragmentShader.replace('#include <dithering_fragment>', fragmentBody);

}

function appear() {

    if (isDissolving) return;
    isDissolving = true;
    updateContinuousState();
    signedDissolveSpeed = params.dissolveSpeed;

    for (let shader of shaders) {
        shader.uniforms.dissolveSpeed = { value: signedDissolveSpeed };
        shader.uniforms.dissolveProgress = { value: 0 };
    }
    renderLoop.requestRender();
}

function disappear() {

    if (isDissolving) return;
    isDissolving = true;
    updateContinuousState();
    signedDissolveSpeed = -params.dissolveSpeed;

    for (let shader of shaders) {
        shader.uniforms.dissolveSpeed = { value: signedDissolveSpeed };
        shader.uniforms.dissolveProgress = { value: 1 };
    }
    renderLoop.requestRender();

}
