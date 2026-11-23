import {
    AmbientLight, Box3, BoxGeometry, BufferAttribute, BufferGeometry, CameraHelper, CatmullRomCurve3,
    DirectionalLight, Group, HemisphereLight, Line, LineBasicMaterial, Mesh, MeshLambertMaterial,
    NeutralToneMapping, PerspectiveCamera, Raycaster, Scene, Vector2, Vector3, WebGLRenderer
} from 'three';
import * as TWEEN from '@tweenjs/tween.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { Pane } from 'tweakpane';

const DEFAULT_SCENE = 'Collision World';
const GENERATED_SCENE = 'Generated Scene';
const scenePresets = {
    [DEFAULT_SCENE]: {
        file: 'collision-world.glb',
        points: [
            new Vector3(13.66, 14.28, -7.66),
            new Vector3(0.99, 5.25, 3.95),
            new Vector3(5, -0.68, 11.72),
            new Vector3(-2.08, -0.36, 10.97),
        ],
        preview: { near: 1, far: 50, fov: 20 },
    },
    Dungeon: {
        file: 'dungeon_warkarma.glb',
        credit: 'Dungeon by Warkarma',
        ambientIntensity: 3.4,
        points: [
            new Vector3(10.5, 1.85, 17.4),
            new Vector3(10.4, 1.9, 15.4),
            new Vector3(10.35, 2.9, 13.05),
            new Vector3(10.45, 3.05, 10.5),
            new Vector3(10.9, 3.05, 6.85),
        ],
        preview: { near: 0.1, far: 75, fov: 58 },
    },
    [GENERATED_SCENE]: {
        points: [
            new Vector3(-8, 5.4, 8),
            new Vector3(-5, 3, 4),
            new Vector3(-1, 1.7, 0.5),
            new Vector3(4, 1.8, -3),
            new Vector3(7.5, 2.2, -7),
        ],
        preview: { near: 0.1, far: 65, fov: 55 },
    },
};

const PREVIEW_BACKGROUND = 0x24364b;
const EDITOR_LAYER = 1;

let camera, scene, renderer, controls;
let trackEditor;

let windowWidth = window.innerWidth;
let windowHeight = window.innerHeight;
const dimension = {
    center: new Vector3(),
    min: new Vector3()
};

let progressController;
let syncingProgressFromAnimation = false;
let exportTextarea = null;
const params = {
    scene: DEFAULT_SCENE,
    showCurve: true,
    tension: 0.5,
    arcSegments: 100,
    curveType: 'uniform',
    show: true,
    aspect: windowWidth / windowHeight,
    ...scenePresets[DEFAULT_SCENE].preview,
    addPoint: () => { },
    removePoint: () => { },
    easing: 'Linear',
    easingType: 'In',
    stride: 0.001,
    play: () => { },
    pause: false,
    reset: () => { },
    progress: 0,
    scale: 0.2,
    top: 0,
    left: 0
};

function init() {

    renderer = new WebGLRenderer({ antialias: false, alpha: true });
    renderer.toneMapping = NeutralToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(windowWidth, windowHeight);
    document.body.appendChild(renderer.domElement);

    scene = new Scene();
    const ambientLight = new AmbientLight(0xffffff);
    const skyLight = new HemisphereLight(0xe7f1ff, 0xc1c9d5, 2.8);
    const keyLight = new DirectionalLight(0xffead2, 3.5);
    const fillLight = new DirectionalLight(0xd1e2ff, 1.5);
    fillLight.target = keyLight.target;
    scene.add(ambientLight, skyLight, keyLight, fillLight, keyLight.target);

    camera = new PerspectiveCamera(70, windowWidth / windowHeight, 1, 1000);
    camera.layers.enable(EDITOR_LAYER);

    const { aspect, near, far, fov, show } = params;
    scene.add(camera);

    trackEditor = new TrackEditor({
        renderer,
        scene,
        sceneCamera: camera,
        cameraRef: new PerspectiveCamera(fov, aspect, near, far),
        cameraState: { aspect, near, far, fov, showHelper: show },
        dimension
    });
    trackEditor.cameraHelper = new CameraHelper(trackEditor.camera);
    trackEditor.cameraHelper.layers.set(EDITOR_LAYER);
    trackEditor.setCamera({ showHelper: show });
    scene.add(trackEditor.camera, trackEditor.cameraHelper);

    const getPreviewCameraState = () => ({
        aspect: params.aspect,
        fov: params.fov,
        near: params.near,
        far: params.far,
        showHelper: params.show
    });

    const syncClip = () => {
        trackEditor.clipProgress(params.arcSegments, params.curveType);
    };

    const syncSplineMesh = () => {
        trackEditor.updateSplineMesh(params.arcSegments);
    };

    const syncPreviewCamera = (mode = 'start') => {
        trackEditor.setPreviewCamera(mode, getPreviewCameraState());
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
        const { left, top, scale } = params;
        trackEditor.render({ left, top, scale });
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
        trackEditor.reset();

        if (resetCamera) {
            syncPreviewCamera();
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
        const removed = trackEditor.removePoint();
        if (!removed) {
            alert('Cannot remove when control points are less than 3.');
            return;
        }
        syncPreviewCamera('lastSegment');
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
    controls = new OrbitControls(camera, renderer.domElement);

    trackEditor.raycaster = new Raycaster();
    trackEditor.raycaster.layers.set(EDITOR_LAYER);
    trackEditor.transformControl = new TransformControls(camera, renderer.domElement);
    trackEditor.transformControl.getRaycaster().layers.enable(EDITOR_LAYER);
    const transformHelper = trackEditor.transformControl.getHelper();
    transformHelper.traverse((object) => object.layers.set(EDITOR_LAYER));
    scene.add(transformHelper);

    const pane = new Pane({ title: 'Track Editor' });
    const options = Object.keys(scenePresets).map((name) => ({ text: name, value: name }));
    const scenePicker = pane.addBinding(params, 'scene', { label: 'Scene', options });
    const sceneStatus = document.querySelector('#output');
    const loader = new GLTFLoader().setPath('https://raw.githubusercontent.com/mrdoob/three.js/r187/examples/models/gltf/');
    const tracks = new Map();
    let activeScene;
    let activeModel;

    async function switchScene(requestedScene) {
        scenePicker.disabled = true;
        sceneStatus.textContent = `Loading ${requestedScene}…`;
        let sceneName = requestedScene;
        let model;
        try {
            const { file } = scenePresets[requestedScene];
            if (file) {
                try {
                    model = (await loader.loadAsync(file)).scene;
                } catch (error) {
                    sceneName = GENERATED_SCENE;
                    console.warn(`Could not load ${requestedScene}.`, error);
                }
            }
            model ??= createGeneratedScene();

            if (activeModel) {
                const { near, far, fov } = params;
                tracks.set(activeScene, {
                    points: trackEditor.points.map((point) => point.clone()),
                    preview: { near, far, fov },
                });
                disposeSceneModel(activeModel);
            }
            activeScene = sceneName;
            activeModel = model;
            scene.add(model);

            const box = new Box3().setFromObject(model);
            const size = box.getSize(new Vector3());
            const center = box.getCenter(controls.target);
            dimension.min.copy(box.min);
            dimension.center.copy(center);
            dimension.size = size;

            if (sceneName === DEFAULT_SCENE) {
                camera.position.set(center.x - size.x / 2, 2 * size.y, center.z - size.z / 2);
            } else {
                const extent = Math.max(size.x, size.z);
                camera.position.copy(center).add(new Vector3(extent * 0.75, extent * 0.65, extent * 0.8));
            }
            keyLight.position.copy(center).add(new Vector3(4, 7, 5));
            fillLight.position.copy(center).add(new Vector3(-5, 3, -4));
            keyLight.target.position.copy(center);
            controls.update();

            const preset = scenePresets[sceneName];
            ambientLight.intensity = preset.ambientIntensity ?? 0.4;
            const track = tracks.get(sceneName) ?? preset;
            Object.assign(params, track.preview, { scene: sceneName, pause: false });
            trackEditor.generateControlObjects(track.points, params.arcSegments);
            trackEditor.setSplineTension(params.tension);
            trackEditor.setSplineArcDivisions(params.arcSegments);
            trackEditor.setSplinesVisible(params.showCurve);
            trackEditor.controlGroup.visible = params.show;
            resetAnimation();
            refreshSplineState({ render: false });
            pane.refresh();
            renderScene();
            sceneStatus.textContent = sceneName === requestedScene
                ? preset.credit ?? sceneName
                : `${requestedScene} could not load. Showing Generated Scene.`;
        } finally {
            scenePicker.disabled = false;
        }
    }

    function selectScene(name) {
        switchScene(name).catch((error) => {
            sceneStatus.textContent = `Could not set up ${name}.`;
            console.error(error);
        });
    }

    scenePicker.on('change', ({ value }) => {
        if (!scenePicker.disabled && value !== activeScene) {
            selectScene(value);
        }
    });

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
        refreshSplineState();
    });

    const helperFolder = pane.addFolder({ title: 'Helper' });
    const updatePreviewCamera = (partial) => {
        trackEditor.setCamera(partial);
        syncPreviewCamera();
        renderScene();
    };
    helperFolder.addBinding(params, 'show').on('change', (ev) => {
        trackEditor.controlGroup.visible = ev.value;
        updatePreviewCamera({ showHelper: ev.value });
    });
    helperFolder.addBinding(params, 'aspect', { min: 1, max: 10, step: 0.1 }).on('change', (ev) => {
        updatePreviewCamera({ aspect: ev.value });
    });
    helperFolder.addBinding(params, 'fov', { min: 0, max: 180, step: 1 }).on('change', (ev) => {
        updatePreviewCamera({ fov: ev.value });
    });
    helperFolder.addBinding(params, 'near', { min: 0.05, max: 20, step: 0.05 }).on('change', (ev) => {
        updatePreviewCamera({ near: ev.value });
    });
    helperFolder.addBinding(params, 'far', { min: 10, max: 2000, step: 1 }).on('change', (ev) => {
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
            syncPreviewCamera('progress');
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
        orbitControls: controls,
        getSize: () => ({ width: windowWidth, height: windowHeight }),
        onObjectChange: () => {
            refreshSplineState({ render: false });
            if (!trackEditor.isAnimating) {
                syncPreviewCamera('progress');
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

    selectScene(params.scene);
}

function createGeneratedScene() {
    const root = new Group();
    const floor = new MeshLambertMaterial({ color: 0x40505c });
    const wall = new MeshLambertMaterial({ color: 0x607586 });
    const marker = new MeshLambertMaterial({ color: 0xde9248 });
    const addBox = (material, width, height, depth, x, y, z) => {
        const mesh = new Mesh(new BoxGeometry(width, height, depth), material);
        mesh.position.set(x, y, z);
        root.add(mesh);
    };

    addBox(floor, 23, 0.5, 21, 0, -0.25, 0);
    addBox(wall, 22, 2.5, 0.5, 0, 1.25, -10);
    addBox(wall, 0.5, 2.5, 20, -11, 1.25, 0);
    addBox(wall, 0.5, 2.5, 20, 11, 1.25, 0);
    addBox(wall, 5, 2.6, 0.6, -5.5, 1.3, -2.8);
    addBox(wall, 4.5, 2.6, 0.6, 6.75, 1.3, 2.65);
    for (const [x, z] of [[-6.5, 2.5], [-1.8, 3.5], [1.5, -3.65], [6.7, -8.2]]) {
        addBox(marker, 0.8, 2.2, 0.8, x, 1.1, z);
    }
    return root;
}

function disposeSceneModel(model) {
    model.removeFromParent();
    const resources = new Set();
    model.traverse((object) => {
        if (!object.isMesh) {
            return;
        }
        resources.add(object.geometry);
        for (const material of [object.material].flat()) {
            resources.add(material);
            for (const value of Object.values(material)) {
                if (value?.isTexture) {
                    resources.add(value);
                }
            }
        }
    });
    resources.forEach((resource) => resource.dispose());
}

class TrackEditor {
    constructor({ renderer, scene, sceneCamera, cameraRef, cameraState, dimension }) {
        this.renderer = renderer;
        this.scene = scene;
        this.sceneCamera = sceneCamera;
        this.camera = cameraRef;
        this.cameraState = { ...cameraState };
        this.dimension = dimension;
        this.points = [];
        this.splines = {};
        this.previewPoints = [];
        this.splineType = 'uniform';

        this.controlGroup = new Group();
        this.scene.add(this.controlGroup);
        this.controlGeometry = new BoxGeometry(0.5, 0.5, 0.5);
        this.controlMaterial = new MeshLambertMaterial({ color: Math.random() * 0xffffff });

        this.animationState = {
            easing: 'Linear',
            easingType: 'In',
            stride: 0.001,
            pause: false,
            progress: 0
        };
        this.isAnimating = false;
        this.animationTask = null;
        this.animationRequestId = 0;
        this._interactionPointer = new Vector2();
        this._tmpCurvePosition = new Vector3();
        this._tmpCurveTarget = new Vector3();
        this._tmpCurveTangent = new Vector3();
    }

    mountInteractions({ orbitControls, getSize, onObjectChange, onResize, onRender }) {
        const transformControl = this.transformControl;
        const pickControl = (event) => {
            const { width, height } = getSize();
            this._interactionPointer.set(
                (event.clientX / width) * 2 - 1,
                1 - (event.clientY / height) * 2
            );
            this.raycaster.setFromCamera(this._interactionPointer, this.sceneCamera);
            return this.raycaster.intersectObjects(this.controlGroup.children, false)[0]?.object;
        };

        transformControl.addEventListener('dragging-changed', (event) => {
            orbitControls.enabled = !event.value;
        });
        transformControl.addEventListener('objectChange', () => {
            onObjectChange();
            onRender();
        });
        window.addEventListener('resize', () => {
            onResize();
            onRender();
        });
        window.addEventListener('contextmenu', (event) => {
            if (!pickControl(event) && transformControl.axis === null) {
                transformControl.detach();
            }
            onRender();
        });
        window.addEventListener('mousewheel', onRender);
        window.addEventListener('mousemove', (event) => {
            const object = pickControl(event);
            if (object && !transformControl.dragging && object !== transformControl.object) {
                transformControl.attach(object);
            }
            onRender();
        });
    }

    setCamera(partial) {
        Object.assign(this.cameraState, partial);
        const { aspect, fov, near, far, showHelper } = this.cameraState;
        Object.assign(this.camera, { aspect, fov, near, far });
        this.camera.updateProjectionMatrix();
        this.cameraHelper.visible = showHelper;
        this.cameraHelper.update();
    }

    setCameraPose(position, target) {
        this.camera.position.copy(position);
        this.camera.lookAt(target);
        this.camera.updateProjectionMatrix();
        this.cameraHelper.update();
    }

    setPreviewCamera(mode, cameraState) {
        let position;
        let target;

        switch (mode) {
            case 'lastSegment':
                [position, target] = this.points.slice(-2);
                break;
            case 'progress':
                [position, target] = this.previewPoints;
                if (!position) {
                    return;
                }
                break;
            default:
                [position, target] = this.points;
                break;
        }

        if (position && target) {
            this.setCameraPose(position, target);
        }
        this.setCamera(cameraState);
    }

    render({ left, top, scale }) {
        const { renderer, scene, sceneCamera, camera } = this;
        const { clientWidth: width, clientHeight: height } = renderer.domElement;
        const previewWidth = width * scale;
        const previewHeight = height * scale;

        renderer.setClearAlpha(0);
        renderer.setScissorTest(true);
        renderer.setScissor(0, 0, width, height);
        renderer.setViewport(0, 0, width, height);
        renderer.render(scene, sceneCamera);

        const bottom = height - top - previewHeight;
        renderer.setClearColor(PREVIEW_BACKGROUND, 1);
        renderer.setScissor(left, bottom, previewWidth, previewHeight);
        renderer.setViewport(left, bottom, previewWidth, previewHeight);
        renderer.render(scene, camera);
    }

    generateControlObjects(points, arcSegments) {
        this.transformControl.detach();
        this.controlGroup.clear();
        this.points.length = 0;
        for (const point of points) {
            this.addPoint(point);
        }

        if (this.splines.uniform) {
            return;
        }

        const createSpline = (curveType, color) => {
            const curve = new CatmullRomCurve3(this.points, false, curveType);
            const geometry = new BufferGeometry();
            geometry.setAttribute('position', new BufferAttribute(new Float32Array(arcSegments * 3), 3));
            curve.mesh = new Line(geometry, new LineBasicMaterial({ color, opacity: 0.35 }));
            curve.mesh.layers.set(EDITOR_LAYER);
            curve.mesh.castShadow = true;
            this.scene.add(curve.mesh);
            return curve;
        };
        this.splines = {
            uniform: createSpline('catmullrom', 0xff0000),
            centripetal: createSpline('centripetal', 0x00ff00),
            chordal: createSpline('chordal', 0x0000ff)
        };
        this.clipProgress(arcSegments, this.splineType);
        this.updateSplineMesh(arcSegments);
    }

    addPoint(point) {
        const mesh = new Mesh(this.controlGeometry, this.controlMaterial);
        mesh.layers.set(EDITOR_LAYER);
        mesh.position.copy(point);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.controlGroup.add(mesh);
        this.points.push(mesh.position);
    }

    addRandomPoint() {
        const { size, center, min } = this.dimension;
        if (!size) {
            return false;
        }
        this.addPoint(new Vector3(
            Math.random() * size.x + min.x,
            Math.random() * size.y + center.y,
            Math.random() * size.z + min.z
        ));
        return true;
    }

    removePoint() {
        if (this.points.length <= 3) {
            return false;
        }
        const mesh = this.controlGroup.children.at(-1);
        if (mesh === this.transformControl.object) {
            this.transformControl.detach();
        }
        this.controlGroup.remove(mesh);
        this.points.pop();
        return true;
    }

    setSplinesVisible(visible) {
        for (const spline of Object.values(this.splines)) {
            spline.mesh.visible = visible;
        }
    }

    setSplineTension(tension) {
        for (const spline of Object.values(this.splines)) {
            spline.tension = tension;
        }
    }

    setSplineArcDivisions(arcDivisions) {
        for (const spline of Object.values(this.splines)) {
            spline.arcLengthDivisions = arcDivisions;
        }
    }

    updateSplineMesh(arcSegments) {
        const point = new Vector3();
        for (const spline of Object.values(this.splines)) {
            const geometry = spline.mesh.geometry;
            let position = geometry.attributes.position;
            if (position.count !== arcSegments) {
                position = new BufferAttribute(new Float32Array(arcSegments * 3), 3);
                geometry.setAttribute('position', position);
            }

            for (let i = 0; i < arcSegments; i++) {
                spline.getPoint(i / (arcSegments - 1), point);
                position.setXYZ(i, point.x, point.y, point.z);
            }
            position.needsUpdate = true;
        }
    }

    clipProgress(arcSegments, curveType) {
        const spline = this.splines[curveType];
        if (!spline) {
            return;
        }
        this.splineType = curveType;
        spline.updateArcLengths();

        const progress = Math.min(1, Math.max(0, this.animationState.progress));
        this.animationState.progress = progress;
        if (progress === 1) {
            this.previewPoints = [spline.getPointAt(1 - 1 / arcSegments), spline.getPointAt(1)];
            return;
        }

        // Position and look-ahead use arc length so scrubbing follows the same path as playback.
        const remaining = 1 - progress;
        const segments = Math.max(1, Math.ceil(remaining * arcSegments));
        this.previewPoints = [
            spline.getPointAt(progress),
            spline.getPointAt(Math.min(1, progress + remaining / segments))
        ];
    }

    stepAnimationOnSpline(arcSegments) {
        const frame = this.step();
        if (!frame) {
            return null;
        }
        const spline = this.splines[this.splineType];
        if (!spline) {
            return frame;
        }

        const eased = Math.min(1, Math.max(0, frame.eased));
        const lookAhead = 1 / arcSegments;
        let targetU = Math.min(1, eased + lookAhead);
        if (targetU <= eased) {
            targetU = Math.max(0, eased - lookAhead);
        }

        const position = spline.getPointAt(eased, this._tmpCurvePosition);
        const target = spline.getPointAt(targetU, this._tmpCurveTarget);
        if (position.distanceToSquared(target) < 1e-12) {
            spline.getTangentAt(Math.min(0.999999, eased), this._tmpCurveTangent);
            target.copy(position).addScaledVector(this._tmpCurveTangent, 0.1);
        }
        this.setCameraPose(position, target);
        return frame;
    }

    stopAnimationLoop() {
        if (this.animationRequestId) {
            cancelAnimationFrame(this.animationRequestId);
            this.animationRequestId = 0;
        }
        return this;
    }

    startAnimationLoop({
        shouldPause = () => false,
        step = () => this.step(),
        onFrame = null,
        onComplete = null
    } = {}) {
        if (this.animationRequestId) {
            return this;
        }

        const tick = () => {
            this.animationRequestId = requestAnimationFrame(tick);

            if (shouldPause()) {
                this.pause();
                return;
            }

            this.resume();
            const value = step();
            if (value) {
                onFrame?.(value);
                return;
            }

            this.stopAnimationLoop();
            onComplete?.();
        };

        this.animationRequestId = requestAnimationFrame(tick);
        return this;
    }

    setAnimation(partial = {}) {
        Object.assign(this.animationState, partial);
        this.animationState.progress = Math.min(
            1,
            Math.max(0, this.animationState.progress),
        );
        return this;
    }

    *createAnimationTask() {
        const easingGroupRaw = TWEEN.Easing[this.animationState.easing];
        const easingGroup = this.animationState.easing === 'generatePow' && typeof easingGroupRaw === 'function'
            ? easingGroupRaw()
            : easingGroupRaw;
        const easingFn = easingGroup?.[this.animationState.easingType] || easingGroup?.None || ((t) => t);
        const stride = this.animationState.stride;

        let progress = this.animationState.progress;
        while (progress <= 1) {
            const eased = easingFn.call(easingGroup, progress);
            yield { progress, eased };
            progress += stride;
            this.animationState.progress = progress;
        }
    }

    play() {
        this.animationState.progress = Math.min(1, Math.max(0, this.animationState.progress));
        this.animationTask = this.createAnimationTask();
        this.animationState.pause = false;
        this.isAnimating = true;
        return this;
    }

    pause() {
        this.animationState.pause = true;
        return this;
    }

    resume() {
        this.animationState.pause = false;
        if (this.animationTask) {
            this.isAnimating = true;
        }
        return this;
    }

    step() {
        if (!this.isAnimating || this.animationState.pause || !this.animationTask) {
            return null;
        }

        const frame = this.animationTask.next();
        if (frame.done) {
            this.isAnimating = false;
            this.animationTask = null;
            return null;
        }
        return frame.value;
    }

    reset() {
        this.isAnimating = false;
        this.animationTask = null;
        this.animationState.pause = false;
        this.animationState.progress = 0;
    }
}

init();
