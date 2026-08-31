import {
    CurvePath,
    Euler,
    Group,
    LineCurve3,
    MathUtils,
    Mesh,
    MeshBasicMaterial,
    Quaternion,
    SphereGeometry,
    TubeGeometry,
    Vector3,
} from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';

const GENERATED_TARGET_KIND = 'sequenceKeyframe';
const HOLD_ACTION = 'hold';
const OPEN_ACTION = 'open';
const CLOSE_ACTION = 'closeUntilContact';
const VALID_GRIP_ACTIONS = new Set([
    HOLD_ACTION,
    OPEN_ACTION,
    CLOSE_ACTION,
]);
const CHANNELS = [
    {
        key: 'positionX',
        label: 'Position X',
        color: '#ff5d6c',
        group: 'position',
        index: 0,
        min: -0.7,
        max: 0.7,
        unit: 'm',
    },
    {
        key: 'positionY',
        label: 'Position Y',
        color: '#67d17a',
        group: 'position',
        index: 1,
        min: -0.1,
        max: 0.8,
        unit: 'm',
    },
    {
        key: 'positionZ',
        label: 'Position Z',
        color: '#55a7ff',
        group: 'position',
        index: 2,
        min: -0.7,
        max: 0.7,
        unit: 'm',
    },
    {
        key: 'rotationX',
        label: 'Rotation X',
        color: '#f28ab2',
        group: 'rotation',
        index: 0,
        min: -180,
        max: 180,
        unit: 'deg',
    },
    {
        key: 'rotationY',
        label: 'Rotation Y',
        color: '#ffb454',
        group: 'rotation',
        index: 1,
        min: -180,
        max: 180,
        unit: 'deg',
    },
    {
        key: 'rotationZ',
        label: 'Rotation Z',
        color: '#6de1d2',
        group: 'rotation',
        index: 2,
        min: -180,
        max: 180,
        unit: 'deg',
    },
];
const JOINT_CHANNELS = Array.from({ length: 6 }, (_, index) => ({
    key: `joint${index + 1}`,
    label: `Joint ${index + 1}`,
    color: [
        '#ff5d6c',
        '#67d17a',
        '#55a7ff',
        '#f28ab2',
        '#ffb454',
        '#6de1d2',
    ][index],
    group: 'joints',
    index,
    min: -360,
    max: 360,
    unit: 'deg',
}));
const GRAPH_SIDEBAR_WIDTH = 178;
const GRAPH_TIMELINE_HEIGHT = 24;
const GRAPH_POINT_RADIUS = 4;
const TRAJECTORY_SAMPLES_PER_SEGMENT = 32;
const _worldPosition = new Vector3();
const _worldQuaternion = new Quaternion();
const _currentPosition = new Vector3();
const _currentQuaternion = new Quaternion();
const _parentWorldQuaternion = new Quaternion();
const _editorEuler = new Euler();
const _sampledPosition = new Vector3();
const _sampledQuaternion = new Quaternion();
const _sampledChainPose = [];

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function clampIndex(index, length) {
    if (length <= 0) {
        return -1;
    }
    return Math.min(length - 1, Math.max(0, Math.trunc(index)));
}

function smoothstep(value) {
    const t = clamp(value, 0, 1);
    return t * t * (3 - 2 * t);
}

function sanitizeDuration(value, fallback = 1) {
    return Math.max(1, Number.isFinite(value) ? value : fallback);
}

function sanitizeHold(value) {
    return Math.max(0, Number.isFinite(value) ? value : 0);
}

function sanitizeGripAction(value) {
    return VALID_GRIP_ACTIONS.has(value) ? value : HOLD_ACTION;
}

function unwrapAngle(value, reference) {
    let result = value;
    while (result - reference > 180) {
        result -= 360;
    }
    while (result - reference < -180) {
        result += 360;
    }
    return result;
}

function createElement(tagName, className, textContent = '') {
    const element = document.createElement(tagName);
    element.className = className;
    if (textContent) {
        element.textContent = textContent;
    }
    return element;
}

function setButtonType(button) {
    button.type = 'button';
    return button;
}

class SequenceGenerator {
    constructor(options = {}) {
        this.scene = options.scene ?? null;
        this.camera = options.camera ?? null;
        this.domElement = options.domElement ?? null;
        this.orbitControls = options.orbitControls ?? null;
        this.targetObject = options.targetObject ?? null;
        this.sequencePlayer = options.sequencePlayer ?? null;
        this.requestRender = options.requestRender ?? (() => {});
        this.onSequenceChange = options.onSequenceChange ?? (() => {});
        this.onPlay = options.onPlay ?? (() => {});
        this.onStop = options.onStop ?? (() => {});
        this.onStatus = options.onStatus ?? (() => {});
        this.onEditorVisibilityChange = options.onEditorVisibilityChange
            ?? (() => {});
        this.getCurrentPose = options.getCurrentPose ?? null;
        this.isOrientationConstrained = options.isOrientationConstrained
            ?? (() => true);
        this.getCurrentChainPose = options.getCurrentChainPose
            ?? options.getCurrentJointState
            ?? (() => this.sequencePlayer?.getJointState?.() ?? []);
        this.setCurrentChainPose = options.setCurrentChainPose
            ?? options.setCurrentJointState
            ?? ((joints) => this.sequencePlayer?.setJointState?.(joints));
        this.sampleChainPose = options.sampleChainPose ?? null;

        this.defaultDurationMs = sanitizeDuration(options.defaultDurationMs, 400);
        this.defaultGripDurationMs = sanitizeDuration(
            options.defaultGripDurationMs,
            450,
        );
        this.recordPositionTolerance = Math.max(
            0,
            options.recordPositionTolerance ?? 0.012,
        );
        this.recordRotationTolerance = Math.max(
            0,
            options.recordRotationTolerance ?? 0.12,
        );
        this.recordSolveTimeoutMs = Math.max(
            100,
            options.recordSolveTimeoutMs ?? 5000,
        );

        this.keyframes = [];
        this.selectedIndex = -1;
        this.context = null;
        this._idCounter = 0;
        this._isRecording = false;
        this._recordingPromise = null;
        this._disabledControls = new Map();
        this._disposed = false;
        this._isDraggingTarget = false;
        this._graphDrag = null;
        this._graphPoints = [];
        this._graphChannelRanges = [];
        this._resolvedPoseById = new Map();
        this._markerGroup = null;
        this._targetMarker = null;
        this._transformControls = null;
        this._transportButton = null;
        this._playbackActive = false;
        this._panel = null;
        this._canvas = null;
        this._canvasContext = null;
        this._resizeObserver = null;
        this._form = {};
        this._modeButtons = {};
        this._formDirtyLabel = false;
        this._formDirtyHold = false;
        this._formDirtyGripAction = false;
        this.params = {
            editorOpen: options.editorOpen ?? true,
            visualizationVisible: options.visualizationVisible ?? true,
            trajectoryVisible: options.trajectoryVisible ?? false,
        };

        this._createSceneControls();
        this._createBottomEditor();
        this._syncFormFromTarget();
        this.setVisualizationVisible(this.params.visualizationVisible);
        this.setTrajectoryVisible(this.params.trajectoryVisible);
        this.setEditorOpen(this.params.editorOpen);
    }

    addResolverKeyframe({
        id,
        label = 'Dynamic target',
        resolver,
        durationMs = this.defaultDurationMs,
        holdMs = 0,
        gripAction = HOLD_ACTION,
        gripDurationMs = this.defaultGripDurationMs,
        toleranceProfile,
    } = {}) {
        if (!resolver) {
            throw new TypeError('A resolver keyframe requires a resolver function.');
        }
        const keyframe = {
            id: id || this._nextId(),
            label,
            kind: 'resolver',
            resolver,
            durationMs: sanitizeDuration(durationMs, this.defaultDurationMs),
            holdMs: sanitizeHold(holdMs),
            gripAction: sanitizeGripAction(gripAction),
            gripDurationMs: sanitizeDuration(
                gripDurationMs,
                this.defaultGripDurationMs,
            ),
            toleranceProfile,
        };
        this.keyframes.push(keyframe);
        this.selectKeyframe(this.keyframes.length - 1, { preview: false });
        this._commitChange();
        return keyframe;
    }

    addRecordedKeyframeAfterSolve(options = {}) {
        if (this._recordingPromise) {
            return this._recordingPromise;
        }
        this._recordingPromise = this._recordCurrentPoseAfterSolve(options);
        return this._recordingPromise;
    }

    async _recordCurrentPoseAfterSolve(options) {
        this._setRecordingBusy(true);
        this.onStatus('Solving IK before recording...');
        try {
            const solved = await this._waitForSolverToSettle();
            if (!solved || this._disposed) {
                if (!this._disposed) {
                    const poseSettled = this._canRecordCurrentPose();
                    if (poseSettled) {
                        this.onStatus(
                            'IK solver did not update; keyframe not recorded',
                        );
                    }
                }
                return null;
            }
            this._syncFormFromTarget();
            return this.addRecordedKeyframe(options);
        } finally {
            this._setRecordingBusy(false);
            this._recordingPromise = null;
        }
    }

    async _waitForSolverToSettle() {
        const player = this.sequencePlayer;
        const initialRevision = player?.getSolveRevision?.() ?? null;
        player?.queueSolveFromTarget?.();
        if (!player?.hasPendingSolve) {
            return true;
        }

        const deadline = Date.now() + this.recordSolveTimeoutMs;
        let elapsedFrames = 0;
        do {
            await this._waitForNextFrame();
            elapsedFrames += 1;
            const currentRevision = player.getSolveRevision?.();
            const solverAdvanced = initialRevision === null
                ? elapsedFrames >= 2
                : (
                    currentRevision !== undefined
                    && currentRevision > initialRevision
                );
            const poseSettled = this._canRecordCurrentPose({
                reportStatus: false,
            });
            if (
                solverAdvanced
                && poseSettled
                && !player.isSolving?.()
            ) {
                return true;
            }
        } while (!this._disposed && Date.now() < deadline);
        return false;
    }

    _waitForNextFrame() {
        return new Promise((resolve) => {
            if (typeof requestAnimationFrame === 'function') {
                requestAnimationFrame(() => resolve());
                return;
            }
            setTimeout(resolve, 0);
        });
    }

    _setRecordingBusy(busy) {
        this._isRecording = busy;
        this._panel?.classList.toggle('is-recording', this._isRecording);
        if (this._panel) {
            this._panel.setAttribute(
                'aria-busy',
                String(this._isRecording),
            );
        }
        if (this._isRecording) {
            this._disabledControls.clear();
            for (
                const control
                of this._panel?.querySelectorAll('button, input, select') ?? []
            ) {
                this._disabledControls.set(control, control.disabled);
                control.disabled = true;
            }
        } else {
            for (const [control, disabled] of this._disabledControls) {
                control.disabled = disabled;
            }
            this._disabledControls.clear();
        }
        if (this._transformControls) {
            this._transformControls.enabled = !this._isRecording;
        }
        this.requestRender();
    }

    _createRecordedKeyframe(options = {}) {
        const hasExplicitPose = (
            Array.isArray(options.position)
            && options.position.length === 3
            && options.position.every(Number.isFinite)
            && Array.isArray(options.rotation)
            && options.rotation.length === 3
            && options.rotation.every(Number.isFinite)
        );
        if (
            !this.targetObject
            || (!hasExplicitPose && !this._canRecordCurrentPose())
        ) {
            return null;
        }
        if (hasExplicitPose) {
            _worldPosition.fromArray(options.position);
            _editorEuler.set(
                MathUtils.degToRad(options.rotation[0]),
                MathUtils.degToRad(options.rotation[1]),
                MathUtils.degToRad(options.rotation[2]),
                'XYZ',
            );
        } else {
            if (!this._getCurrentWorldPose(
                _worldPosition,
                _worldQuaternion,
            )) {
                this._getTargetWorldTransform(
                    _worldPosition,
                    _worldQuaternion,
                );
            }
            _editorEuler.setFromQuaternion(_worldQuaternion, 'XYZ');
        }
        const explicitChainPose = this._sanitizeChainPose(
            options.chainPose ?? options.joints,
        );
        const currentChainPose = explicitChainPose
            ?? this._sanitizeChainPose(this.getCurrentChainPose());
        if (!currentChainPose) {
            this.onStatus('A complete six-joint chain pose is required');
            return null;
        }
        return {
            id: this._claimId(options.id),
            label: (
                options.label
            )
                ? options.label
                : this._getNewKeyframeLabel(),
            kind: 'recorded',
            position: hasExplicitPose
                ? options.position.slice()
                : _worldPosition.toArray(),
            rotation: hasExplicitPose
                ? options.rotation.slice()
                : [
                    MathUtils.radToDeg(_editorEuler.x),
                    MathUtils.radToDeg(_editorEuler.y),
                    MathUtils.radToDeg(_editorEuler.z),
                ],
            chainPose: currentChainPose,
            durationMs: sanitizeDuration(
                options.durationMs ?? this._readNumberInput(
                    this._form.durationMs,
                    this.defaultDurationMs,
                ),
                this.defaultDurationMs,
            ),
            holdMs: sanitizeHold(
                options.holdMs ?? (
                    this._formDirtyHold
                        ? this._readNumberInput(this._form.holdMs, 0)
                        : 0
                ),
            ),
            gripAction: sanitizeGripAction(
                options.gripAction ?? (
                    this._formDirtyGripAction
                        ? this._form.gripAction?.value
                        : HOLD_ACTION
                ),
            ),
            gripDurationMs: sanitizeDuration(
                options.gripDurationMs ?? this._readNumberInput(
                    this._form.gripDurationMs,
                    this.defaultGripDurationMs,
                ),
                this.defaultGripDurationMs,
            ),
        };
    }

    addRecordedKeyframe(options = {}) {
        const keyframe = this._createRecordedKeyframe(options);
        if (!keyframe) {
            return null;
        }
        this.keyframes.push(keyframe);
        this.selectKeyframe(this.keyframes.length - 1, { preview: false });
        this._commitChange();
        this.onStatus(`Recorded ${keyframe.label}`);
        return keyframe;
    }

    addRecordedKeyframes(optionsList = [], { selectedIndex = 0 } = {}) {
        const recorded = [];
        for (const options of optionsList) {
            const keyframe = this._createRecordedKeyframe(options);
            if (!keyframe) {
                continue;
            }
            this.keyframes.push(keyframe);
            recorded.push(keyframe);
        }
        if (recorded.length === 0) {
            return recorded;
        }
        this.selectedIndex = clampIndex(selectedIndex, this.keyframes.length);
        this._syncFormFromSelection();
        this._commitChange();
        this.onStatus(`Loaded ${recorded.length} recorded keyframes`);
        return recorded;
    }

    updateSelectedKeyframe() {
        const keyframe = this.getSelectedKeyframe();
        if (!keyframe) {
            return false;
        }
        const label = this._form.label?.value.trim();
        keyframe.label = label || keyframe.label;
        keyframe.durationMs = sanitizeDuration(
            this._readNumberInput(
                this._form.durationMs,
                keyframe.durationMs,
            ),
            this.defaultDurationMs,
        );
        keyframe.holdMs = sanitizeHold(
            this._readNumberInput(this._form.holdMs, keyframe.holdMs),
        );
        keyframe.gripDurationMs = sanitizeDuration(
            this._readNumberInput(
                this._form.gripDurationMs,
                keyframe.gripDurationMs,
            ),
            this.defaultGripDurationMs,
        );
        keyframe.gripAction = sanitizeGripAction(
            this._form.gripAction?.value,
        );

        if (keyframe.kind === 'recorded') {
            if (!this._canRecordCurrentPose()) {
                return false;
            }
            const currentChainPose = this._sanitizeChainPose(
                this.getCurrentChainPose(),
            );
            if (!currentChainPose) {
                this.onStatus('A complete six-joint chain pose is required');
                return false;
            }
            if (!this._getCurrentWorldPose(
                _worldPosition,
                _worldQuaternion,
            )) {
                this._getTargetWorldTransform(
                    _worldPosition,
                    _worldQuaternion,
                );
            }
            _editorEuler.setFromQuaternion(_worldQuaternion, 'XYZ');
            keyframe.position = _worldPosition.toArray();
            keyframe.rotation = [
                MathUtils.radToDeg(_editorEuler.x),
                    MathUtils.radToDeg(_editorEuler.y),
                    MathUtils.radToDeg(_editorEuler.z),
                ];
            keyframe.chainPose = currentChainPose;
        }

        this._syncFormFromSelection();
        this._commitChange();
        this.onStatus(`Updated ${keyframe.label}`);
        return true;
    }

    deleteSelectedKeyframe() {
        if (
            this.selectedIndex < 0
            || this.selectedIndex >= this.keyframes.length
        ) {
            return false;
        }
        const [removed] = this.keyframes.splice(this.selectedIndex, 1);
        this._resolvedPoseById.delete(removed.id);
        this.selectedIndex = clampIndex(
            this.selectedIndex,
            this.keyframes.length,
        );
        this._syncFormFromSelection();
        this._commitChange();
        this.onStatus(`Deleted ${removed.label}`);
        return true;
    }

    selectKeyframe(index, { preview = true } = {}) {
        const nextIndex = clampIndex(index, this.keyframes.length);
        if (nextIndex < 0) {
            this.selectedIndex = -1;
            this._syncFormFromSelection();
            return false;
        }
        this.selectedIndex = nextIndex;
        this._syncFormFromSelection();
        if (preview) {
            this.previewSelectedKeyframe();
        }
        this._drawGraph();
        if (preview) {
            this._refreshMarkers();
        } else {
            this._updateMarkerSelection();
        }
        return true;
    }

    selectPreviousKeyframe() {
        return this.selectKeyframe(this.selectedIndex - 1);
    }

    selectNextKeyframe() {
        return this.selectKeyframe(this.selectedIndex + 1);
    }

    getSelectedKeyframe() {
        return this.keyframes[this.selectedIndex] ?? null;
    }

    getKeyframes() {
        return this.keyframes.slice();
    }

    captureRuntimeJointState(index, joints) {
        const keyframe = this.keyframes[index];
        const resolved = this._sanitizeChainPose(joints);
        if (!keyframe || keyframe.kind !== 'resolver' || !resolved) {
            return false;
        }
        keyframe.runtimeJoints = resolved;
        this._syncFormFromSelection();
        this._drawGraph();
        return true;
    }

    _sanitizeChainPose(values) {
        if (
            !Array.isArray(values)
            || values.length !== JOINT_CHANNELS.length
            || values.some((value) => !Number.isFinite(value))
        ) {
            return null;
        }
        return values.slice();
    }

    getContext() {
        return this.context;
    }

    setContext(context, { previewFirst = true } = {}) {
        this.context = context ?? null;
        if (previewFirst && this.keyframes.length > 0) {
            this.selectKeyframe(0, { preview: true });
        } else {
            this._drawGraph();
            this._refreshMarkers();
        }
    }

    clearContext() {
        this.context = null;
        this._resolvedPoseById.clear();
        for (const keyframe of this.keyframes) {
            if (keyframe.kind === 'resolver') {
                delete keyframe.runtimeJoints;
            }
        }
        this._drawGraph();
        this._refreshMarkers();
    }

    previewSelectedKeyframe() {
        const keyframe = this.getSelectedKeyframe();
        if (!keyframe || !this.targetObject) {
            return false;
        }
        const chainPose = this._sanitizeChainPose(keyframe.chainPose);
        if (keyframe.kind === 'recorded' && chainPose) {
            this.setCurrentChainPose(chainPose);
            if (
                this.getCurrentPose
                && this.getCurrentPose(
                    _worldPosition,
                    _worldQuaternion,
                ) === true
            ) {
                this._setTargetWorldTransform(
                    _worldPosition,
                    _worldQuaternion,
                );
            }
            this._syncFormFromSelection();
            this._drawGraph();
            this.requestRender();
            return true;
        }
        if (!this._resolveKeyframePose(
            keyframe,
            this._createResolverContext(),
            _worldPosition,
            _worldQuaternion,
        )) {
            this.onStatus(`${keyframe.label} needs a selected target`);
            return false;
        }
        this._setTargetWorldTransform(_worldPosition, _worldQuaternion);
        this.sequencePlayer?.queueSolveFromTarget?.();
        this._syncFormFromTarget();
        this._drawGraph();
        this.requestRender();
        return true;
    }

    buildSequence() {
        const steps = [];
        this.keyframes.forEach((keyframe, index) => {
            const target = {
                kind: GENERATED_TARGET_KIND,
                keyframeId: keyframe.id,
            };
            const commonStep = {
                id: `${keyframe.id}-pose`,
                target,
                durationMs: keyframe.durationMs,
                keyframeId: keyframe.id,
                keyframeIndex: index,
                keyframeKind: keyframe.kind,
                keyframeLabel: keyframe.label,
            };
            if (
                keyframe.kind === 'recorded'
                && this._sanitizeChainPose(keyframe.chainPose)
            ) {
                steps.push({
                    ...commonStep,
                    type: 'joint',
                });
            } else {
                steps.push({
                    ...commonStep,
                    type: 'move',
                    interpolation: 'smooth',
                    rotationInterpolation: 'eulerXYZ',
                    solveWhileLerping: true,
                    completion: 'solve',
                    toleranceProfile: keyframe.toleranceProfile,
                });
            }

            if (keyframe.holdMs > 0) {
                steps.push({
                    id: `${keyframe.id}-hold`,
                    type: 'wait',
                    durationMs: keyframe.holdMs,
                    keyframeId: keyframe.id,
                    keyframeIndex: index,
                    keyframeLabel: keyframe.label,
                });
            }

            if (keyframe.gripAction !== HOLD_ACTION) {
                steps.push({
                    id: `${keyframe.id}-grip`,
                    type: 'grip',
                    mode: keyframe.gripAction,
                    durationMs: keyframe.gripDurationMs,
                    keyframeId: keyframe.id,
                    keyframeIndex: index,
                    keyframeLabel: keyframe.label,
                });
            }
        });

        return {
            name: 'generated-keyframe-sequence',
            version: 3,
            channels: [
                ...CHANNELS,
                ...JOINT_CHANNELS,
            ].map((channel) => channel.key),
            steps,
        };
    }

    resolveTarget(targetSpec, context, outPosition, outQuaternion) {
        const keyframe = this._findTargetKeyframe(targetSpec);
        return keyframe
            ? this._resolveKeyframePose(
                keyframe,
                context,
                outPosition,
                outQuaternion,
            )
            : false;
    }

    resolveJointState(targetSpec, context, outJointState) {
        const keyframe = this._findTargetKeyframe(targetSpec);
        const chainPose = this._sanitizeChainPose(keyframe?.chainPose);
        if (!chainPose) {
            return false;
        }
        outJointState.push(...chainPose);
        return true;
    }

    hasGripAction(action) {
        return this.keyframes.some(
            (keyframe) => keyframe.gripAction === action,
        );
    }

    play() {
        if (this.keyframes.length === 0) {
            this.onStatus('Record at least one keyframe');
            return false;
        }
        const started = this.onPlay(this.context, this.buildSequence());
        if (started === false) {
            return false;
        }
        this.setPlaybackActive(true);
        return true;
    }

    stop() {
        this.onStop();
        this.setPlaybackActive(false);
    }

    togglePlayback() {
        if (this._playbackActive || this.sequencePlayer?.isActive?.()) {
            this.stop();
            return false;
        }
        return this.play();
    }

    setPlaybackActive(active) {
        this._playbackActive = active;
        if (!this._transportButton) {
            return;
        }
        this._transportButton.classList.toggle(
            'is-playing',
            this._playbackActive,
        );
        const label = this._playbackActive ? 'Stop' : 'Play';
        this._transportButton.setAttribute('aria-label', label);
        this._transportButton.title = label;
    }

    isPlaybackActive() {
        return this._playbackActive;
    }

    setEditorOpen(open) {
        this.params.editorOpen = open;
        if (this._panel) {
            this._panel.hidden = !this.params.editorOpen;
        }
        if (typeof document !== 'undefined') {
            document.documentElement.style.setProperty(
                '--sequence-editor-height',
                this.params.editorOpen ? '320px' : '0px',
            );
        }
        this._drawGraph();
        this.onEditorVisibilityChange(this.params.editorOpen);
        this.requestRender();
    }

    setVisualizationVisible(visible) {
        this.params.visualizationVisible = visible;
        if (this._transformControls) {
            this._transformControls.enabled = this.params.visualizationVisible;
            this._transformControls.visible = this.params.visualizationVisible;
        }
        if (this._targetMarker) {
            this._targetMarker.visible = this.params.visualizationVisible;
        }
        this.requestRender();
    }

    isVisualizationVisible() {
        return this.params.visualizationVisible;
    }

    setTrajectoryVisible(visible) {
        this.params.trajectoryVisible = visible;
        if (this._markerGroup) {
            this._markerGroup.visible = this.params.trajectoryVisible;
        }
        this.requestRender();
    }

    isTrajectoryVisible() {
        return this.params.trajectoryVisible;
    }

    isEditorOpen() {
        return this.params.editorOpen;
    }

    getEditorHeight() {
        return this.params.editorOpen
            ? (this._panel?.getBoundingClientRect().height ?? 320)
            : 0;
    }

    isInteracting() {
        return (
            this._isRecording
            || this._isDraggingTarget
            || this._graphDrag !== null
        );
    }

    syncFromTarget() {
        this._syncFormFromTarget();
    }

    dispose() {
        this._disposed = true;
        this._resizeObserver?.disconnect();
        this._transformControls?.detach();
        this._transformControls?.dispose();
        this._transformControls?.removeFromParent();
        this._disposeMarkerGroup();
        this._markerGroup?.removeFromParent();
        if (this._targetMarker) {
            this._targetMarker.geometry?.dispose();
            this._targetMarker.material?.dispose();
            this._targetMarker.removeFromParent();
        }
        this._panel?.remove();
    }

    _nextId() {
        let id;
        do {
            this._idCounter += 1;
            id = `keyframe-${this._idCounter}`;
        } while (this.keyframes.some((keyframe) => keyframe.id === id));
        return id;
    }

    _claimId(requestedId) {
        const id = requestedId || this._nextId();
        const match = /^keyframe-(\d+)$/.exec(id);
        if (match) {
            this._idCounter = Math.max(this._idCounter, Number(match[1]));
        }
        return this.keyframes.some((keyframe) => keyframe.id === id)
            ? this._nextId()
            : id;
    }

    _findTargetKeyframe(targetSpec) {
        if (
            targetSpec?.kind !== GENERATED_TARGET_KIND
            || !targetSpec.keyframeId
        ) {
            return null;
        }
        return this.keyframes.find(
            (keyframe) => keyframe.id === targetSpec.keyframeId,
        ) ?? null;
    }

    _resolveKeyframePose(
        keyframe,
        context,
        outPosition,
        outQuaternion,
    ) {
        if (keyframe.kind === 'resolver') {
            const resolved = keyframe.resolver(
                context,
                outPosition,
                outQuaternion,
                keyframe,
            ) === true;
            if (resolved) {
                _editorEuler.setFromQuaternion(outQuaternion, 'XYZ');
                this._resolvedPoseById.set(keyframe.id, {
                    position: outPosition.toArray(),
                    rotation: [
                        MathUtils.radToDeg(_editorEuler.x),
                        MathUtils.radToDeg(_editorEuler.y),
                        MathUtils.radToDeg(_editorEuler.z),
                    ],
                });
            }
            return resolved;
        }

        outPosition.fromArray(keyframe.position);
        _editorEuler.set(
            MathUtils.degToRad(keyframe.rotation[0]),
            MathUtils.degToRad(keyframe.rotation[1]),
            MathUtils.degToRad(keyframe.rotation[2]),
            'XYZ',
        );
        outQuaternion.setFromEuler(_editorEuler);
        return true;
    }

    _getKeyframeChannelPose(keyframe) {
        if (keyframe.kind === 'recorded') {
            const chainPose = this._sanitizeChainPose(keyframe.chainPose);
            let position = keyframe.position.slice();
            let rotation = keyframe.rotation.slice();
            if (
                chainPose
                && this._sampleChainPoseTransform(
                    chainPose,
                    _sampledPosition,
                    _sampledQuaternion,
                )
            ) {
                _editorEuler.setFromQuaternion(_sampledQuaternion, 'XYZ');
                position = _sampledPosition.toArray();
                rotation = [
                    MathUtils.radToDeg(_editorEuler.x),
                    MathUtils.radToDeg(_editorEuler.y),
                    MathUtils.radToDeg(_editorEuler.z),
                ];
            }
            return {
                position,
                rotation,
                joints: chainPose
                    ?.map((value) => MathUtils.radToDeg(value)) ?? null,
            };
        }
        if (
            this._resolveKeyframePose(
                keyframe,
                this._createResolverContext(),
                _worldPosition,
                _worldQuaternion,
            )
        ) {
            const pose = this._resolvedPoseById.get(keyframe.id) ?? null;
            if (!pose) {
                return null;
            }
            return {
                ...pose,
                joints: this._sanitizeChainPose(keyframe.runtimeJoints)
                    ?.map((value) => MathUtils.radToDeg(value)) ?? null,
            };
        }
        const pose = this._resolvedPoseById.get(keyframe.id) ?? null;
        return pose
            ? {
                ...pose,
                joints: this._sanitizeChainPose(keyframe.runtimeJoints)
                    ?.map((value) => MathUtils.radToDeg(value)) ?? null,
            }
            : null;
    }

    _sampleChainPoseTransform(chainPose, outPosition, outQuaternion) {
        const resolved = this._sanitizeChainPose(chainPose);
        return Boolean(
            resolved
            && this.sampleChainPose
            && this.sampleChainPose(
                resolved,
                outPosition,
                outQuaternion,
            ) === true
        );
    }

    _createResolverContext() {
        return {
            cubeItem: this.context?.cubeItem ?? null,
            sequenceContext: this.context?.sequenceContext ?? {},
            player: this.sequencePlayer,
        };
    }

    _commitChange() {
        this.onSequenceChange(this.buildSequence(), this.getKeyframes());
        this._refreshMarkers();
        this._drawGraph();
        this.requestRender();
    }

    _getNewKeyframeLabel() {
        const typedLabel = this._form.label?.value.trim();
        if (this._formDirtyLabel && typedLabel) {
            return typedLabel;
        }
        return `Keyframe ${this.keyframes.length + 1}`;
    }

    _syncFormFromSelection() {
        const keyframe = this.getSelectedKeyframe();
        if (!keyframe || !this._panel) {
            this._setSelectionText('No keyframe');
            return;
        }
        this._setSelectionText(
            `${this.selectedIndex + 1}. ${keyframe.label}`
            + (keyframe.kind === 'resolver' ? ' [dynamic]' : ''),
        );
        this._form.label.value = keyframe.label;
        this._form.durationMs.value = String(keyframe.durationMs);
        this._form.holdMs.value = String(keyframe.holdMs);
        this._form.gripDurationMs.value = String(keyframe.gripDurationMs);
        this._form.gripAction.value = keyframe.gripAction;
        this._formDirtyLabel = false;
        this._formDirtyHold = false;
        this._formDirtyGripAction = false;

        const pose = this._getKeyframeChannelPose(keyframe);
        if (pose) {
            this._writeTransformInputs(pose.position, pose.rotation);
            this._writeJointInputs(pose.joints);
        }
    }

    _setSelectionText(text) {
        if (this._form.selection) {
            this._form.selection.textContent = text;
        }
    }

    _readNumberInput(input, fallback = 0) {
        const value = Number(input?.value);
        return Number.isFinite(value) ? value : fallback;
    }

    _readTransformInputs() {
        return {
            position: [
                this._readNumberInput(this._form.positionX),
                this._readNumberInput(this._form.positionY),
                this._readNumberInput(this._form.positionZ),
            ],
            rotation: [
                this._readNumberInput(this._form.rotationX),
                this._readNumberInput(this._form.rotationY),
                this._readNumberInput(this._form.rotationZ),
            ],
        };
    }

    _writeTransformInputs(position, rotation) {
        if (!this._panel) {
            return;
        }
        this._form.positionX.value = position[0].toFixed(3);
        this._form.positionY.value = position[1].toFixed(3);
        this._form.positionZ.value = position[2].toFixed(3);
        this._form.rotationX.value = rotation[0].toFixed(1);
        this._form.rotationY.value = rotation[1].toFixed(1);
        this._form.rotationZ.value = rotation[2].toFixed(1);
    }

    _writeJointInputs(joints) {
        if (!this._panel) {
            return;
        }
        if (!joints) {
            for (const channel of JOINT_CHANNELS) {
                this._form[channel.key].value = '';
            }
            return;
        }
        JOINT_CHANNELS.forEach((channel, index) => {
            const value = joints[index];
            if (value !== undefined) {
                this._form[channel.key].value = value.toFixed(1);
            }
        });
    }

    _applyFormTransformToTarget() {
        if (!this.targetObject) {
            return;
        }
        const { position, rotation } = this._readTransformInputs();
        _worldPosition.fromArray(position);
        _editorEuler.set(
            MathUtils.degToRad(rotation[0]),
            MathUtils.degToRad(rotation[1]),
            MathUtils.degToRad(rotation[2]),
            'XYZ',
        );
        _worldQuaternion.setFromEuler(_editorEuler);
        this._setTargetWorldTransform(_worldPosition, _worldQuaternion);
        this.sequencePlayer?.queueSolveFromTarget?.();
        this.requestRender();
    }

    _syncFormFromTarget() {
        if (!this.targetObject || !this._panel) {
            return;
        }
        this._getTargetWorldTransform(_worldPosition, _worldQuaternion);
        _editorEuler.setFromQuaternion(_worldQuaternion, 'XYZ');
        this._writeTransformInputs(
            _worldPosition.toArray(),
            [
                MathUtils.radToDeg(_editorEuler.x),
                MathUtils.radToDeg(_editorEuler.y),
                MathUtils.radToDeg(_editorEuler.z),
            ],
        );
        const chainPose = this._sanitizeChainPose(this.getCurrentChainPose());
        if (chainPose) {
            this._writeJointInputs(
                chainPose.map((value) => MathUtils.radToDeg(value)),
            );
        }
    }

    _getTargetWorldTransform(outPosition, outQuaternion) {
        this.targetObject.updateWorldMatrix(true, false);
        this.targetObject.getWorldPosition(outPosition);
        this.targetObject.getWorldQuaternion(outQuaternion);
    }

    _setTargetWorldTransform(position, quaternion) {
        if (!this.targetObject) {
            return;
        }
        if (this.targetObject.parent) {
            this.targetObject.parent.updateWorldMatrix(true, false);
            this.targetObject.position.copy(position);
            this.targetObject.parent.worldToLocal(this.targetObject.position);
            this.targetObject.parent.getWorldQuaternion(_parentWorldQuaternion);
            this.targetObject.quaternion
                .copy(_parentWorldQuaternion)
                .invert()
                .multiply(quaternion);
        } else {
            this.targetObject.position.copy(position);
            this.targetObject.quaternion.copy(quaternion);
        }
        this.targetObject.updateMatrixWorld(true);
    }

    _canRecordCurrentPose({ reportStatus = true } = {}) {
        const hasCurrentPose = this._getCurrentWorldPose(
            _currentPosition,
            _currentQuaternion,
        );
        if (!hasCurrentPose) {
            return true;
        }

        this._getTargetWorldTransform(_worldPosition, _worldQuaternion);
        const positionError = _currentPosition.distanceTo(_worldPosition);
        const rotationError = _currentQuaternion.angleTo(_worldQuaternion);
        const constrainOrientation = this.isOrientationConstrained();
        const orientationSettled = !constrainOrientation
            || rotationError <= this.recordRotationTolerance;
        if (
            positionError <= this.recordPositionTolerance
            && orientationSettled
        ) {
            return true;
        }
        if (reportStatus) {
            const rotationStatus = constrainOrientation
                ? `, ${MathUtils.radToDeg(rotationError).toFixed(1)} deg`
                : '';
            this.onStatus(`IK target not settled: ${positionError.toFixed(3)} m${rotationStatus}`);
        }
        return false;
    }

    _getCurrentWorldPose(outPosition, outQuaternion) {
        if (
            this.getCurrentPose
            && this.getCurrentPose(outPosition, outQuaternion) === true
        ) {
            return true;
        }
        const actuator = this.sequencePlayer?.chain?.getActuator?.() ?? null;
        if (!this.getCurrentPose && actuator) {
            actuator.getGripWorldPosition(outPosition);
            actuator.getGripWorldQuaternion(outQuaternion);
            return true;
        }
        return false;
    }

    _createSceneControls() {
        if (!this.scene || !this.targetObject) {
            return;
        }
        this._targetMarker = new Mesh(
            new SphereGeometry(0.012, 16, 12),
            new MeshBasicMaterial({
                color: 0xff4f64,
                depthTest: false,
                transparent: true,
                opacity: 0.9,
            }),
        );
        this._targetMarker.name = 'sequenceGeneratorTargetMarker';
        this._targetMarker.renderOrder = 1001;
        this.targetObject.add(this._targetMarker);

        this._markerGroup = new Group();
        this._markerGroup.name = 'sequenceGeneratorKeyframes';
        this.scene.add(this._markerGroup);

        if (!this.camera || !this.domElement) {
            return;
        }
        this._transformControls = new TransformControls(
            this.camera,
            this.domElement,
        );
        this._transformControls.setMode('translate');
        this._transformControls.setSpace('world');
        this._transformControls.setSize(0.65);
        this._transformControls.attach(this.targetObject);
        this.scene.add(this._transformControls);
        this._transformControls.addEventListener(
            'dragging-changed',
            (event) => {
                this._isDraggingTarget = event.value;
                if (this.orbitControls) {
                    this.orbitControls.enabled = !this._isDraggingTarget;
                }
                if (!this._isDraggingTarget) {
                    this.sequencePlayer?.queueSolveFromTarget?.();
                    this._syncFormFromTarget();
                }
                this.requestRender();
            },
        );
        this._transformControls.addEventListener('objectChange', () => {
            this._syncFormFromTarget();
            this.requestRender();
        });
    }

    _createBottomEditor() {
        if (typeof document === 'undefined') {
            return;
        }
        const panel = createElement('section', 'sequence-graph-editor');
        panel.setAttribute('aria-label', 'Sequence graph editor');
        const toolbar = createElement('div', 'sequence-graph-editor__toolbar');
        const selection = createElement(
            'div',
            'sequence-graph-editor__selection',
            'No keyframe',
        );
        this._form.selection = selection;
        toolbar.append(selection);

        this._appendButton(
            toolbar,
            'Add',
            () => this.addRecordedKeyframeAfterSolve(),
        );
        this._appendButton(
            toolbar,
            'Update',
            () => this.updateSelectedKeyframe(),
        );
        this._appendButton(
            toolbar,
            'Delete',
            () => this.deleteSelectedKeyframe(),
        );

        const modeGroup = createElement(
            'div',
            'sequence-graph-editor__mode-group',
        );
        this._modeButtons.position = this._appendButton(
            modeGroup,
            'Position',
            () => this._setTransformMode('position'),
        );
        this._modeButtons.rotation = this._appendButton(
            modeGroup,
            'Rotation',
            () => this._setTransformMode('rotation'),
        );
        toolbar.append(modeGroup);

        this._form.label = this._appendLabeledInput(
            toolbar,
            'Label',
            'text',
            'Keyframe',
            'sequence-graph-editor__label-input',
        );
        this._form.label.addEventListener('input', () => {
            this._formDirtyLabel = true;
        });
        this._form.durationMs = this._appendLabeledInput(
            toolbar,
            'Move ms',
            'number',
            String(this.defaultDurationMs),
        );
        this._form.holdMs = this._appendLabeledInput(
            toolbar,
            'Hold ms',
            'number',
            '0',
        );
        this._form.holdMs.addEventListener('input', () => {
            this._formDirtyHold = true;
        });
        this._form.gripDurationMs = this._appendLabeledInput(
            toolbar,
            'Grip ms',
            'number',
            String(this.defaultGripDurationMs),
        );
        this._form.gripAction = this._appendGripSelect(toolbar);
        this._form.gripAction.addEventListener('change', () => {
            this._formDirtyGripAction = true;
        });

        const transformBar = createElement(
            'div',
            'sequence-graph-editor__transform',
        );
        const endEffectorChannels = createElement(
            'div',
            'sequence-graph-editor__channel-set',
        );
        for (const channel of CHANNELS) {
            const input = this._appendLabeledInput(
                endEffectorChannels,
                channel.label,
                'number',
                '0',
            );
            input.step = channel.group === 'position' ? '0.001' : '0.1';
            input.addEventListener(
                'input',
                () => this._applyFormTransformToTarget(),
            );
            this._form[channel.key] = input;
        }
        transformBar.append(endEffectorChannels);

        const jointChannels = createElement(
            'div',
            'sequence-graph-editor__channel-set is-joints',
        );
        for (const channel of JOINT_CHANNELS) {
            const input = this._appendLabeledInput(
                jointChannels,
                channel.label,
                'number',
                '0',
            );
            input.step = '0.1';
            input.readOnly = true;
            this._form[channel.key] = input;
        }
        transformBar.append(jointChannels);

        const graph = createElement('div', 'sequence-graph-editor__graph');
        const canvas = document.createElement('canvas');
        canvas.className = 'sequence-graph-editor__canvas';
        canvas.setAttribute(
            'aria-label',
            'Six joint angle keyframe curves',
        );
        graph.append(canvas);

        const transport = createElement(
            'div',
            'sequence-graph-editor__transport',
        );
        this._appendTransportButton(
            transport,
            'Previous keyframe',
            'previous',
            () => this.selectPreviousKeyframe(),
        );
        this._transportButton = this._appendTransportButton(
            transport,
            'Play',
            'playback',
            () => this.togglePlayback(),
        );
        this._appendTransportButton(
            transport,
            'Next keyframe',
            'next',
            () => this.selectNextKeyframe(),
        );

        panel.append(toolbar, transformBar, graph, transport);
        document.body.append(panel);

        this._panel = panel;
        this._canvas = canvas;
        this._canvasContext = canvas.getContext('2d');
        this._setTransformMode('position');
        this.setPlaybackActive(false);
        this._installPanelStyles();
        this._installGraphEvents();

        if (typeof ResizeObserver !== 'undefined') {
            this._resizeObserver = new ResizeObserver(() => this._drawGraph());
            this._resizeObserver.observe(graph);
        }
    }

    _appendButton(parent, label, handler) {
        const button = setButtonType(
            createElement('button', 'sequence-graph-editor__button', label),
        );
        button.addEventListener('click', handler);
        parent.append(button);
        return button;
    }

    _appendTransportButton(parent, label, icon, handler) {
        const button = setButtonType(
            createElement(
                'button',
                `sequence-graph-editor__transport-button is-${icon}`,
            ),
        );
        button.setAttribute('aria-label', label);
        button.title = label;
        button.append(
            createElement('span', 'sequence-graph-editor__transport-icon'),
        );
        button.addEventListener('click', handler);
        parent.append(button);
        return button;
    }

    _appendLabeledInput(parent, label, type, value, extraClass = '') {
        const wrapper = createElement(
            'label',
            `sequence-graph-editor__field ${extraClass}`.trim(),
        );
        const text = createElement(
            'span',
            'sequence-graph-editor__field-label',
            label,
        );
        const input = document.createElement('input');
        input.className = 'sequence-graph-editor__input';
        input.type = type;
        input.value = value;
        wrapper.append(text, input);
        parent.append(wrapper);
        return input;
    }

    _appendGripSelect(parent) {
        const wrapper = createElement(
            'label',
            'sequence-graph-editor__field',
        );
        wrapper.append(
            createElement(
                'span',
                'sequence-graph-editor__field-label',
                'Gripper',
            ),
        );
        const select = document.createElement('select');
        select.className = 'sequence-graph-editor__select';
        const options = [
            ['Hold', HOLD_ACTION],
            ['Open', OPEN_ACTION],
            ['Close', CLOSE_ACTION],
        ];
        for (const [label, value] of options) {
            const option = document.createElement('option');
            option.textContent = label;
            option.value = value;
            select.append(option);
        }
        wrapper.append(select);
        parent.append(wrapper);
        return select;
    }

    _setTransformMode(mode) {
        const rotation = mode === 'rotation';
        this._transformControls?.setMode(rotation ? 'rotate' : 'translate');
        this._modeButtons.position?.classList.toggle('is-active', !rotation);
        this._modeButtons.rotation?.classList.toggle('is-active', rotation);
        this.requestRender();
    }

    _installPanelStyles() {
        if (document.getElementById('sequence-graph-editor-styles')) {
            return;
        }
        const style = document.createElement('style');
        style.id = 'sequence-graph-editor-styles';
        style.textContent = `
            .sequence-graph-editor {
                position: fixed;
                z-index: 20;
                left: 0;
                right: 0;
                bottom: 0;
                height: 320px;
                display: grid;
                grid-template-rows: 42px 44px minmax(0, 1fr) 40px;
                color: #d9dde3;
                background: #171b1f;
                border-top: 1px solid #3d454d;
                font: 12px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace;
                letter-spacing: 0;
            }
            .sequence-graph-editor[hidden] {
                display: none;
            }
            .sequence-graph-editor.is-recording {
                cursor: wait;
            }
            .sequence-graph-editor.is-recording
                .sequence-graph-editor__canvas {
                pointer-events: none;
            }
            .sequence-graph-editor__toolbar,
            .sequence-graph-editor__transform {
                display: flex;
                align-items: center;
                gap: 5px;
                min-width: 0;
                padding: 5px 8px;
                overflow-x: auto;
                overflow-y: hidden;
                border-bottom: 1px solid #30373e;
                background: #22272c;
            }
            .sequence-graph-editor__transform {
                background: #1c2126;
            }
            .sequence-graph-editor__channel-set {
                display: flex;
                align-items: center;
                gap: 5px;
                min-width: max-content;
            }
            .sequence-graph-editor__channel-set.is-joints {
                padding-left: 8px;
                border-left: 1px solid #49515a;
            }
            .sequence-graph-editor__selection {
                width: 170px;
                min-width: 170px;
                overflow: hidden;
                color: #ffffff;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            .sequence-graph-editor__button {
                min-width: 54px;
                height: 27px;
                padding: 0 8px;
                color: #dce2e8;
                background: #343b42;
                border: 1px solid #4a535c;
                border-radius: 3px;
                font: inherit;
                cursor: pointer;
            }
            .sequence-graph-editor__button:hover,
            .sequence-graph-editor__button.is-active {
                color: #ffffff;
                background: #526475;
                border-color: #7890a4;
            }
            .sequence-graph-editor__button:disabled,
            .sequence-graph-editor__input:disabled,
            .sequence-graph-editor__select:disabled,
            .sequence-graph-editor__transport-button:disabled {
                cursor: wait;
                opacity: 0.55;
            }
            .sequence-graph-editor__mode-group {
                display: flex;
                gap: 2px;
                padding-left: 4px;
                border-left: 1px solid #49515a;
            }
            .sequence-graph-editor__field {
                display: flex;
                align-items: center;
                gap: 4px;
                min-width: max-content;
                color: #aeb6bf;
            }
            .sequence-graph-editor__field-label {
                white-space: nowrap;
            }
            .sequence-graph-editor__input,
            .sequence-graph-editor__select {
                box-sizing: border-box;
                width: 72px;
                height: 26px;
                padding: 2px 5px;
                color: #f3f5f7;
                background: #12161a;
                border: 1px solid #424b54;
                border-radius: 2px;
                font: inherit;
            }
            .sequence-graph-editor__label-input .sequence-graph-editor__input {
                width: 120px;
            }
            .sequence-graph-editor__input[readonly] {
                color: #9fd4f1;
                background: #182027;
            }
            .sequence-graph-editor__transform .sequence-graph-editor__field {
                padding-right: 6px;
                border-right: 1px solid #353d44;
            }
            .sequence-graph-editor__graph {
                position: relative;
                min-width: 0;
                min-height: 0;
                overflow: hidden;
            }
            .sequence-graph-editor__transport {
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 8px;
                border-top: 1px solid #30373e;
                background: #1c2126;
            }
            .sequence-graph-editor__transport-button {
                position: relative;
                width: 32px;
                height: 28px;
                padding: 0;
                color: #e7edf2;
                background: #30373e;
                border: 1px solid #4a535c;
                border-radius: 4px;
                cursor: pointer;
            }
            .sequence-graph-editor__transport-button:hover {
                color: #ffffff;
                background: #526475;
                border-color: #7890a4;
            }
            .sequence-graph-editor__transport-button.is-playback {
                width: 38px;
                background: #3c5365;
                border-color: #6f8799;
            }
            .sequence-graph-editor__transport-icon,
            .sequence-graph-editor__transport-icon::before,
            .sequence-graph-editor__transport-icon::after {
                position: absolute;
                display: block;
                content: '';
            }
            .sequence-graph-editor__transport-icon {
                inset: 0;
            }
            .sequence-graph-editor__transport-button.is-previous
                .sequence-graph-editor__transport-icon::before,
            .sequence-graph-editor__transport-button.is-next
                .sequence-graph-editor__transport-icon::before {
                top: 8px;
                border-top: 6px solid transparent;
                border-bottom: 6px solid transparent;
            }
            .sequence-graph-editor__transport-button.is-previous
                .sequence-graph-editor__transport-icon::before {
                left: 10px;
                border-right: 9px solid currentColor;
            }
            .sequence-graph-editor__transport-button.is-next
                .sequence-graph-editor__transport-icon::before {
                right: 10px;
                border-left: 9px solid currentColor;
            }
            .sequence-graph-editor__transport-button.is-previous
                .sequence-graph-editor__transport-icon::after,
            .sequence-graph-editor__transport-button.is-next
                .sequence-graph-editor__transport-icon::after {
                top: 8px;
                width: 2px;
                height: 12px;
                background: currentColor;
            }
            .sequence-graph-editor__transport-button.is-previous
                .sequence-graph-editor__transport-icon::after {
                left: 8px;
            }
            .sequence-graph-editor__transport-button.is-next
                .sequence-graph-editor__transport-icon::after {
                right: 8px;
            }
            .sequence-graph-editor__transport-button.is-playback
                .sequence-graph-editor__transport-icon::before {
                top: 7px;
                left: 15px;
                border-top: 7px solid transparent;
                border-bottom: 7px solid transparent;
                border-left: 11px solid currentColor;
            }
            .sequence-graph-editor__transport-button.is-playback.is-playing
                .sequence-graph-editor__transport-icon::before,
            .sequence-graph-editor__transport-button.is-playback.is-playing
                .sequence-graph-editor__transport-icon::after {
                top: 7px;
                width: 4px;
                height: 14px;
                border: 0;
                background: currentColor;
            }
            .sequence-graph-editor__transport-button.is-playback.is-playing
                .sequence-graph-editor__transport-icon::before {
                left: 13px;
            }
            .sequence-graph-editor__transport-button.is-playback.is-playing
                .sequence-graph-editor__transport-icon::after {
                right: 13px;
            }
            .sequence-graph-editor__canvas {
                display: block;
                width: 100%;
                height: 100%;
                cursor: crosshair;
                touch-action: none;
            }
        `;
        document.head.append(style);
    }

    _installGraphEvents() {
        if (!this._canvas) {
            return;
        }
        this._canvas.addEventListener('pointerdown', (event) => {
            const point = this._findGraphPoint(event);
            if (!point) {
                return;
            }
            this.selectKeyframe(point.keyframeIndex, { preview: true });
            if (point.kind !== 'recorded') {
                return;
            }
            const timeline = this._getTimeline();
            this._graphDrag = {
                pointerId: event.pointerId,
                keyframeIndex: point.keyframeIndex,
                channelIndex: point.channelIndex,
                totalDurationMs: Math.max(1000, timeline.totalDurationMs),
                previousTimeMs: point.keyframeIndex > 0
                    ? timeline.times[point.keyframeIndex - 1]
                    : 0,
            };
            this._canvas.setPointerCapture(event.pointerId);
            event.preventDefault();
        });
        this._canvas.addEventListener('pointermove', (event) => {
            if (
                !this._graphDrag
                || event.pointerId !== this._graphDrag.pointerId
            ) {
                return;
            }
            this._dragGraphPoint(event);
        });
        const finishDrag = (event) => {
            if (
                !this._graphDrag
                || event.pointerId !== this._graphDrag.pointerId
            ) {
                return;
            }
            this._canvas.releasePointerCapture(event.pointerId);
            this._graphDrag = null;
            this._syncFormFromSelection();
            this._commitChange();
        };
        this._canvas.addEventListener('pointerup', finishDrag);
        this._canvas.addEventListener('pointercancel', finishDrag);
    }

    _findGraphPoint(event) {
        const rect = this._canvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        let best = null;
        let bestDistance = 11;
        for (const point of this._graphPoints) {
            const distance = Math.hypot(point.x - x, point.y - y);
            if (distance < bestDistance) {
                best = point;
                bestDistance = distance;
            }
        }
        return best;
    }

    _dragGraphPoint(event) {
        const drag = this._graphDrag;
        const keyframe = this.keyframes[drag.keyframeIndex];
        const channels = JOINT_CHANNELS;
        const channel = channels[drag.channelIndex];
        if (!keyframe || keyframe.kind !== 'recorded' || !channel) {
            return;
        }
        const rect = this._canvas.getBoundingClientRect();
        const x = clamp(
            event.clientX - rect.left,
            GRAPH_SIDEBAR_WIDTH,
            rect.width - 10,
        );
        const y = event.clientY - rect.top;
        const laneHeight = (
            rect.height - GRAPH_TIMELINE_HEIGHT
        ) / channels.length;
        const laneTop = GRAPH_TIMELINE_HEIGHT
            + drag.channelIndex * laneHeight;
        const normalized = 1 - clamp(
            (y - laneTop - 5) / Math.max(1, laneHeight - 10),
            0,
            1,
        );
        const range = this._graphChannelRanges[drag.channelIndex] ?? channel;
        const value = range.min
            + normalized * (range.max - range.min);
        keyframe.chainPose[channel.index] = MathUtils.degToRad(value);

        const timelineWidth = Math.max(
            1,
            rect.width - GRAPH_SIDEBAR_WIDTH - 10,
        );
        const desiredTimeMs = (
            (x - GRAPH_SIDEBAR_WIDTH) / timelineWidth
        ) * drag.totalDurationMs;
        keyframe.durationMs = Math.max(
            50,
            desiredTimeMs - drag.previousTimeMs,
        );
        this._applyRecordedKeyframeToTarget(keyframe);
        this._syncFormFromSelection();
        this._drawGraph();
        this.requestRender();
    }

    _applyRecordedKeyframeToTarget(keyframe) {
        const chainPose = this._sanitizeChainPose(keyframe.chainPose);
        if (chainPose) {
            this.setCurrentChainPose(chainPose);
            if (
                this.getCurrentPose
                && this.getCurrentPose(
                    _worldPosition,
                    _worldQuaternion,
                ) === true
            ) {
                this._setTargetWorldTransform(
                    _worldPosition,
                    _worldQuaternion,
                );
                _editorEuler.setFromQuaternion(_worldQuaternion, 'XYZ');
                keyframe.position = _worldPosition.toArray();
                keyframe.rotation = [
                    MathUtils.radToDeg(_editorEuler.x),
                    MathUtils.radToDeg(_editorEuler.y),
                    MathUtils.radToDeg(_editorEuler.z),
                ];
            }
            return;
        }
        _worldPosition.fromArray(keyframe.position);
        _editorEuler.set(
            MathUtils.degToRad(keyframe.rotation[0]),
            MathUtils.degToRad(keyframe.rotation[1]),
            MathUtils.degToRad(keyframe.rotation[2]),
            'XYZ',
        );
        _worldQuaternion.setFromEuler(_editorEuler);
        this._setTargetWorldTransform(_worldPosition, _worldQuaternion);
        this.sequencePlayer?.queueSolveFromTarget?.();
    }

    _getTimeline() {
        const times = [];
        let totalDurationMs = 0;
        for (const keyframe of this.keyframes) {
            totalDurationMs += sanitizeDuration(
                keyframe.durationMs,
                this.defaultDurationMs,
            );
            times.push(totalDurationMs);
        }
        return { times, totalDurationMs };
    }

    _collectGraphFrames() {
        const timeline = this._getTimeline();
        const activeGroup = JOINT_CHANNELS[0].group;
        const frames = [];
        let previousRotation = null;
        this.keyframes.forEach((keyframe, index) => {
            const pose = this._getKeyframeChannelPose(keyframe);
            if (!pose?.[activeGroup]) {
                return;
            }
            const rotation = pose.rotation?.slice() ?? null;
            if (rotation && previousRotation) {
                for (let axis = 0; axis < 3; axis++) {
                    rotation[axis] = unwrapAngle(
                        rotation[axis],
                        previousRotation[axis],
                    );
                }
            }
            previousRotation = rotation ?? previousRotation;
            frames.push({
                keyframe,
                keyframeIndex: index,
                timeMs: timeline.times[index],
                position: pose.position?.slice() ?? null,
                rotation,
                joints: pose.joints?.slice() ?? null,
            });
        });
        return {
            frames,
            totalDurationMs: Math.max(1000, timeline.totalDurationMs),
        };
    }

    _drawGraph() {
        if (!this._canvas || !this._canvasContext || !this.params.editorOpen) {
            return;
        }
        const rect = this._canvas.getBoundingClientRect();
        if (rect.width < 1 || rect.height < 1) {
            return;
        }
        const pixelRatio = Math.min(2, window.devicePixelRatio || 1);
        const width = Math.round(rect.width);
        const height = Math.round(rect.height);
        const targetWidth = Math.round(width * pixelRatio);
        const targetHeight = Math.round(height * pixelRatio);
        if (
            this._canvas.width !== targetWidth
            || this._canvas.height !== targetHeight
        ) {
            this._canvas.width = targetWidth;
            this._canvas.height = targetHeight;
        }
        const context = this._canvasContext;
        context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
        context.clearRect(0, 0, width, height);
        context.fillStyle = '#15191d';
        context.fillRect(0, 0, width, height);

        const graphLeft = GRAPH_SIDEBAR_WIDTH;
        const graphRight = width - 10;
        const graphWidth = Math.max(1, graphRight - graphLeft);
        const channels = JOINT_CHANNELS;
        const laneHeight = (
            height - GRAPH_TIMELINE_HEIGHT
        ) / channels.length;
        this._drawGraphGrid(
            context,
            width,
            height,
            graphLeft,
            graphRight,
            laneHeight,
            channels,
        );

        const { frames, totalDurationMs } = this._collectGraphFrames();
        this._graphPoints = [];
        this._graphChannelRanges = channels.map(
            (channel) => this._getGraphChannelRange(channel, frames),
        );
        channels.forEach((channel, channelIndex) => {
            const laneTop = GRAPH_TIMELINE_HEIGHT + channelIndex * laneHeight;
            const laneBottom = laneTop + laneHeight;
            const range = this._graphChannelRanges[channelIndex];
            const points = frames.map((frame) => {
                const value = frame[channel.group][channel.index];
                const normalized = (
                    value - range.min
                ) / (range.max - range.min);
                return {
                    x: graphLeft
                        + (frame.timeMs / totalDurationMs) * graphWidth,
                    y: laneBottom - 5
                        - clamp(normalized, 0, 1) * (laneHeight - 10),
                    value,
                    frame,
                };
            });
            this._drawChannelCurve(context, channel, points);
            for (const point of points) {
                const selected = point.frame.keyframeIndex === this.selectedIndex;
                context.beginPath();
                context.arc(
                    point.x,
                    point.y,
                    selected ? GRAPH_POINT_RADIUS + 1.5 : GRAPH_POINT_RADIUS,
                    0,
                    Math.PI * 2,
                );
                context.fillStyle = point.frame.keyframe.kind === 'resolver'
                    ? '#15191d'
                    : channel.color;
                context.fill();
                context.lineWidth = selected ? 2 : 1;
                context.strokeStyle = selected ? '#ffffff' : channel.color;
                context.stroke();
                this._graphPoints.push({
                    x: point.x,
                    y: point.y,
                    channelIndex,
                    keyframeIndex: point.frame.keyframeIndex,
                    kind: point.frame.keyframe.kind,
                });
            }
        });

        if (this.selectedIndex >= 0) {
            const selectedFrame = frames.find(
                (frame) => frame.keyframeIndex === this.selectedIndex,
            );
            if (selectedFrame) {
                const x = graphLeft
                    + (selectedFrame.timeMs / totalDurationMs) * graphWidth;
                context.beginPath();
                context.moveTo(x, GRAPH_TIMELINE_HEIGHT);
                context.lineTo(x, height);
                context.strokeStyle = 'rgba(255, 255, 255, 0.45)';
                context.lineWidth = 1;
                context.stroke();
            }
        }
    }

    _drawGraphGrid(
        context,
        width,
        height,
        graphLeft,
        graphRight,
        laneHeight,
        channels,
    ) {
        context.fillStyle = '#20262b';
        context.fillRect(0, 0, graphLeft, height);
        context.fillStyle = '#111519';
        context.fillRect(graphLeft, 0, width - graphLeft, GRAPH_TIMELINE_HEIGHT);
        context.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
        context.textBaseline = 'middle';

        for (let tick = 0; tick <= 10; tick++) {
            const x = graphLeft
                + (tick / 10) * (graphRight - graphLeft);
            context.beginPath();
            context.moveTo(x, GRAPH_TIMELINE_HEIGHT);
            context.lineTo(x, height);
            context.strokeStyle = tick % 5 === 0 ? '#394149' : '#282f35';
            context.lineWidth = 1;
            context.stroke();
            context.fillStyle = '#8e98a2';
            context.fillText(`${tick * 10}%`, x + 3, 12);
        }

        channels.forEach((channel, index) => {
            const laneTop = GRAPH_TIMELINE_HEIGHT + index * laneHeight;
            const laneMiddle = laneTop + laneHeight * 0.5;
            context.beginPath();
            context.moveTo(0, laneTop);
            context.lineTo(width, laneTop);
            context.strokeStyle = '#30373e';
            context.stroke();
            context.fillStyle = channel.color;
            context.fillRect(10, laneMiddle - 4, 8, 8);
            context.fillStyle = '#d6dbe0';
            context.fillText(channel.label, 25, laneMiddle);

            const keyframe = this.getSelectedKeyframe();
            const pose = keyframe
                ? this._getKeyframeChannelPose(keyframe)
                : null;
            if (pose?.[channel.group]) {
                const value = pose[channel.group][channel.index];
                context.fillStyle = '#8e98a2';
                context.textAlign = 'right';
                context.fillText(
                    `${value.toFixed(channel.group === 'position' ? 3 : 1)} `
                    + channel.unit,
                    graphLeft - 8,
                    laneMiddle,
                );
                context.textAlign = 'left';
            }
        });
    }

    _getGraphChannelRange(channel, frames) {
        const values = frames.map(
            (frame) => frame[channel.group][channel.index],
        );
        if (values.length === 0) {
            return {
                min: channel.min,
                max: channel.max,
            };
        }

        let min = Math.min(...values);
        let max = Math.max(...values);
        const minimumSpan = channel.group === 'position' ? 0.1 : 30;
        const dataSpan = max - min;
        if (dataSpan < minimumSpan) {
            const center = (min + max) * 0.5;
            min = center - minimumSpan * 0.5;
            max = center + minimumSpan * 0.5;
        } else {
            const padding = dataSpan * 0.12;
            min -= padding;
            max += padding;
        }
        return { min, max };
    }

    _drawChannelCurve(context, channel, points) {
        if (points.length === 0) {
            return;
        }
        context.beginPath();
        context.moveTo(points[0].x, points[0].y);
        for (let index = 1; index < points.length; index++) {
            const previous = points[index - 1];
            const current = points[index];
            const samples = Math.max(
                8,
                Math.ceil(Math.abs(current.x - previous.x) / 12),
            );
            for (let sample = 1; sample <= samples; sample++) {
                const t = sample / samples;
                const eased = smoothstep(t);
                context.lineTo(
                    previous.x + (current.x - previous.x) * t,
                    previous.y + (current.y - previous.y) * eased,
                );
            }
        }
        context.strokeStyle = channel.color;
        context.lineWidth = 1.8;
        context.stroke();
    }

    _disposeMarkerGroup() {
        if (!this._markerGroup) {
            return;
        }
        for (const child of this._markerGroup.children) {
            child.geometry?.dispose();
            child.material?.dispose();
        }
        this._markerGroup.clear();
    }

    _sampleTrajectoryPoints(frames) {
        if (frames.length === 0) {
            return [];
        }
        const points = [
            new Vector3().fromArray(frames[0].pose.position),
        ];
        for (let frameIndex = 1; frameIndex < frames.length; frameIndex++) {
            const previous = frames[frameIndex - 1];
            const current = frames[frameIndex];
            const fromChainPose = previous.keyframe.kind === 'recorded'
                ? this._sanitizeChainPose(previous.keyframe.chainPose)
                : null;
            const toChainPose = current.keyframe.kind === 'recorded'
                ? this._sanitizeChainPose(current.keyframe.chainPose)
                : null;
            if (fromChainPose && toChainPose && this.sampleChainPose) {
                let sampledSegment = false;
                for (
                    let sampleIndex = 1;
                    sampleIndex <= TRAJECTORY_SAMPLES_PER_SEGMENT;
                    sampleIndex++
                ) {
                    const progress = smoothstep(
                        sampleIndex / TRAJECTORY_SAMPLES_PER_SEGMENT,
                    );
                    _sampledChainPose.length = fromChainPose.length;
                    for (
                        let jointIndex = 0;
                        jointIndex < fromChainPose.length;
                        jointIndex++
                    ) {
                        _sampledChainPose[jointIndex] = (
                            fromChainPose[jointIndex]
                            + (
                                toChainPose[jointIndex]
                                - fromChainPose[jointIndex]
                            ) * progress
                        );
                    }
                    if (this._sampleChainPoseTransform(
                        _sampledChainPose,
                        _sampledPosition,
                        _sampledQuaternion,
                    )) {
                        points.push(_sampledPosition.clone());
                        sampledSegment = true;
                    }
                }
                if (sampledSegment) {
                    continue;
                }
            }
            points.push(new Vector3().fromArray(current.pose.position));
        }
        return points;
    }

    _refreshMarkers() {
        if (!this._markerGroup) {
            return;
        }
        this._disposeMarkerGroup();
        const trajectoryFrames = [];
        this.keyframes.forEach((keyframe, index) => {
            const pose = this._getKeyframeChannelPose(keyframe);
            if (!pose) {
                return;
            }
            const point = new Vector3().fromArray(pose.position);
            trajectoryFrames.push({ keyframe, pose });
            const marker = new Mesh(
                new SphereGeometry(0.011, 14, 10),
                new MeshBasicMaterial({
                    color: index === this.selectedIndex
                        ? 0xffd166
                        : 0x62d4a8,
                    depthTest: false,
                }),
            );
            marker.position.copy(point);
            marker.renderOrder = 1000;
            marker.name = `sequenceKeyframeMarker${index + 1}`;
            marker.userData.sequenceKeyframeMarker = true;
            marker.userData.sequenceKeyframeIndex = index;
            this._markerGroup.add(marker);
        });
        const sampledTrajectoryPoints = this._sampleTrajectoryPoints(
            trajectoryFrames,
        );
        const curveControlPoints = sampledTrajectoryPoints.filter(
            (point, index) => (
                index === 0
                || point.distanceTo(sampledTrajectoryPoints[index - 1]) > 1e-5
            ),
        );
        if (curveControlPoints.length >= 2) {
            const curve = new CurvePath();
            for (let index = 1; index < curveControlPoints.length; index++) {
                curve.add(
                    new LineCurve3(
                        curveControlPoints[index - 1],
                        curveControlPoints[index],
                    ),
                );
            }
            const trajectory = new Mesh(
                new TubeGeometry(
                    curve,
                    curveControlPoints.length - 1,
                    0.0025,
                    6,
                    false,
                ),
                new MeshBasicMaterial({
                    color: 0x63d8ff,
                    depthTest: false,
                    depthWrite: false,
                    transparent: true,
                    opacity: 0.82,
                }),
            );
            trajectory.name = 'sequenceKeyframeTrajectory';
            trajectory.renderOrder = 999;
            trajectory.userData.sequenceTrajectory = true;
            this._markerGroup.add(trajectory);
        }
        this._markerGroup.visible = this.params.trajectoryVisible;
    }

    _updateMarkerSelection() {
        if (!this._markerGroup) {
            return;
        }
        for (const child of this._markerGroup.children) {
            if (!child.userData.sequenceKeyframeMarker) {
                continue;
            }
            child.material.color.setHex(
                child.userData.sequenceKeyframeIndex === this.selectedIndex
                    ? 0xffd166
                    : 0x62d4a8,
            );
        }
    }
}

export {
    CHANNELS,
    CLOSE_ACTION,
    GENERATED_TARGET_KIND,
    HOLD_ACTION,
    JOINT_CHANNELS,
    OPEN_ACTION,
    SequenceGenerator,
    SequenceGenerator as default,
};
