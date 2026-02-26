

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TextureLoader } from 'three/src/loaders/TextureLoader.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import Stats from 'three/examples/jsm/libs/stats.module.js';

import { getAssetURL } from '/extend/tools/Tool.js'

const assetUrl = getAssetURL();
const noiseTexture = assetUrl + "textures/noise.png"
const fireTexture = assetUrl + "textures/fire.jpg"
const modelUrl = assetUrl + "models/soldier.glb"

let camera, scene, renderer, controls, mixer;
let clock, stats, gui;

/* defines */
const BG_COLOR = 0x111111;
const FRAME_INTERVAL = 1 / 30;

/* global variables */
let windwoWidth = window.innerWidth;
let windowHeight = window.innerHeight;
const dimension = {
    center: new THREE.Vector3(),
    min: new THREE.Vector3(),
    max: new THREE.Vector3()
};
let dt = 0;
let shaders = [];
let isDissolving = false;
let params = {
    times: 'repeat',
    edgeColor: 0xfa9200,
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
render();

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

    clock = new THREE.Clock();
    stats = new Stats();
    document.body.appendChild(stats.dom);

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
                gui = new GUI();
                gui.addColor(params, 'edgeColor').onChange(v => {

                    for (let shader of shaders) {
                        shader.uniforms.edgeColor = { value: new THREE.Color(v) };
                    }

                });
                gui.add(params, 'edgeWidth', 0.01, 1).step(0.01).onChange(v => {

                    for (let shader of shaders) {
                        shader.uniforms.edgeWidth = { value: v };
                    }

                });

                gui.add(params, 'dissolveSpeed', 0.01, 0.1).step(0.01);
                gui.add(params, 'appear');
                gui.add(params, 'disappear');

            }

            // animations
            const animations = gltf.animations;
            mixer = new THREE.AnimationMixer(model);

            if (animations && animations.length > 0) {
                const animationAction = mixer.clipAction(animations[3]);
                animationAction.play();
                animationAction.paused = false;
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
            });


        },
        function (xhr) {
            // console.log((xhr.loaded / xhr.total * 100) + '% loaded');
        },
        function (error) {
            console.log(error);
        });
}

function render() {
    requestAnimationFrame(render);

    let time = clock.getDelta();
    const delta = Math.min(time, FRAME_INTERVAL);

    dt += time;
    if (dt > FRAME_INTERVAL) {

        stats.update();
        mixer && mixer.update(delta);

        if (isDissolving) {

            for (let shader of shaders) {
                let { dissolveProgress, dissolveSpeed } = shader.uniforms;
                dissolveProgress.value += dissolveSpeed.value;
                if (dissolveProgress.value < 0) {
                    isDissolving = false;
                }
                if (dissolveProgress.value > 1) {
                    isDissolving = false;
                }
            }

        }

        renderer.render(scene, camera);

        dt %= FRAME_INTERVAL;
    }
}

/* utils */

function setDissolveShader(shader, type = 1) {

    const _types = [

        function _type0(shader) {

            setCommon(shader);

            // shader main
            shader.fragmentShader = shader.fragmentShader.replace(
                '#include <dithering_fragment>',
        /* glsl */`
            #include <dithering_fragment>
            float noiseValue = texture2D(noiseTexture, xUv).r;
            vec4 finalColor = linearToOutputTexel( vec4(edgeColor, gl_FragColor.a) );
            if(noiseValue > dissolveProgress)
            {
                discard;
            }
            
            if(noiseValue + edgeWidth > dissolveProgress){
                gl_FragColor = vec4(finalColor.rgb, 1.0);
            }
        `

            );

        },
        function _type1(shader) {

            setCommon(shader);

            // shader main
            shader.fragmentShader = shader.fragmentShader.replace(
                '#include <dithering_fragment>',
        /* glsl */`
            #include <dithering_fragment>
            float noiseValue = texture2D(noiseTexture, xUv).r;
            
            vec4 finalColor = texture2D(edgeColorTexture, xUv);
            // vec4 finalColor = linearToOutputTexel( vec4(edgeColor, gl_FragColor.a) );

            float alpha = step(noiseValue - edgeWidth, dissolveProgress);
            gl_FragColor.a = alpha;

            float useOrigin = step(noiseValue, dissolveProgress);
            gl_FragColor.rgb = mix(finalColor.rgb, gl_FragColor.rgb, useOrigin);

        `
            );

        }

    ];


    function setCommon(shader) {

        shader.uniforms.edgeColor = { value: new THREE.Color(params.edgeColor) };
        shader.uniforms.edgeWidth = { value: params.edgeWidth };
        shader.uniforms.dissolveSpeed = { value: params.dissolveSpeed };
        shader.uniforms.dissolveProgress = { value: params.dissolveProgress };
        shader.uniforms.noiseTexture = { value: params.noiseTexture };
        shader.uniforms.edgeColorTexture = { value: params.edgeColorTexture };

        shader.vertexShader = shader.vertexShader.replace(
            '#include <common>',
            [
                'varying vec2 xUv;',
                '#include <common>'
            ].join('\n')
        );

        shader.vertexShader = shader.vertexShader.replace(
            '#include <uv_vertex>',
            [
                'xUv = uv;',
                '#include <uv_vertex>'
            ].join('\n')
        );

        // shader headers
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <common>',
    /* glsl */ `
        #include <common>
        uniform float dissolveProgress;
        uniform float edgeWidth;
        uniform vec3 edgeColor;
        uniform sampler2D noiseTexture;
        uniform sampler2D edgeColorTexture;
        varying vec2 xUv;
    `
        );

    }

    _types[type](shader);

}

function appear() {

    if (isDissolving) return;
    isDissolving = true;
    signedDissolveSpeed = params.dissolveSpeed;

    for (let shader of shaders) {
        shader.uniforms.dissolveSpeed = { value: signedDissolveSpeed };
        shader.uniforms.dissolveProgress = { value: 0 };
    }
}

function disappear() {

    if (isDissolving) return;
    isDissolving = true;
    signedDissolveSpeed = -params.dissolveSpeed;

    for (let shader of shaders) {
        shader.uniforms.dissolveSpeed = { value: signedDissolveSpeed };
        shader.uniforms.dissolveProgress = { value: 1 };
    }

}