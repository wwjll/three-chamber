import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Pane } from 'tweakpane';
import { getRenderLoopController } from '../extend/tools/Tool.js';
import { Chain } from '../extend/kinematic/Chain.js';
import { ConvertDH, ConvertMDH } from '../extend/kinematic/Utils.js';

let scene, camera, renderer, controls, pane;
let createFolder, armsFolder, styleFolder;
let chain;
let suppressUpdate = false;
let armFolderApis = [];
let styleBindings = [];
const BG_COLOR = 0x2b2b2b;
const FRAME_RATE = 30;
const renderLoop = getRenderLoopController();

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
    for (const binding of styleBindings) {
        if (typeof binding.refresh === 'function') {
            binding.refresh();
        }
    }
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
        for (const folder of armFolderApis) {
            folder.dispose();
        }
        armFolderApis = [];
        createParams.armSegments.length = 0;
        chain.generate([], styleParams, baseParams);
        renderLoop.requestRender();
    },
    addArmSegment: function (initialParams) {
        initialParams = initialParams || {};
        const linkIndex = this.armSegments.length;
        const armParams = {
            theta: initialParams.theta ?? 0,
            axisSign: initialParams.axisSign === -1 ? -1 : 1,
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

        const armFolder = armsFolder.addFolder({ title: armParams.name });
        armFolderApis.push(armFolder);

        armParams.remove = function () {
            const armIndex = createParams.armSegments.indexOf(armParams);
            if (armIndex > -1) {
                createParams.armSegments.splice(armIndex, 1);
            }
            const folderIndex = armFolderApis.indexOf(armFolder);
            if (folderIndex > -1) {
                armFolderApis.splice(folderIndex, 1);
            }
            armFolder.dispose();
            updateArm();
        };

        armFolder.addBinding(armParams, 'theta', { min: -180, max: 180, label: 'Theta' }).on('change', (ev) => {
            if (ev.last === false) return;
            updateArm();
        });
        armFolder.addBinding(armParams, 'axisSign', {
            label: 'Axis Sign',
            options: { '+1': 1, '-1': -1 }
        }).on('change', (ev) => {
            if (ev.last === false) return;
            updateArm();
        });
        armFolder.addBinding(armParams, 'thetaOffset', {
            min: armParams.minAngle,
            max: armParams.maxAngle,
            label: 'Theta Offset'
        }).on('change', (ev) => {
            if (ev.last === false) return;
            updateArm();
        });
        armFolder.addBinding(armParams, 'd', { min: -10, max: 10, label: 'd' }).on('change', (ev) => {
            if (ev.last === false) return;
            updateArm();
        });
        armFolder.addBinding(armParams, 'a', { min: -10, max: 10, label: 'a' }).on('change', (ev) => {
            if (ev.last === false) return;
            updateArm();
        });
        armFolder.addBinding(armParams, 'alpha', { min: -180, max: 180, label: 'Alpha' }).on('change', (ev) => {
            if (ev.last === false) return;
            updateArm();
        });
        armFolder.addButton({ title: 'Remove Arm Segment' }).on('click', () => {
            armParams.remove();
        });
        armFolder.expanded = true;

        pane.element.scrollTop = pane.element.scrollHeight;
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
        segment.maxAngle ?? 185,
        segment.axisSign === -1 ? -1 : 1
    ]);
}

function rebuildSegmentsFromArray(paramArray) {
    suppressUpdate = true;
    for (const folder of armFolderApis) {
        folder.dispose();
    }
    armFolderApis = [];
    createParams.armSegments.length = 0;
    paramArray.forEach(params => {
        createParams.addArmSegment({
            theta: params[0],
            d: params[1],
            a: params[2],
            alpha: params[3],
            thetaOffset: params[4],
            minAngle: params[5],
            maxAngle: params[6],
            axisSign: params[7]
        });
    });
    suppressUpdate = false;
    updateArm();
}

function convertAxisLimitsToDh(segment) {
    // Convert axis-space limits to DH-space limits.
    // Wrap intervals (min > max) are preserved so DOF helper and solver share semantics.
    const axisSign = segment.axisSign === -1 ? -1 : 1;
    const thetaOffsetDeg = Number.isFinite(segment.thetaOffset) ? segment.thetaOffset : 0;
    const minAxisDeg = Number.isFinite(segment.minAngle) ? segment.minAngle : -185;
    const maxAxisDeg = Number.isFinite(segment.maxAngle) ? segment.maxAngle : 185;
    const isWrap = minAxisDeg > maxAxisDeg;

    const mappedMin = axisSign * minAxisDeg + thetaOffsetDeg;
    const mappedMax = axisSign * maxAxisDeg + thetaOffsetDeg;

    if (!isWrap) {
        return mappedMin <= mappedMax
            ? [mappedMin, mappedMax]
            : [mappedMax, mappedMin];
    }

    return axisSign === 1
        ? [mappedMin, mappedMax]
        : [mappedMax, mappedMin];
}

const presets = {
    'TEST': {
        segments: [
            { theta: 0, d: 0.5, a: 1, alpha: 90, thetaOffset: 0, minAngle: -185, maxAngle: 185, axisSign: 1 },
            { theta: 0, d: 0.5, a: 1, alpha: 90, thetaOffset: 0, minAngle: -185, maxAngle: 185, axisSign: 1 },
            { theta: 0, d: 0, a: 1, alpha: 90, thetaOffset: 0, minAngle: -185, maxAngle: 185, axisSign: 1 },
        ]
    },
    'KUKA KR5': {
        segments: [
            { theta: 0, d: 0.4, a: 0.18, alpha: 90, thetaOffset: 0, minAngle: -155, maxAngle: 155, axisSign: 1 },
            { theta: 90, d: 0, a: 0.6, alpha: 0, thetaOffset: 0, minAngle: -180, maxAngle: 65, axisSign: -1 },
            { theta: 0, d: 0, a: 0.12, alpha: 90, thetaOffset: 0, minAngle: -15, maxAngle: 158, axisSign: 1 },
            { theta: 0, d: 0.62, a: 0, alpha: -90, thetaOffset: 0, minAngle: -350, maxAngle: 350, axisSign: 1 },
            { theta: 0, d: 0, a: 0, alpha: 90, thetaOffset: 0, minAngle: -130, maxAngle: 130, axisSign: 1 },
            { theta: 0, d: 0.115, a: 0, alpha: 0, thetaOffset: 0, minAngle: -350, maxAngle: 350, axisSign: 1 }
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
        params.maxAngle ?? 185,
        params.axisSign === -1 ? -1 : 1
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
    controls.addEventListener('change', () => {
        renderLoop.requestRender();
    });

    const gridHelper = new THREE.GridHelper(20, 20);
    scene.add(gridHelper);

    chain = new Chain(scene);
    renderLoop.configure({
        fps: FRAME_RATE,
        render: renderFrame
    });
    renderLoop.setRenderOnIdle(false);

    pane = new Pane({ title: 'DH Links' });
    pane.element.style.right = 'auto';
    pane.element.style.left = '0px';
    pane.element.style.top = '0px';
    pane.element.style.margin = '0px';
    pane.element.style.maxHeight = '100vh';
    pane.element.style.overflow = 'auto';

    const bindStyle = (folder, key, options = {}) => {
        const binding = folder.addBinding(styleParams, key, options);
        binding.on('change', (ev) => {
            if (ev.last === false) return;
            updateArm();
            saveStyles();
        });
        styleBindings.push(binding);
        return binding;
    };

    createFolder = pane.addFolder({ title: 'Create' });
    createFolder.addButton({ title: 'Add Arm Segment' }).on('click', () => createParams.addArmSegment());
    createFolder.addButton({ title: 'Reset' }).on('click', () => createParams.reset());
    createFolder.expanded = true;

    const demoFolder = pane.addFolder({ title: 'Demo' });
    demoFolder.addButton({ title: 'TEST' }).on('click', () => demoParams.TEST());
    demoFolder.addButton({ title: 'KUKA KR5' }).on('click', () => demoParams['KUKA KR5']());
    demoFolder.addButton({ title: 'PUMA 560' }).on('click', () => demoParams['PUMA 560']());
    demoFolder.addButton({ title: 'Simple 6-DOF' }).on('click', () => demoParams['Simple 6-DOF']());
    demoFolder.expanded = true;

    const baseFolder = pane.addFolder({ title: 'Base' });
    baseFolder.addBinding(baseParams, 'mdhMode', { label: 'MDH Mode' }).on('change', (ev) => {
        if (ev.last === false) return;
        const value = ev.value;
        const params = segmentsToParamArray(createParams.armSegments);
        const converted = value ? ConvertMDH(params) : ConvertDH(params);
        baseParams.useConvertedParams = value;
        rebuildSegmentsFromArray(converted);
    });
    const baseOffsetFolder = baseFolder.addFolder({ title: 'Offset' });
    baseOffsetFolder.addBinding(baseParams.baseOffset, 'x', { min: -10, max: 10, label: 'Offset X' }).on('change', (ev) => {
        if (ev.last === false) return;
        updateArm();
    });
    baseOffsetFolder.addBinding(baseParams.baseOffset, 'y', { min: -10, max: 10, label: 'Offset Y' }).on('change', (ev) => {
        if (ev.last === false) return;
        updateArm();
    });
    baseOffsetFolder.addBinding(baseParams.baseOffset, 'z', { min: -10, max: 10, label: 'Offset Z' }).on('change', (ev) => {
        if (ev.last === false) return;
        updateArm();
    });
    baseFolder.expanded = true;

    styleFolder = pane.addFolder({ title: 'Viz' });
    const jointsLinksFolder = styleFolder.addFolder({ title: 'Joints && Links' });
    bindStyle(jointsLinksFolder, 'jointColor', { label: 'Joint Color', view: 'color' });
    bindStyle(jointsLinksFolder, 'linkColor', { label: 'Link Color', view: 'color' });
    bindStyle(jointsLinksFolder, 'randomJointColor', { label: 'Random Joint Color' });
    bindStyle(jointsLinksFolder, 'randomLinkColor', { label: 'Random Link Color' });
    bindStyle(jointsLinksFolder, 'jointRadius', { min: 0.01, max: 0.5, label: 'Joint Radius' });
    bindStyle(jointsLinksFolder, 'jointHeight', { min: 0.01, max: 0.5, label: 'Joint Height' });
    bindStyle(jointsLinksFolder, 'linkRadius', { min: 0.01, max: 0.2, label: 'Link Radius' });
    bindStyle(jointsLinksFolder, 'syncUp', { label: 'Sync Up' });

    const helpersFolder = styleFolder.addFolder({ title: 'Helpers' });
    const axisFolder = helpersFolder.addFolder({ title: 'Axis' });
    bindStyle(axisFolder, 'showAxisHelper', { label: 'Axis Helper' });
    bindStyle(axisFolder, 'axisHelperSize', { min: 0.01, max: 2, label: 'Axis Size' });

    const dofFolder = helpersFolder.addFolder({ title: 'DOF' });
    bindStyle(dofFolder, 'showDOFHelper', { label: 'DOF Helper' });
    bindStyle(dofFolder, 'dofColor', { label: 'DOF Color', view: 'color' });
    bindStyle(dofFolder, 'dofOpacity', { min: 0, max: 1, label: 'DOF Opacity' });
    bindStyle(dofFolder, 'dofUseJointColor', { label: 'Use Random Color' });
    bindStyle(dofFolder, 'dofUseAutoRadius', { label: 'DOF Auto Radius' });
    bindStyle(dofFolder, 'dofRadius', { min: 0.001, max: 2, label: 'DOF Radius' });
    bindStyle(dofFolder, 'dofRadiusScale', { min: 0.01, max: 1, label: 'DOF Radius Scale' });
    bindStyle(dofFolder, 'dofThicknessRatio', { min: 0.01, max: 1, label: 'DOF Thickness' });
    bindStyle(dofFolder, 'dofSegments', { min: 3, max: 128, step: 1, label: 'DOF Segments' });
    bindStyle(dofFolder, 'dofOffsetZ', { min: 0, max: 0.01, label: 'DOF Offset Z' });

    styleFolder.addButton({ title: 'Reset Styles' }).on('click', () => {
        resetStyles();
    });
    styleFolder.expanded = true;

    armsFolder = pane.addFolder({ title: 'Link' });
    armsFolder.expanded = true;

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
        renderLoop.requestRender();
    });

    renderLoop.requestRender();
}

function updateArm() {
    if (suppressUpdate) return;
    const dhParameters = createParams.armSegments.map(segment => {
        const theta = THREE.MathUtils.degToRad(segment.theta);
        const thetaOffset = THREE.MathUtils.degToRad(segment.thetaOffset ?? 0);
        const d = segment.d;
        const a = segment.a;
        const alpha = THREE.MathUtils.degToRad(segment.alpha);
        const [minDhDeg, maxDhDeg] = convertAxisLimitsToDh(segment);
        return [theta, d, a, alpha, thetaOffset, minDhDeg, maxDhDeg, segment.axisSign === -1 ? -1 : 1];
    });
    chain.update(dhParameters, styleParams, baseParams);
    renderLoop.requestRender();
}

function renderFrame() {
    renderer.render(scene, camera);
}
