import { Box3, BoxGeometry, BufferAttribute, BufferGeometry, CatmullRomCurve3, Group, Line, LineBasicMaterial, Mesh, MeshLambertMaterial, Vector2, Vector3 } from 'three';
import * as TWEEN from '@tweenjs/tween.js/dist/tween.esm.js';

const DEFAULT_CAMERA = {
    aspect: 1,
    fov: 20,
    near: 1,
    far: 50,
    showHelper: true,
    frustumCulling: true
};

const DEFAULT_VIEWPORT = {
    enabled: true,
    relative: { left: 0, top: 0, width: 0.33, height: 0.33 },
    border: { enabled: false, size: 1, color: 0xffffff },
    clearColor: null
};

const DEFAULT_SPLINE = {
    showCurve: true,
    tension: 0.5,
    arcSegments: 200,
    curveType: 'uniform'
};

const DEFAULT_ANIMATION = {
    easing: 'Linear',
    easingType: 'In',
    stride: 0.001,
    pause: false,
    progress: 0
};

class TrackEditor {
    constructor(options = {}) {
        this.options = { ...options };

        this.renderer = options.renderer || null;
        this.scene = options.scene || null;
        this.sceneCamera = options.sceneCamera || null;

        // Camera running along the spline path.
        this.camera = this._resolveCameraRef(options);
        this.cameraHelper = options.cameraHelper || null;
        this.raycaster = options.raycaster || null;
        this.transformControl = options.transformControl || null;

        this.cameraState = this._resolveCameraState(options);
        this.viewPort = {
            ...DEFAULT_VIEWPORT,
            ...(options.viewPort || {}),
            relative: {
                ...DEFAULT_VIEWPORT.relative,
                ...(options.viewPort?.relative || {})
            },
            border: {
                ...DEFAULT_VIEWPORT.border,
                ...(options.viewPort?.border || {})
            }
        };
        this.splineState = {
            ...DEFAULT_SPLINE,
            ...(options.spline || {})
        };
        this.animationState = {
            ...DEFAULT_ANIMATION,
            ...(options.animation || {})
        };

        const hasValidPoints = options.points?.length >= 4;
        this.points = hasValidPoints
            ? options.points.slice()
            : this.computeControlPoints(this.scene);
        this.splines = options.splines || {};
        this.splinePoints = options.splinePoints?.slice() ?? [];
        this.clipSplinePoints = options.clipSplinePoints?.slice() ?? [];
        this.controlSize = options.controlSize ?? 0.5;
        this._ownsControlGroup = !options.controlGroup;
        this.controlGroup = options.controlGroup || new Group();
        if (this.scene && this.controlGroup.parent !== this.scene) {
            this.scene.add(this.controlGroup);
        }
        this._ownsControlGeometry = !options.controlGeometry;
        this.controlGeometry = options.controlGeometry || new BoxGeometry(
            this.controlSize,
            this.controlSize,
            this.controlSize
        );
        this._ownsControlMaterial = !options.controlMaterial;
        const controlColor = options.controlColor ?? Math.random() * 0xffffff;
        this.controlMaterial = options.controlMaterial || new MeshLambertMaterial({ color: controlColor });
        this.dimension = options.dimension || null;

        this.isAnimating = false;
        this.animationTask = null;
        this.animationRequestId = 0;
        this._interactionPointer = new Vector2();
        this._tmpCurvePosition = new Vector3();
        this._tmpCurveTarget = new Vector3();
        this._tmpCurveTangent = new Vector3();
        this._interactionBindings = null;
        this._applyCameraState();
    }

    computeControlPoints(scene = this.scene, count = 4) {
        const fallback = [
            new Vector3(-2, 1, -2),
            new Vector3(2, 1, -2),
            new Vector3(2, 1, 2),
            new Vector3(-2, 1, 2)
        ];

        if (!scene || count <= 0) {
            return fallback.slice(0, Math.max(1, count)).map((p) => p.clone());
        }

        const box = new Box3().setFromObject(scene);
        const size = box.getSize(new Vector3());
        const center = box.getCenter(new Vector3());
        const hasFiniteSize = Number.isFinite(size.x) && Number.isFinite(size.y) && Number.isFinite(size.z);
        const hasVolume = hasFiniteSize && (size.x > 0 || size.y > 0 || size.z > 0);
        if (!hasVolume) {
            return fallback.slice(0, Math.max(1, count)).map((p) => p.clone());
        }

        const sx = Math.max(1, size.x);
        const sy = Math.max(1, size.y);
        const sz = Math.max(1, size.z);
        const rx = sx * 0.35;
        const rz = sz * 0.35;
        const ry = sy * 0.25;
        const points = [];

        for (let i = 0; i < count; i++) {
            const t = (i / count) * Math.PI * 2;
            const jitter = (Math.random() - 0.5) * 0.4;
            const radiusScale = 0.7 + Math.random() * 0.6;
            points.push(new Vector3(
                center.x + Math.cos(t + jitter) * rx * radiusScale,
                center.y + (Math.random() - 0.5) * ry,
                center.z + Math.sin(t + jitter) * rz * radiusScale
            ));
        }

        return points;
    }

    _resolveCameraRef(options = {}) {
        if (options.followCamera && options.followCamera.isCamera) {
            return options.followCamera;
        }
        if (options.followCameraRef && options.followCameraRef.isCamera) {
            return options.followCameraRef;
        }
        if (options.camera && options.camera.isCamera) {
            return options.camera;
        }
        if (options.cameraRef && options.cameraRef.isCamera) {
            return options.cameraRef;
        }
        return null;
    }

    _resolveCameraState(options = {}) {
        const state =
            options.followCamera && !options.followCamera.isCamera
                ? options.followCamera
                : options.camera && !options.camera.isCamera
                    ? options.camera
                    : options.cameraState || options.cameraConfig || {};

        return {
            ...DEFAULT_CAMERA,
            ...state
        };
    }

    setRenderer(renderer) {
        this.renderer = renderer || null;
        return this;
    }

    setScene(scene) {
        this.scene = scene || null;
        return this;
    }

    setSceneCamera(camera) {
        this.sceneCamera = camera || null;
        return this;
    }

    setCameraRef(camera) {
        this.camera = camera || null;
        this._applyCameraState();
        return this;
    }

    setCameraHelper(helper) {
        this.cameraHelper = helper || null;
        this._syncCameraHelper();
        return this;
    }

    setRaycaster(raycaster) {
        this.raycaster = raycaster || null;
        return this;
    }

    setTransformControl(transformControl) {
        if (this._interactionBindings?.transformControl && this._interactionBindings.transformControl !== transformControl) {
            this.unmountInteractions();
        }
        this.transformControl = transformControl || null;
        return this;
    }

    mountInteractions({
        windowTarget = typeof window !== 'undefined' ? window : null,
        orbitControls = null,
        controlGroup = this.controlGroup,
        interactionCamera = this.sceneCamera,
        getSize = () => ({
            width: windowTarget.innerWidth || 1,
            height: windowTarget.innerHeight || 1,
        }),
        onObjectChange = () => {},
        onResize = () => {},
        onRender = () => {},
    } = {}) {
        this.unmountInteractions();

        if (!windowTarget || !this.transformControl || !this.raycaster || !interactionCamera || !controlGroup) {
            return this;
        }

        const updatePointer = (event) => {
            const { width, height } = getSize();
            const w = Math.max(1, width || 1);
            const h = Math.max(1, height || 1);
            this._interactionPointer.x = (event.clientX / w) * 2 - 1;
            this._interactionPointer.y = - (event.clientY / h) * 2 + 1;
        };

        const handleDraggingChanged = (event) => {
            if (orbitControls) {
                orbitControls.enabled = !event.value;
            }
        };

        const handleObjectChange = (event) => {
            onObjectChange(event);
            onRender();
        };

        const handleResize = () => {
            onResize();
            onRender();
        };

        const handleContextMenu = (event) => {
            updatePointer(event);
            this.raycaster.setFromCamera(this._interactionPointer, interactionCamera);

            const gizmo = this.transformControl.children?.[0];
            const candidates = gizmo ? [...controlGroup.children, gizmo] : [...controlGroup.children];
            const intersects = this.raycaster.intersectObjects(candidates, false);
            if (intersects.length === 0) {
                this.transformControl.detach();
            }

            onRender();
        };

        const handleMouseWheel = () => {
            onRender();
        };

        const handleMouseMove = (event) => {
            updatePointer(event);
            this.raycaster.setFromCamera(this._interactionPointer, interactionCamera);

            const intersects = this.raycaster.intersectObjects(controlGroup.children, false);
            if (intersects.length > 0) {
                const object = intersects[0].object;
                if (!this.transformControl.dragging && object !== this.transformControl.object) {
                    this.transformControl.attach(object);
                }
            }

            onRender();
        };

        this.transformControl.addEventListener('dragging-changed', handleDraggingChanged);
        this.transformControl.addEventListener('objectChange', handleObjectChange);
        windowTarget.addEventListener('resize', handleResize);
        windowTarget.addEventListener('contextmenu', handleContextMenu);
        windowTarget.addEventListener('mousewheel', handleMouseWheel);
        windowTarget.addEventListener('mousemove', handleMouseMove);

        this._interactionBindings = {
            windowTarget,
            transformControl: this.transformControl,
            handleDraggingChanged,
            handleObjectChange,
            handleResize,
            handleContextMenu,
            handleMouseWheel,
            handleMouseMove
        };

        return this;
    }

    unmountInteractions() {
        if (!this._interactionBindings) {
            return this;
        }

        const {
            windowTarget,
            transformControl,
            handleDraggingChanged,
            handleObjectChange,
            handleResize,
            handleContextMenu,
            handleMouseWheel,
            handleMouseMove
        } = this._interactionBindings;

        transformControl?.removeEventListener('dragging-changed', handleDraggingChanged);
        transformControl?.removeEventListener('objectChange', handleObjectChange);
        windowTarget?.removeEventListener('resize', handleResize);
        windowTarget?.removeEventListener('contextmenu', handleContextMenu);
        windowTarget?.removeEventListener('mousewheel', handleMouseWheel);
        windowTarget?.removeEventListener('mousemove', handleMouseMove);

        this._interactionBindings = null;
        return this;
    }

    setControlGroup(controlGroup) {
        if (this._ownsControlGroup && this.controlGroup && this.scene && this.controlGroup.parent === this.scene) {
            this.scene.remove(this.controlGroup);
        }
        this.controlGroup = controlGroup || null;
        this._ownsControlGroup = false;
        if (this.scene && this.controlGroup && this.controlGroup.parent !== this.scene) {
            this.scene.add(this.controlGroup);
        }
        return this;
    }

    setControlMeshTemplate({ geometry = null, material = null } = {}) {
        this.controlGeometry = geometry;
        this.controlMaterial = material;
        this._ownsControlGeometry = false;
        this._ownsControlMaterial = false;
        return this;
    }

    setDimension(dimension) {
        this.dimension = dimension || null;
        return this;
    }

    setSplines(splines = {}) {
        this.splines = splines || {};
        return this;
    }

    forEachSpline(visitor) {
        for (const key in this.splines) {
            visitor(this.splines[key], key);
        }
        return this;
    }

    setSplinesVisible(visible) {
        return this.forEachSpline((spline) => {
            if (spline?.mesh) {
                spline.mesh.visible = !!visible;
            }
        });
    }

    setSplineTension(tension) {
        this.setSpline({ tension });
        return this.forEachSpline((spline) => {
            spline.tension = tension;
        });
    }

    setSplineArcDivisions(arcDivisions) {
        return this.forEachSpline((spline) => {
            spline.arcLengthDivisions = arcDivisions;
        });
    }

    setCamera(partial = {}) {
        Object.assign(this.cameraState, partial);
        this._applyCameraState();
        return this;
    }

    setCameraPose({ position, target, up } = {}) {
        if (!this.camera) return this;

        if (position) {
            this.camera.position.copy(position);
        }
        if (target) {
            this.camera.lookAt(target);
        }
        if (up) {
            this.camera.up.copy(up);
        }

        this.camera.updateProjectionMatrix();
        this._syncCameraHelper();
        return this;
    }

    setViewPort(partial = {}) {
        const wasEnabled = this.viewPort.enabled;

        this.viewPort = {
            ...this.viewPort,
            ...partial,
            relative: {
                ...this.viewPort.relative,
                ...partial.relative,
            },
            border: {
                ...this.viewPort.border,
                ...partial.border,
            },
        };

        if (wasEnabled && !this.viewPort.enabled) {
            this._cleanupViewPortSideEffects();
        }
        return this;
    }

    setViewPortEnabled(enabled) {
        return this.setViewPort({ enabled });
    }

    getViewPort(rendererWidth, rendererHeight) {
        const width = Math.max(1, rendererWidth || 1);
        const height = Math.max(1, rendererHeight || 1);
        const { left, top, width: rw, height: rh } = this.viewPort.relative;

        return {
            left: left * width,
            top: top * height,
            width: rw * width,
            height: rh * height
        };
    }

    getViewports({ width, height, mainClearColor = 0x333333 } = {}) {
        const views = [];
        views.push({
            name: 'main',
            camera: this.sceneCamera,
            clearColor: mainClearColor,
            left: 0,
            top: 0,
            width,
            height
        });

        if (this.viewPort.enabled && this.camera) {
            const vp = this.getViewPort(width, height);
            views.push({
                name: 'viewPort',
                camera: this.camera,
                clearColor: this.viewPort.clearColor ?? mainClearColor,
                ...vp
            });
        }

        return views;
    }

    render({
        renderer = this.renderer,
        scene = this.scene,
        sceneCamera = this.sceneCamera,
        mainClearColor = 0x333333
    } = {}) {
        const activeSceneCamera = sceneCamera || this.sceneCamera;
        if (!renderer || !scene || !activeSceneCamera) return this;

        // Avoid passing plain object to renderer.getSize (it expects a Vector2-like with .set).
        const width = renderer.domElement?.clientWidth || renderer.domElement?.width || 1;
        const height = renderer.domElement?.clientHeight || renderer.domElement?.height || 1;
        this.sceneCamera = activeSceneCamera;

        const views = this.getViewports({ width, height, mainClearColor });
        for (const view of views) {
            this._renderView(renderer, scene, view, height);
        }
        return this;
    }

    setSpline(partial = {}) {
        Object.assign(this.splineState, partial);
        return this;
    }

    setPoints(points = []) {
        this.points = points.slice();
        return this;
    }

    setPointsFromControlGroup(controlGroup = this.controlGroup) {
        if (!controlGroup) {
            this.points = [];
            return this;
        }

        const nextPoints = [];
        for (let i = 0; i < controlGroup.children.length; i++) {
            nextPoints.push(controlGroup.children[i].position);
        }
        this.points = nextPoints;
        return this;
    }

    addControlMesh(point) {
        if (!point || !this.controlGroup || !this.controlGeometry || !this.controlMaterial) {
            return null;
        }

        const mesh = new Mesh(this.controlGeometry, this.controlMaterial);
        mesh.position.copy(point);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.controlGroup.add(mesh);
        return mesh;
    }

    addPoint(point) {
        if (!point) {
            return null;
        }

        const mesh = this.addControlMesh(point);
        if (mesh) {
            this.points.push(mesh.position);
            return mesh.position;
        }

        this.points.push(point);
        return point;
    }

    addRandomPoint() {
        const size = this.dimension?.size;
        const center = this.dimension?.center;
        const min = this.dimension?.min;
        if (!size || !center || !min) {
            return null;
        }

        const randomPoint = new Vector3(
            Math.random() * size.x + min.x,
            Math.random() * size.y + center.y,
            Math.random() * size.z + min.z
        );
        return this.addPoint(randomPoint);
    }

    generateControlObjects({
        points = this.points,
        arcSegments = this.splineState.arcSegments,
        randomCount = 4
    } = {}) {
        const nextPoints = points.slice();

        if (nextPoints.length === 0) {
            const count = Math.max(1, randomCount || 4);
            nextPoints.push(...this.computeControlPoints(this.scene, count));
        }

        if (this.controlGroup) {
            const oldChildren = this.controlGroup.children.slice();
            for (let i = 0; i < oldChildren.length; i++) {
                this.controlGroup.remove(oldChildren[i]);
            }
            for (let i = 0; i < nextPoints.length; i++) {
                this.addControlMesh(nextPoints[i]);
            }
            this.setPointsFromControlGroup(this.controlGroup);
        } else {
            this.setPoints(nextPoints);
        }

        if (this.scene && this.splines) {
            for (const key in this.splines) {
                const oldMesh = this.splines[key]?.mesh;
                if (oldMesh) {
                    this.scene.remove(oldMesh);
                }
            }
        }

        const geometry = new BufferGeometry();
        geometry.setAttribute('position', new BufferAttribute(new Float32Array(arcSegments * 3), 3));

        const createSpline = (curveType, color) => {
            const curve = new CatmullRomCurve3(this.points);
            curve.curveType = curveType;
            curve.mesh = new Line(
                geometry.clone(),
                new LineBasicMaterial({ color, opacity: 0.35 })
            );
            curve.mesh.castShadow = true;
            return curve;
        };

        const builtSplines = {
            uniform: createSpline('catmullrom', 0xff0000),
            centripetal: createSpline('centripetal', 0x00ff00),
            chordal: createSpline('chordal', 0x0000ff)
        };

        if (this.scene) {
            for (const key in builtSplines) {
                this.scene.add(builtSplines[key].mesh);
            }
        }

        this.setSplines(builtSplines);
        this.setSpline({ arcSegments });
        this.clipProgress({
            arcSegments: this.splineState.arcSegments,
            curveType: this.splineState.curveType,
            progress: this.animationState.progress
        });
        this.updateSplineMesh(arcSegments);

        return {
            points: this.points,
            splines: this.splines
        };
    }

    removePoint(minPoints = 3) {
        if (this.points.length <= minPoints) {
            return null;
        }

        const lastIndex = (this.controlGroup?.children?.length || 0) - 1;
        const cube = lastIndex >= 0 ? this.controlGroup.children[lastIndex] : null;
        this.points.pop();

        if (!cube) {
            return null;
        }
        this.controlGroup.remove(cube);

        if (this.transformControl?.object && cube.uuid === this.transformControl.object.uuid) {
            this.transformControl.detach();
        }
        cube.dispose?.();
        return cube;
    }

    buildSplines() {
        // Keep existing modes: uniform / centripetal / chordal.
        return this;
    }

    updateSplineMesh(arcSegments = this.splineState.arcSegments) {
        const splines = this.splines || {};
        const nextSegments = Math.max(2, arcSegments | 0);
        const point = new Vector3();

        for (const key in splines) {
            const spline = splines[key];
            const splineMesh = spline?.mesh;
            const geometry = splineMesh?.geometry;
            if (!geometry?.attributes?.position) {
                continue;
            }

            let position = geometry.attributes.position;
            const currentSegments = position.count;
            if (currentSegments !== nextSegments) {
                geometry.setAttribute(
                    'position',
                    new BufferAttribute(new Float32Array(nextSegments * 3), 3)
                );
                position = geometry.attributes.position;
            }

            for (let i = 0; i < nextSegments; i++) {
                const t = i / (nextSegments - 1);
                spline.getPoint(t, point);
                position.setXYZ(i, point.x, point.y, point.z);
            }

            position.needsUpdate = true;
        }

        this.splineState.arcSegments = nextSegments;
        return this;
    }

    clipProgress({
        arcSegments = this.splineState.arcSegments,
        curveType = this.splineState.curveType,
        progress = this.animationState.progress
    } = {}) {
        // Progress is interpreted as normalized arc length (u in [0, 1]), not raw point index.
        const spline = this.splines?.[curveType];
        if (!spline) {
            this.splinePoints = [];
            this.clipSplinePoints = [];
            return this.clipSplinePoints;
        }

        const nextArcSegments = Math.max(2, arcSegments | 0);
        const nextProgress = Math.min(1, Math.max(0, progress));
        this.splineState.arcSegments = nextArcSegments;
        this.splineState.curveType = curveType;
        this.animationState.progress = nextProgress;

        // Build a full curve sample with getPointAt(u): equal u step ~= equal traveled distance.
        spline.updateArcLengths();
        this.splinePoints = [];
        for (let i = 0; i <= nextArcSegments; i++) {
            const u = i / nextArcSegments;
            this.splinePoints.push(spline.getPointAt(u));
        }

        const remaining = Math.max(0, 1 - nextProgress);
        if (remaining === 0) {
            const delta = 1 / nextArcSegments;
            // Keep two tail points when progress is 1 so camera lookAt still has a valid direction.
            this.clipSplinePoints = [
                spline.getPointAt(Math.max(0, 1 - delta)),
                spline.getPointAt(1)
            ];
            return this.clipSplinePoints;
        }

        // Build the visible/remaining curve from current progress to the end.
        const clipSegments = Math.max(1, Math.ceil(remaining * nextArcSegments));
        this.clipSplinePoints = [];
        for (let i = 0; i <= clipSegments; i++) {
            const ratio = i / clipSegments;
            const u = nextProgress + remaining * ratio;
            this.clipSplinePoints.push(spline.getPointAt(Math.min(1, u)));
        }
        return this.clipSplinePoints;
    }

    setCameraFromSpline(
        state = 0,
        index = 0,
        cameraState = this.cameraState,
        _arcSegments = this.splineState.arcSegments
    ) {
        let positionIndex = index;
        let targetIndex = index + 1;

        switch (state) {
            case 0:
                this._setCameraPoseFromArray(0, 1, this.points);
                break;
            case 1:
                if (index >= this.clipSplinePoints.length - 1) positionIndex = Math.max(0, this.clipSplinePoints.length - 2);
                targetIndex = positionIndex + 1;
                this._setCameraPoseFromArray(positionIndex, targetIndex, this.clipSplinePoints);
                break;
            case 2:
                if (index === this.points.length) {
                    positionIndex -= 1;
                    targetIndex -= 1;
                }
                this._setCameraPoseFromArray(positionIndex, targetIndex, this.points);
                break;
            case 3:
                if (this.clipSplinePoints.length < 2) {
                    return this;
                }
                this._setCameraPoseFromArray(0, 1, this.clipSplinePoints);
                break;
            default:
                break;
        }

        this.setCamera(cameraState);
        return this;
    }

    setPreviewCamera(
        state = 0,
        index = 0,
        cameraState = this.cameraState,
        arcSegments = this.splineState.arcSegments
    ) {
        return this.setCameraFromSpline(state, index, cameraState, arcSegments);
    }

    exportSpline() {
        const objects = this.controlGroup?.children || [];
        const source = objects.length > 0 ? objects : this.points;
        const rows = [];

        for (let i = 0; i < source.length; i++) {
            const p = source[i].position || source[i];
            rows.push(`new Vector3(${p.x}, ${p.y}, ${p.z})`);
        }

        const output = `[${rows.join(',\n\t')}]`;
        console.log(rows.join(',\n'));
        if (typeof window !== 'undefined' && typeof window.prompt === 'function') {
            window.prompt('copy and paste code', output);
        }
        return output;
    }

    setViewPortFromPixels({
        left = 0,
        top = 0,
        scale = this.viewPort.relative.width,
        clearColor,
        width = 1,
        height = 1
    } = {}) {
        const partial = {
            enabled: true,
            relative: {
                left: left / Math.max(1, width),
                top: top / Math.max(1, height),
                width: scale,
                height: scale
            }
        };
        if (clearColor !== undefined) {
            partial.clearColor = clearColor;
        }
        return this.setViewPort(partial);
    }

    stepAnimationOnSpline(arcSegments = this.splineState.arcSegments) {
        const frame = this.step();
        if (!frame) {
            return null;
        }

        const spline = this.splines?.[this.splineState.curveType];
        if (!spline) {
            return frame;
        }

        // eased is the arc-length parameter u. Camera position follows getPointAt(u).
        const eased = Math.min(1, Math.max(0, frame.eased));
        const safeSegments = Math.max(2, arcSegments | 0);
        // Look-ahead gives a stable forward direction for camera lookAt.
        let lookAhead = 1 / safeSegments;
        if (lookAhead <= 0) {
            lookAhead = 0.001;
        }
        let targetU = Math.min(1, eased + lookAhead);
        if (targetU <= eased) {
            targetU = Math.max(0, eased - lookAhead);
        }

        const startPoint = spline.getPointAt(eased, this._tmpCurvePosition);
        const targetPoint = spline.getPointAt(targetU, this._tmpCurveTarget);
        if (startPoint.distanceToSquared(targetPoint) < 1e-12) {
            // End-point fallback: use tangent when look-ahead collapses to the same position.
            spline.getTangentAt(Math.min(0.999999, eased), this._tmpCurveTangent);
            targetPoint.copy(startPoint).addScaledVector(this._tmpCurveTangent, 0.1);
        }
        this.setCameraPose({
            position: startPoint,
            target: targetPoint
        });
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
        // Always rebuild the generator so play always starts from current progress.
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

    reset(resetCamera = true) {
        this.isAnimating = false;
        this.animationTask = null;
        this.animationState.pause = false;
        this.animationState.progress = 0;

        if (resetCamera) {
            this.setCameraFromSpline(0, 0);
        }
        return this;
    }

    dispose() {
        this.reset(false);
        this.stopAnimationLoop();
        this.unmountInteractions();
        this._cleanupViewPortSideEffects();

        if (this._ownsControlGroup && this.controlGroup && this.scene && this.controlGroup.parent === this.scene) {
            this.scene.remove(this.controlGroup);
        }
        if (this._ownsControlGeometry && this.controlGeometry) {
            this.controlGeometry.dispose();
        }
        if (this._ownsControlMaterial && this.controlMaterial) {
            this.controlMaterial.dispose();
        }

        this.renderer = null;
        this.scene = null;
        this.sceneCamera = null;
        this.camera = null;
        this.cameraHelper = null;
        this.raycaster = null;
        this.transformControl = null;
        this.controlGroup = null;
        this.controlGeometry = null;
        this.controlMaterial = null;
        this._ownsControlGroup = false;
        this._ownsControlGeometry = false;
        this._ownsControlMaterial = false;
        this.dimension = null;
        this._interactionBindings = null;
        return this;
    }

    _applyCameraState() {
        if (!this.camera) return;

        this.camera.aspect = this.cameraState.aspect;
        this.camera.fov = this.cameraState.fov;
        this.camera.near = this.cameraState.near;
        this.camera.far = this.cameraState.far;
        this.camera.updateProjectionMatrix();
        this._syncCameraHelper();
    }

    _syncCameraHelper() {
        if (!this.cameraHelper) return;
        this.cameraHelper.visible = !!this.cameraState.showHelper;
        this.cameraHelper.update();
    }

    _cleanupViewPortSideEffects() {
        if (this.renderer) {
            this.renderer.setScissorTest(false);
        }
    }

    _setCameraPoseFromArray(positionIndex, targetIndex, array) {
        const position = array?.[positionIndex];
        const target = array?.[targetIndex];
        if (!position || !target) {
            return;
        }
        this.setCameraPose({
            position,
            target
        });
    }

    _renderView(renderer, scene, view, fullHeight) {
        const { left, top, width, height, clearColor, camera } = view;
        if (!camera) return;

        const border = this.viewPort.border;
        const isViewPort = view.name === 'viewPort';
        const borderSize = isViewPort && border.enabled ? Math.max(0, border.size) : 0;

        if (isViewPort && borderSize > 0) {
            renderer.setClearColor(border.color, 1);
            renderer.setScissor(left - borderSize, fullHeight - top - height - borderSize, width + borderSize * 2, height + borderSize * 2);
            renderer.setViewport(left - borderSize, fullHeight - top - height - borderSize, width + borderSize * 2, height + borderSize * 2);
            renderer.setScissorTest(true);
            renderer.clear(true, true, true);
        }

        renderer.setClearColor(clearColor, 1);
        renderer.setScissor(left, fullHeight - top - height, width, height);
        renderer.setViewport(left, fullHeight - top - height, width, height);
        renderer.setScissorTest(true);
        const disableFrustumCulling = isViewPort && this.cameraState.frustumCulling === false;
        this._renderScene(renderer, scene, camera, disableFrustumCulling);
    }

    _renderScene(renderer, scene, camera, disableFrustumCulling = false) {
        if (!disableFrustumCulling) {
            renderer.render(scene, camera);
            return;
        }

        const previousStates = [];
        scene.traverse((object) => {
            if (!object || !('frustumCulled' in object)) return;
            previousStates.push([object, object.frustumCulled]);
            object.frustumCulled = false;
        });

        try {
            renderer.render(scene, camera);
        } finally {
            for (let i = 0; i < previousStates.length; i++) {
                const [object, previous] = previousStates[i];
                object.frustumCulled = previous;
            }
        }
    }
}

export { TrackEditor, TrackEditor as default };
