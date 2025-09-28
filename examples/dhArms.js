import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { Chain } from '../extend/kinematic/Chain.js';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';

let scene, camera, renderer, controls, gui;
let createFolder, armsFolder, styleFolder;
let chain;

const styleParams = {
    jointColor: 0xff0000,
    linkColor: 0x00ff00,
    offsetColor: 0x333333,
    offsetLineWidth: 5,
    jointRadius: 0.05,
    jointHeight: 0.1,
    linkRadius: 0.03
};

const defaultStyleParams = JSON.parse(JSON.stringify(styleParams));

function resetStyles() {
    Object.assign(styleParams, defaultStyleParams);
    saveStyles();
    updateArm();
    styleFolder.controllers.forEach(c => c.updateDisplay());
}

function saveStyles() {
    localStorage.setItem('dhArmStyles', JSON.stringify(styleParams));
}

function loadStyles() {
    const savedStyles = localStorage.getItem('dhArmStyles');
    if (savedStyles) {
        Object.assign(styleParams, JSON.parse(savedStyles));
    }
}

loadStyles();

const createParams = {
    armSegments: [],
    reset: function () {
        [...armsFolder.folders].forEach(folder => {
            folder.destroy();
        });
        createParams.armSegments.length = 0;
        chain.generate([], styleParams);
    },
    addArmSegment: function (initialParams) {
        initialParams = initialParams || {};
        const armIndex = this.armSegments.length;
        const armParams = {
            theta: initialParams.theta ?? 0,
            d: initialParams.d ?? 0,
            a: initialParams.a ?? 1,
            alpha: initialParams.alpha ?? 0,
            name: `arm_${armIndex + 1}`,
            remove: null
        };
        this.armSegments.push(armParams);

        const armFolder = armsFolder.addFolder(armParams.name);

        armParams.remove = function () {
            const armIndex = createParams.armSegments.indexOf(armParams);
            if (armIndex > -1) {
                createParams.armSegments.splice(armIndex, 1);
            }
            armFolder.destroy();
            updateArm();
        };

        armFolder.add(armParams, 'theta', -180, 180).name('Theta').onFinishChange(updateArm);
        armFolder.add(armParams, 'd', 0, 10).name('d').onFinishChange(updateArm);
        armFolder.add(armParams, 'a', 0, 10).name('a').onFinishChange(updateArm);
        armFolder.add(armParams, 'alpha', -180, 180).name('Alpha').onFinishChange(updateArm);
        armFolder.add(armParams, 'remove').name('Remove Arm Segment');
        armFolder.open();
    }
};

const presets = {
    'KUKA KR5': [
        { theta: 0, d: 0.335, a: 0.075, alpha: -90 },
        { theta: 0, d: 0, a: 0.270, alpha: 0 },
        { theta: 0, d: 0, a: 0.090, alpha: 90 },
        { theta: 0, d: 0.302, a: 0, alpha: -90 },
        { theta: 0, d: 0, a: 0, alpha: 90 },
        { theta: 0, d: 0.078, a: 0, alpha: 0 }
    ],
    'PUMA 560': [
        { theta: 0, d: 0, a: 0, alpha: -90 },
        { theta: 0, d: 0, a: 0.4318, alpha: 0 },
        { theta: 0, d: 0.15005, a: -0.0203, alpha: 90 },
        { theta: 0, d: 0.4318, a: 0, alpha: -90 },
        { theta: 0, d: 0, a: 0, alpha: 90 },
        { theta: 0, d: 0, a: 0, alpha: 0 }
    ],
    'Simple 6-DOF': [
        { theta: 0, d: 0.5, a: 0, alpha: 0 },
        { theta: 0, d: 0.5, a: 0, alpha: 0 },
        { theta: 0, d: 0.5, a: 0, alpha: 0 },
        { theta: 0, d: 0.5, a: 0, alpha: 0 },
        { theta: 0, d: 0.5, a: 0, alpha: 0 },
        { theta: 0, d: 0.25, a: 0, alpha: 0 }
    ]
};

function loadPreset(name) {
    const presetParams = presets[name];
    if (!presetParams) return;

    [...armsFolder.folders].forEach(folder => folder.destroy());
    createParams.armSegments.length = 0;

    presetParams.forEach(params => {
        createParams.addArmSegment(params);
    });

    updateArm();
}

const demoParams = {
    'KUKA KR5': () => loadPreset('KUKA KR5'),
    'PUMA 560': () => loadPreset('PUMA 560'),
    'Simple 6-DOF': () => loadPreset('Simple 6-DOF')
};

init();

function init() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xffffff);

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(2, 2, 2);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(0xffffff);
    document.body.appendChild(renderer.domElement);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0, 0.5);
    controls.update();

    const gridHelper = new THREE.GridHelper(20, 20);
    scene.add(gridHelper);

    chain = new Chain(scene);

    gui = new GUI();

    armsFolder = gui.addFolder('Arms');
    armsFolder.open();

    createFolder = gui.addFolder('Create');
    createFolder.add(createParams, 'addArmSegment').name('Add Arm Segment');
    createFolder.add({ generate: updateArm }, 'generate').name('Generate Arm');
    createFolder.add(createParams, 'reset').name('Reset');
    createFolder.open();

    const demoFolder = gui.addFolder('Demo');
    demoFolder.add(demoParams, 'KUKA KR5');
    demoFolder.add(demoParams, 'PUMA 560');
    demoFolder.add(demoParams, 'Simple 6-DOF');
    demoFolder.open();

    styleFolder = gui.addFolder('Style');
    styleFolder.addColor(styleParams, 'jointColor').name('Joint Color').onFinishChange(updateArm).onChange(saveStyles);
    styleFolder.addColor(styleParams, 'linkColor').name('Link Color').onFinishChange(updateArm).onChange(saveStyles);
    styleFolder.addColor(styleParams, 'offsetColor').name('Offset Color').onFinishChange(updateArm).onChange(saveStyles);
    styleFolder.add(styleParams, 'jointRadius', 0.01, 0.5).name('Joint Radius').onFinishChange(updateArm).onChange(saveStyles);
    styleFolder.add(styleParams, 'jointHeight', 0.01, 0.5).name('Joint Height').onFinishChange(updateArm).onChange(saveStyles);
    styleFolder.add(styleParams, 'linkRadius', 0.01, 0.2).name('Link Radius').onFinishChange(updateArm).onChange(saveStyles);
    styleFolder.add(styleParams, 'offsetLineWidth', 1, 20).name('Offset Line Width').onFinishChange(updateArm).onChange(saveStyles);
    styleFolder.add({ reset: resetStyles }, 'reset').name('Reset Styles');
    styleFolder.open();

    window.addEventListener('resize', () => {
        const windwoWidth = window.innerWidth;
        const windowHeight = window.innerHeight;
        renderer.setSize(windwoWidth, windowHeight);
        camera.aspect = windwoWidth / windowHeight;
        camera.updateProjectionMatrix();
        if (chain.roboticArm) {
            const lineMat = chain.roboticArm.children[0].material;
            lineMat.resolution.set(windwoWidth, windowHeight);
        }
    });

    animate();
}

function updateArm() {
    const dhParameters = createParams.armSegments.map(segment => {
        const theta = THREE.MathUtils.degToRad(segment.theta);
        const d = segment.d;
        const a = segment.a;
        const alpha = THREE.MathUtils.degToRad(segment.alpha);
        return [theta, d, a, alpha];
    });
    chain.update(dhParameters, styleParams);
}

function animate() {
    requestAnimationFrame(animate);
    renderer.render(scene, camera);
    controls.update();
}