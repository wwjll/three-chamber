import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { Chain } from '../extend/kinematic/Chain.js';
import { ConvertDH, ConvertMDH } from '../extend/kinematic/Utils.js';

let scene, camera, renderer, controls, gui;
let createFolder, armsFolder, styleFolder;
let chain;
let suppressUpdate = false;
const BG_COLOR = 0x2b2b2b;

const styleParams = {
    jointColor: 0x7d7d7d,
    linkColor: 0x000000,
    randomJointColor: true,
    randomLinkColor: false,
    jointRadius: 0.025,
    jointHeight: 0.05,
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

const defaultStyleParams = JSON.parse(JSON.stringify(styleParams));

const baseParams = {
    mdhMode: false,
    useConvertedParams: false,
    baseOffset: { x: 0, y: 0, z: 0 }
};

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
        chain.generate([], styleParams, baseParams);
    },
    addArmSegment: function (initialParams) {
        initialParams = initialParams || {};
        const linkIndex = this.armSegments.length;
        const armParams = {
            theta: initialParams.theta ?? 0,
            thetaOffset: initialParams.thetaOffset ?? 0,
            d: initialParams.d ?? 0,
            a: initialParams.a ?? 1,
            alpha: initialParams.alpha ?? 0,
            minAngle: initialParams.minAngle ?? 0,
            maxAngle: initialParams.maxAngle ?? 360,
            name: `link_${linkIndex + 1}`,
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
        armFolder
            .add(armParams, 'thetaOffset', armParams.minAngle, armParams.maxAngle)
            .name('Theta Offset')
            .onFinishChange(updateArm);
        armFolder.add(armParams, 'd', -10, 10).name('d').onFinishChange(updateArm);
        armFolder.add(armParams, 'a', -10, 10).name('a').onFinishChange(updateArm);
        armFolder.add(armParams, 'alpha', -180, 180).name('Alpha').onFinishChange(updateArm);
        armFolder.add(armParams, 'remove').name('Remove Arm Segment');
        armFolder.open();

        gui.domElement.scrollTop = gui.domElement.scrollHeight;
        updateArm();
    }
};

function segmentsToParamArray(segments) {
    return segments.map(segment => [
        segment.theta ?? 0,
        segment.d ?? 0,
        segment.a ?? 0,
        segment.alpha ?? 0,
        segment.thetaOffset ?? 0,
        segment.minAngle ?? -185,
        segment.maxAngle ?? 185
    ]);
}

function rebuildSegmentsFromArray(paramArray) {
    suppressUpdate = true;
    [...armsFolder.folders].forEach(folder => folder.destroy());
    createParams.armSegments.length = 0;
    paramArray.forEach(params => {
        createParams.addArmSegment({
            theta: params[0],
            d: params[1],
            a: params[2],
            alpha: params[3],
            thetaOffset: params[4],
            minAngle: params[5],
            maxAngle: params[6]
        });
    });
    suppressUpdate = false;
    updateArm();
}

const presets = {
    'TEST': {
        segments: [
            { theta: 0, d: 0.5, a: 1, alpha: 90, thetaOffset: 0, minAngle: -185, maxAngle: 185 },
            { theta: 0, d: 0.5, a: 1, alpha: 90, thetaOffset: 0, minAngle: -185, maxAngle: 185 },
            { theta: 0, d: 0, a: 1, alpha: 90, thetaOffset: 0, minAngle: -185, maxAngle: 185 },
        ]
    },
    'KUKA KR5': {
        segments: [
            { theta: 0, d: 0.4, a: 0.18, alpha: 90, minAngle: -185, maxAngle: 185 },
            { theta: 90, d: 0, a: 0.6, alpha: 0, minAngle: -155, maxAngle: 35 },
            { theta: 0, d: 0, a: 0.12, alpha: 90, minAngle: -130, maxAngle: 154 },
            { theta: 0, d: 0.62, a: 0, alpha: 90, minAngle: -350, maxAngle: 350 },
            { theta: 0, d: 0, a: 0, alpha: 90, minAngle: -130, maxAngle: 130 },
            { theta: 0, d: 0.115, a: 0, alpha: 0, minAngle: -350, maxAngle: 350 }
        ]
    },
    'PUMA 560': {
        segments: [
            { theta: 0, d: 0.67183, a: 0.0, alpha: 90, minAngle: -160, maxAngle: 160 },
            { theta: 0, d: 0.0, a: 0.4318, alpha: 0, minAngle: -110, maxAngle: 110 },
            { theta: 0, d: 0.15005, a: 0.0203, alpha: -90, minAngle: -135, maxAngle: 135 },
            { theta: 0, d: 0.4318, a: 0.0, alpha: 90, minAngle: -266, maxAngle: 266 },
            { theta: 0, d: 0.0, a: 0.0, alpha: -90, minAngle: -100, maxAngle: 100 },
            { theta: 0, d: 0.0, a: 0.0, alpha: 0, minAngle: -266, maxAngle: 266 }
        ]
    },
    'Simple 6-DOF': {
        segments: [
            { theta: 0, d: 0.5, a: 0, alpha: 0 },
            { theta: 0, d: 0.5, a: 0, alpha: 0 },
            { theta: 0, d: 0.5, a: 0, alpha: 0 },
            { theta: 0, d: 0.5, a: 0, alpha: 0 },
            { theta: 0, d: 0.5, a: 0, alpha: 0 },
            { theta: 0, d: 0.25, a: 0, alpha: 0 }
        ]
    }
};

function loadPreset(name) {
    const preset = presets[name];
    if (!preset) return;

    const paramsArray = preset.segments.map(params => [
        params.theta ?? 0,
        params.d ?? 0,
        params.a ?? 0,
        params.alpha ?? 0,
        params.thetaOffset ?? 0,
        params.minAngle ?? -185,
        params.maxAngle ?? 185
    ]);
    if (baseParams.mdhMode) {
        baseParams.useConvertedParams = true;
        rebuildSegmentsFromArray(ConvertMDH(paramsArray));
    } else {
        baseParams.useConvertedParams = false;
        rebuildSegmentsFromArray(paramsArray);
    }
}

const demoParams = {
    'TEST': () => loadPreset('TEST'),
    'KUKA KR5': () => loadPreset('KUKA KR5'),
    'PUMA 560': () => loadPreset('PUMA 560'),
    'Simple 6-DOF': () => loadPreset('Simple 6-DOF')
};

init();

function init() {
    scene = new THREE.Scene();

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

    const gridHelper = new THREE.GridHelper(20, 20);
    scene.add(gridHelper);

    // comparing with threejs default world frame
    // const axesHelper = new THREE.AxesHelper(2);
    // scene.add(axesHelper);

    chain = new Chain(scene);

    gui = new GUI();
    gui.domElement.style.right = 'auto';
    gui.domElement.style.left = '0px';
    gui.domElement.style.top = '0px';
    gui.domElement.style.margin = '0px';
    gui.domElement.style.maxHeight = '100vh';
    gui.domElement.style.overflow = 'auto';

    createFolder = gui.addFolder('Create');
    createFolder.add(createParams, 'addArmSegment').name('Add Arm Segment');
    createFolder.add(createParams, 'reset').name('Reset');
    createFolder.open();

    const demoFolder = gui.addFolder('Demo');
    demoFolder.add(demoParams, 'TEST');
    demoFolder.add(demoParams, 'KUKA KR5');
    demoFolder.add(demoParams, 'PUMA 560');
    demoFolder.add(demoParams, 'Simple 6-DOF');
    demoFolder.open();

    const baseFolder = gui.addFolder('Base');
    baseFolder.add(baseParams, 'mdhMode').name('MDH Mode').onFinishChange((value) => {
        const params = segmentsToParamArray(createParams.armSegments);
        const converted = value ? ConvertMDH(params) : ConvertDH(params);
        baseParams.useConvertedParams = value;
        rebuildSegmentsFromArray(converted);
    });
    const baseOffsetFolder = baseFolder.addFolder('Offset');
    baseOffsetFolder.add(baseParams.baseOffset, 'x', -10, 10).name('Offset X').onFinishChange(updateArm);
    baseOffsetFolder.add(baseParams.baseOffset, 'y', -10, 10).name('Offset Y').onFinishChange(updateArm);
    baseOffsetFolder.add(baseParams.baseOffset, 'z', -10, 10).name('Offset Z').onFinishChange(updateArm);
    baseFolder.open();

    styleFolder = gui.addFolder('Viz');
    const jointsLinksFolder = styleFolder.addFolder('Joints && Links');
    jointsLinksFolder.addColor(styleParams, 'jointColor').name('Joint Color').onFinishChange(updateArm).onChange(saveStyles);
    jointsLinksFolder.addColor(styleParams, 'linkColor').name('Link Color').onFinishChange(updateArm).onChange(saveStyles);
    jointsLinksFolder.add(styleParams, 'randomJointColor').name('Random Joint Color').onFinishChange(updateArm).onChange(saveStyles);
    jointsLinksFolder.add(styleParams, 'randomLinkColor').name('Random Link Color').onFinishChange(updateArm).onChange(saveStyles);
    jointsLinksFolder.add(styleParams, 'jointRadius', 0.01, 0.5).name('Joint Radius').onFinishChange(updateArm).onChange(saveStyles);
    jointsLinksFolder.add(styleParams, 'jointHeight', 0.01, 0.5).name('Joint Height').onFinishChange(updateArm).onChange(saveStyles);
    jointsLinksFolder.add(styleParams, 'linkRadius', 0.01, 0.2).name('Link Radius').onFinishChange(updateArm).onChange(saveStyles);
    jointsLinksFolder.add(styleParams, 'syncUp').name('Sync Up').onFinishChange(updateArm).onChange(saveStyles);

    const helpersFolder = styleFolder.addFolder('Helpers');
    const axisFolder = helpersFolder.addFolder('Axis');
    axisFolder.add(styleParams, 'showAxisHelper').name('Axis Helper').onFinishChange(updateArm).onChange(saveStyles);
    axisFolder.add(styleParams, 'axisHelperSize', 0.01, 2).name('Axis Size').onFinishChange(updateArm).onChange(saveStyles);

    const dofFolder = helpersFolder.addFolder('DOF');
    dofFolder.add(styleParams, 'showDOFHelper').name('DOF Helper').onFinishChange(updateArm).onChange(saveStyles);
    dofFolder.addColor(styleParams, 'dofColor').name('DOF Color').onFinishChange(updateArm).onChange(saveStyles);
    dofFolder.add(styleParams, 'dofOpacity', 0, 1).name('DOF Opacity').onFinishChange(updateArm).onChange(saveStyles);
    dofFolder.add(styleParams, 'dofUseJointColor').name('Use Random Color').onFinishChange(updateArm).onChange(saveStyles);
    dofFolder.add(styleParams, 'dofUseAutoRadius').name('DOF Auto Radius').onFinishChange(updateArm).onChange(saveStyles);
    dofFolder.add(styleParams, 'dofRadius', 0.001, 2).name('DOF Radius').onFinishChange(updateArm).onChange(saveStyles);
    dofFolder.add(styleParams, 'dofRadiusScale', 0.01, 1).name('DOF Radius Scale').onFinishChange(updateArm).onChange(saveStyles);
    dofFolder.add(styleParams, 'dofThicknessRatio', 0.01, 1).name('DOF Thickness').onFinishChange(updateArm).onChange(saveStyles);
    dofFolder.add(styleParams, 'dofSegments', 3, 128, 1).name('DOF Segments').onFinishChange(updateArm).onChange(saveStyles);
    dofFolder.add(styleParams, 'dofOffsetZ', 0, 0.01).name('DOF Offset Z').onFinishChange(updateArm).onChange(saveStyles);

    styleFolder.add({ reset: resetStyles }, 'reset').name('Reset Styles');
    styleFolder.open();

    armsFolder = gui.addFolder('Link');
    armsFolder.open();

    window.addEventListener('resize', () => {
        const windwoWidth = window.innerWidth;
        const windowHeight = window.innerHeight;
        renderer.setSize(windwoWidth, windowHeight);
        camera.aspect = windwoWidth / windowHeight;
        camera.updateProjectionMatrix();
        if (chain.roboticArm) {
            const target = chain.roboticArm.children.find(
                (child) => child.material && child.material.resolution
            );
            if (target) {
                target.material.resolution.set(windwoWidth, windowHeight);
            }
        }
    });

    animate();
}

function updateArm() {
    if (suppressUpdate) return;
    const dhParameters = createParams.armSegments.map(segment => {
        const theta = THREE.MathUtils.degToRad(segment.theta);
        const thetaOffset = THREE.MathUtils.degToRad(segment.thetaOffset ?? 0);
        const d = segment.d;
        const a = segment.a;
        const alpha = THREE.MathUtils.degToRad(segment.alpha);
        return [theta, d, a, alpha, thetaOffset, segment.minAngle, segment.maxAngle];
    });
    chain.update(dhParameters, styleParams, baseParams);
}

function animate() {
    requestAnimationFrame(animate);
    renderer.render(scene, camera);
    controls.update();
}
