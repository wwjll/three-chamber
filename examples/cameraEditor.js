import * as THREE from 'three';
import * as TWEEN from '@tweenjs/tween.js/dist/tween.esm.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { Pane } from 'tweakpane';
import { getAssetURL } from '/extend/tools/Tool.js';
import { TrackEditor } from '/extend/editor/TrackEditor.js';

const assetUrl = getAssetURL();
const modelUrl = assetUrl + 'models/collision-world.glb';
const points = [
    new THREE.Vector3(13.66, 14.28, -7.66),
    new THREE.Vector3(0.99, 5.25, 3.95),
    new THREE.Vector3(5, -0.68, 11.72),
    new THREE.Vector3(-2.08, -0.36, 10.97)
];

const BG_COLOR = 0x333333;

let camera, scene, renderer, controls;
let trackEditor;

let windowWidth = window.innerWidth;
let windowHeight = window.innerHeight;
const dimension = {
    // for scene camera position
    center: new THREE.Vector3(),
    min: new THREE.Vector3(),
    max: new THREE.Vector3()
};

let progressController;
let syncingProgressFromAnimation = false;
let exportTextarea = null;
const params = {
    // spline options
    showCurve: true,
    tension: 0.5,
    arcSegments: 100,
    curveType: 'uniform',
    // preview camera
    show: true,
    aspect: windowWidth / windowHeight,
    near: 1,
    far: 50,
    fov: 20,
    // edit options
    addPoint: () => { },
    removePoint: () => { },
    // animation options
    easing: 'Linear',
    easingType: 'In',
    stride: 0.001,
    play: () => { },
    pause: false,
    reset: () => { },
    progress: 0,
    // preview viewport
    scale: 0.2,
    top: 0,
    left: 0
};

init();

function init() {

    renderer = new THREE.WebGLRenderer({ antialias: false });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(windowWidth, windowHeight);
    renderer.setClearColor(BG_COLOR, 1);
    document.body.appendChild(renderer.domElement);

    scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xf0f0f0, 3));

    camera = new THREE.PerspectiveCamera(70, windowWidth / windowHeight, 1, 1000);

    const { aspect, near, far, fov, show } = params;
    scene.add(camera);

    trackEditor = new TrackEditor({
        renderer,
        scene,
        sceneCamera: camera,
        cameraRef: new THREE.PerspectiveCamera(fov, aspect, near, far),
        cameraState: { aspect, near, far, fov, showHelper: show },
        dimension
    });
    scene.add(trackEditor.camera);
    trackEditor.setCameraHelper(new THREE.CameraHelper(trackEditor.camera));
    scene.add(trackEditor.cameraHelper);

    const getPreviewCameraState = () => ({
        aspect: params.aspect,
        fov: params.fov,
        near: params.near,
        far: params.far,
        showHelper: params.show
    });

    const syncViewPort = () => {
        trackEditor.setViewPortFromPixels({
            left: params.left,
            top: params.top,
            scale: params.scale,
            width: windowWidth,
            height: windowHeight
        });
    };

    const syncClip = () => {
        trackEditor.clipProgress({
            arcSegments: params.arcSegments,
            curveType: params.curveType,
            progress: trackEditor.animationState.progress
        });
    };

    const syncSplineMesh = () => {
        trackEditor.updateSplineMesh(params.arcSegments);
    };

    const syncPreviewCamera = (state = 0, index = 0) => {
        trackEditor.setPreviewCamera(state, index, getPreviewCameraState(), params.arcSegments);
    };

    const refreshProgressController = () => {
        if (progressController) {
            progressController.refresh();
        }
    };

    const setAnimationProgress = (nextProgress, syncUi = true) => {
        trackEditor.setAnimation({ progress: nextProgress });
        params.progress = trackEditor.animationState.progress;
        if (syncUi) {
            refreshProgressController();
        }
    };

    const refreshSplineState = ({
        clip = true,
        mesh = true,
        exportText = true,
        render = true
    } = {}) => {
        if (clip) {
            syncClip();
        }
        if (mesh) {
            syncSplineMesh();
        }
        if (exportText) {
            refreshExportTextarea();
        }
        if (render) {
            renderScene();
        }
    };

    const renderScene = () => {
        syncViewPort();
        trackEditor.render({
            renderer,
            scene,
            sceneCamera: camera,
            mainClearColor: BG_COLOR
        });
    };

    const round4 = (n) => Number(n.toFixed(4));

    const buildCurveExportText = () => {
        const source = (trackEditor.controlGroup?.children?.length || 0) > 0
            ? trackEditor.controlGroup.children
            : trackEditor.points;
        const pointTuples = [];
        for (let i = 0; i < source.length; i++) {
            const p = source[i].position || source[i];
            pointTuples.push([round4(p.x), round4(p.y), round4(p.z)]);
        }
        return JSON.stringify({
            curveType: params.curveType,
            tension: round4(params.tension),
            arcSegments: params.arcSegments,
            points: pointTuples
        }, null, 2);
    };

    const refreshExportTextarea = () => {
        if (!exportTextarea) {
            return;
        }
        exportTextarea.value = buildCurveExportText();
    };

    const resetAnimation = (resetCamera = true) => {
        setAnimationProgress(0, true);

        trackEditor.stopAnimationLoop();
        trackEditor.reset(false);

        if (resetCamera) {
            syncPreviewCamera(0, 0);
        }

        renderScene();
    };

    params.addPoint = () => {
        const point = trackEditor.addRandomPoint();
        if (!point) {
            return;
        }
        refreshSplineState();
    };

    params.removePoint = () => {
        const removed = trackEditor.removePoint(3);
        if (!removed) {
            alert('Cannot remove when control points are less than 3.');
            return;
        }
        syncPreviewCamera(2, trackEditor.points.length - 2);
        refreshSplineState();
    };

    params.play = () => {
        const progress = trackEditor.animationState.progress;
        if (!Number.isFinite(progress) || progress >= 1 || progress < 0) {
            setAnimationProgress(0, true);
        } else {
            setAnimationProgress(progress, true);
        }
        params.pause = false;
        syncClip();

        trackEditor.setAnimation({
            easing: params.easing,
            easingType: params.easingType,
            stride: params.stride,
            progress: trackEditor.animationState.progress,
            pause: false
        });
        // Ensure a fresh RAF loop and callback set for every play click.
        trackEditor.stopAnimationLoop();
        trackEditor.play();
        trackEditor.startAnimationLoop({
            shouldPause: () => params.pause,
            step: () => trackEditor.stepAnimationOnSpline(params.arcSegments),
            onFrame: (value) => {
                syncingProgressFromAnimation = true;
                params.progress = value.progress;
                refreshProgressController();
                syncingProgressFromAnimation = false;
                renderScene();
            },
            onComplete: () => {
                trackEditor.setAnimation({ progress: 1, pause: true });
                trackEditor.pause();
                params.pause = true;
                params.progress = 1;
                refreshProgressController();
                renderScene();
            }
        });
    };

    params.reset = () => resetAnimation(true);
    syncViewPort();


    controls = new OrbitControls(camera, renderer.domElement);

    trackEditor.setRaycaster(new THREE.Raycaster());
    trackEditor.setTransformControl(new TransformControls(camera, renderer.domElement));
    scene.add(trackEditor.transformControl);

    new GLTFLoader().load(modelUrl,
        function (gltf) {
            const model = gltf.scene;
            scene.add(model);

            const box = new THREE.Box3();
            box.setFromObject(model);
            const size = box.getSize(new THREE.Vector3());
            const center = box.getCenter(controls.target);

            dimension.min = box.min;
            dimension.max = box.max;
            dimension.center = center;
            dimension.size = size;

            camera.position.x = center.x - size.x / 2;
            camera.position.y = 2 * size.y;
            camera.position.z = center.z - size.z / 2;
            camera.updateProjectionMatrix();
            controls.update();

            // illuminate the scene for better view
            const light = new THREE.SpotLight(0xffffff, 4.5);
            light.position.set(center.x, 50 * center.y, center.z);
            light.lookAt(center.x, center.y, center.z);
            light.angle = Math.PI * 0.2;
            light.decay = 0;
            light.castShadow = true;
            light.shadow.camera.near = 200;
            light.shadow.camera.far = 2000;
            light.shadow.bias = - 0.000222;
            light.shadow.mapSize.width = 1024;
            light.shadow.mapSize.height = 1024;
            scene.add(light);

            trackEditor.generateControlObjects({
                points,
                arcSegments: params.arcSegments
            });
            syncPreviewCamera(0, 0);
            refreshExportTextarea();
            renderScene();
        });

    const pane = new Pane({ title: 'Track Editor' });

    const splineFolder = pane.addFolder({ title: 'Spline' });
    splineFolder.addBinding(params, 'showCurve').on('change', (ev) => {
        trackEditor.setSplinesVisible(ev.value);
        renderScene();
    });
    splineFolder.addBinding(params, 'curveType', {
        options: { centripetal: 'centripetal', uniform: 'uniform', chordal: 'chordal' }
    }).on('change', () => {
        refreshSplineState({ mesh: false });
    });
    splineFolder.addBinding(params, 'tension', { min: 0, max: 1, step: 0.01 }).on('change', (ev) => {
        trackEditor.setSplineTension(ev.value);
        refreshSplineState({ clip: false });
    });
    splineFolder.addBinding(params, 'arcSegments', { min: 10, max: 200, step: 10 }).on('change', (ev) => {
        trackEditor.setSplineArcDivisions(ev.value);
        trackEditor.setSpline({ arcSegments: ev.value });
        refreshSplineState();
    });

    const helperFolder = pane.addFolder({ title: 'Helper' });
    const updatePreviewCamera = (partial) => {
        trackEditor.setCamera(partial);
        syncPreviewCamera(0, 0);
        renderScene();
    };
    helperFolder.addBinding(params, 'show').on('change', (ev) => {
        trackEditor.controlGroup.traverse((cube) => {
            cube.visible = ev.value;
        });
        updatePreviewCamera({ showHelper: ev.value });
    });
    helperFolder.addBinding(params, 'aspect', { min: 1, max: 10, step: 0.1 }).on('change', (ev) => {
        updatePreviewCamera({ aspect: ev.value });
    });
    helperFolder.addBinding(params, 'fov', { min: 0, max: 180, step: 1 }).on('change', (ev) => {
        updatePreviewCamera({ fov: ev.value });
    });
    helperFolder.addBinding(params, 'near', { min: 1, max: 200, step: 1 }).on('change', (ev) => {
        updatePreviewCamera({ near: ev.value });
    });
    helperFolder.addBinding(params, 'far', { min: 500, max: 2000, step: 1 }).on('change', (ev) => {
        updatePreviewCamera({ far: ev.value });
    });
    helperFolder.addButton({ title: 'addPoint' }).on('click', () => params.addPoint());
    helperFolder.addButton({ title: 'removePoint' }).on('click', () => params.removePoint());

    const animationFolder = pane.addFolder({ title: 'Animation' });
    const easingOptions = {};
    for (const e in TWEEN.Easing) {
        easingOptions[e] = e;
    }
    animationFolder.addBinding(params, 'easing', { options: easingOptions });
    animationFolder.addBinding(params, 'easingType', {
        options: { In: 'In', InOut: 'InOut', Out: 'Out' }
    });
    animationFolder.addBinding(params, 'stride', { min: 0.001, max: 0.1, step: 0.0001 });
    animationFolder.addButton({ title: 'play' }).on('click', () => params.play());
    animationFolder.addButton({ title: 'pause' }).on('click', () => {
        params.pause = true;
        trackEditor.pause();
        trackEditor.stopAnimationLoop();
    });
    animationFolder.addButton({ title: 'reset' }).on('click', () => params.reset());
    progressController = animationFolder
        .addBinding(params, 'progress', { min: 0, max: 1, step: 0.001 })
        .on('change', (ev) => {
            if (syncingProgressFromAnimation || trackEditor.isAnimating) {
                return;
            }
            setAnimationProgress(ev.value, false);
            refreshSplineState({ mesh: false, exportText: false, render: false });
            syncPreviewCamera(3, 0);
            renderScene();
        });

    const viewportFolder = pane.addFolder({ title: 'Viewport' });
    const refreshViewPort = () => renderScene();
    viewportFolder.addBinding(params, 'scale', { min: 0.1, max: 0.5, step: 0.01 }).on('change', refreshViewPort);
    viewportFolder.addBinding(params, 'top', { min: 0, max: windowHeight, step: 10 }).on('change', refreshViewPort);
    viewportFolder.addBinding(params, 'left', { min: 0, max: windowWidth, step: 10 }).on('change', refreshViewPort);

    const exportFolder = pane.addFolder({ title: 'Export' });
    exportFolder.addButton({ title: 'refreshData' }).on('click', () => refreshExportTextarea());

    const exportContainer = document.createElement('div');
    exportContainer.style.padding = '8px 4px 4px';
    exportTextarea = document.createElement('textarea');
    exportTextarea.readOnly = false;
    exportTextarea.spellcheck = false;
    exportTextarea.rows = 12;
    exportTextarea.style.width = '100%';
    exportTextarea.style.resize = 'vertical';
    exportTextarea.style.background = 'var(--tp-button-background-color, var(--tp-base-background-color, #2f2f2f))';
    exportTextarea.style.color = 'var(--tp-button-foreground-color, #e8e8e8)';
    exportTextarea.style.border = '1px solid var(--tp-base-shadow-color, rgba(0,0,0,0.35))';
    exportTextarea.style.borderRadius = '4px';
    exportTextarea.style.fontFamily = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
    exportTextarea.style.fontSize = '11px';
    exportTextarea.style.lineHeight = '1.4';
    exportContainer.appendChild(exportTextarea);
    const exportFolderElement = exportFolder.element || pane.element;
    exportFolderElement.appendChild(exportContainer);
    const syncExportVisibility = () => {
        exportContainer.style.display = exportFolder.expanded ? '' : 'none';
    };
    syncExportVisibility();
    exportFolder.on('fold', () => {
        syncExportVisibility();
    });
    refreshExportTextarea();

    trackEditor.mountInteractions({
        windowTarget: window,
        orbitControls: controls,
        controlGroup: trackEditor.controlGroup,
        interactionCamera: camera,
        getSize: () => ({ width: windowWidth, height: windowHeight }),
        onObjectChange: () => {
            refreshSplineState({ render: false });
            if (!trackEditor.isAnimating) {
                syncPreviewCamera(3, 0);
            }
        },
        onResize: () => {
            windowWidth = window.innerWidth;
            windowHeight = window.innerHeight;

            renderer.setPixelRatio(window.devicePixelRatio);
            renderer.setSize(windowWidth, windowHeight);

            const aspect = windowWidth / windowHeight;
            camera.aspect = aspect;
            camera.updateProjectionMatrix();
            params.aspect = aspect;
            trackEditor.setCamera({ aspect });
        },
        onRender: renderScene
    });
}
