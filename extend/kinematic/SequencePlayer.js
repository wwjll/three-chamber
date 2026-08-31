import { JointData } from '@dimforge/rapier3d-compat';
import { Euler, Quaternion, Vector3 } from 'three';
import ChainSolver from './ChainSolver.js';

const _tmpTargetPos = new Vector3();
const _tmpTargetQuat = new Quaternion();
const _tmpWorldPosA = new Vector3();
const _tmpWorldPosB = new Vector3();
const _tmpWorldQuatA = new Quaternion();
const _tmpWorldQuatB = new Quaternion();
const _tmpInvWorldQuat = new Quaternion();
const _tmpLocalAnchorA = new Vector3();
const _tmpLocalAnchorB = new Vector3();
const _tmpJointLocalRotB = new Quaternion();
const _tmpGraspWorldPos = new Vector3();
const _tmpPickPos = new Vector3();
const _tmpContainerPos = new Vector3();
const _tmpVerticalGraspQuat = new Quaternion();
const _tmpFromEuler = new Euler();
const _tmpToEuler = new Euler();
const _tmpCurrentEuler = new Euler();

function smoothstep(value) {
    const t = Math.min(1, Math.max(0, value));
    return t * t * (3 - 2 * t);
}

function unwrapRadians(value, reference) {
    let result = value;
    while (result - reference > Math.PI) {
        result -= Math.PI * 2;
    }
    while (result - reference < -Math.PI) {
        result += Math.PI * 2;
    }
    return result;
}

function copyBodyPose(body, outPos, outQuat) {
    const t = body.translation();
    const r = body.rotation();
    outPos.set(t.x, t.y, t.z);
    outQuat.set(r.x, r.y, r.z, r.w);
}

function worldToBodyLocalPoint(body, worldPoint, out) {
    copyBodyPose(body, _tmpWorldPosA, _tmpWorldQuatA);
    _tmpInvWorldQuat.copy(_tmpWorldQuatA).invert();
    return out.copy(worldPoint).sub(_tmpWorldPosA).applyQuaternion(_tmpInvWorldQuat);
}

function createSequenceResolver({
    chain,
    getPickParams,
    getContainerDropPoint,
}) {
    const chainRef = chain ?? null;
    const pickParamsGetter = getPickParams ?? (() => ({}));
    const containerDropPointGetter = getContainerDropPoint
        ?? ((out) => out.set(0, 0, 0));

    function computePickTargetFromCube(cubeItem, hover, outPos, outQuat) {
        if (!cubeItem?.mesh || !outPos || !outQuat) return false;
        cubeItem.mesh.getWorldPosition(_tmpPickPos);
        const pickParams = pickParamsGetter();
        const cubeSize = cubeItem.size ?? pickParams.cubeSize;
        const hoverOffset = hover ?? pickParams.graspHover;
        const half = Math.max(0.001, cubeSize) * 0.5;
        const actuator = chainRef?.getActuator?.() ?? null;

        if (actuator) {
            actuator.computeTopDownPickPose(_tmpPickPos, cubeSize, hoverOffset, outPos, outQuat);
            return true;
        }
        outPos.set(_tmpPickPos.x, _tmpPickPos.y + half + Math.max(0, hoverOffset), _tmpPickPos.z);
        outQuat.identity();
        return true;
    }

    function setPickTargetToContainer(hover, outPos, outQuat) {
        if (!outPos || !outQuat) return false;
        const pickParams = pickParamsGetter();
        const hoverOffset = hover ?? pickParams.graspHover;
        containerDropPointGetter(_tmpContainerPos);
        outPos.set(_tmpContainerPos.x, hoverOffset, _tmpContainerPos.z);

        const actuator = chainRef?.getActuator?.() ?? null;
        if (actuator) {
            actuator.getVerticalGripQuaternion(_tmpVerticalGraspQuat);
            outQuat.copy(_tmpVerticalGraspQuat);
        } else {
            outQuat.identity();
        }
        return true;
    }

    function getOpenStageHover(cubeItem) {
        const pickParams = pickParamsGetter();
        const cubeSize = cubeItem?.size ?? pickParams.cubeSize;
        return Math.max(0, cubeSize * 1.5);
    }

    function getDescendStageHover(cubeItem) {
        const pickParams = pickParamsGetter();
        const cubeSize = cubeItem?.size ?? pickParams.cubeSize;
        return -Math.min(Math.max(cubeSize * 0.9 + 0.012, 0.018), 0.05);
    }

    const targetResolvers = {
        'cube.topDownPick': (context, targetSpec, outPos, outQuat) => {
            const cubeItem = context?.cubeItem ?? null;
            const hover = context?.hover;
            return computePickTargetFromCube(cubeItem, hover, outPos, outQuat);
        },
        'container.dropTop': (context, targetSpec, outPos, outQuat) => {
            const hover = context?.hover;
            return setPickTargetToContainer(hover, outPos, outQuat);
        },
    };

    const hoverResolvers = {
        openStage: ({ cubeItem }) => getOpenStageHover(cubeItem),
        descendStage: ({ cubeItem }) => getDescendStageHover(cubeItem),
        graspHover: () => pickParamsGetter().graspHover,
    };

    function resolveTarget(targetSpec, context, outPos, outQuat) {
        const kind = targetSpec?.kind ?? '';
        const pose = targetSpec?.pose ?? '';
        const resolver = targetResolvers[`${kind}.${pose}`];
        return resolver?.(context, targetSpec, outPos, outQuat) === true;
    }

    function resolveHover(targetSpec, context) {
        if (targetSpec?.hover !== undefined) return targetSpec.hover;
        const hoverRef = targetSpec?.hoverRef ?? '';
        const resolver = hoverResolvers[hoverRef];
        if (resolver) {
            const resolved = resolver(context, targetSpec);
            if (resolved !== undefined) return resolved;
        }
        return pickParamsGetter().graspHover;
    }

    return {
        resolveTarget,
        resolveHover,
        targetResolvers,
        hoverResolvers,
    };
}

class SequencePlayer {
    constructor(options = {}) {
        this.chain = options.chain ?? null;
        this.sequence = null;
        this.getTargetObject = options.getTargetObject ?? (() => null);
        this.getPhysicsWorld = options.getPhysicsWorld ?? (() => null);
        this.getPhysicsCubes = options.getPhysicsCubes ?? (() => []);
        this.requestRender = options.requestRender ?? (() => {});
        this.now = options.now ?? (() => performance.now());
        this.getPickParams = options.getPickParams ?? (() => ({}));
        this.forwardKinematics = options.forwardKinematics ?? null;
        this.applyQToChain = options.applyQToChain ?? (() => {});
        this.getInitialQ = options.getInitialQ ?? (() => []);
        this.isCubeValid = options.isCubeValid
            ?? ((cubeItem) => Boolean(cubeItem?.mesh?.parent));
        this.defaultInteractionGroups = options.defaultInteractionGroups
            ?? 0xffffffff;
        this.heldCubeInteractionGroups = options.heldCubeInteractionGroups
            ?? this.defaultInteractionGroups;
        this.jawGapOpenEps = options.jawGapOpenEps ?? 1e-4;
        this.jawContactGapRatio = Math.max(
            0,
            options.jawContactGapRatio ?? 0.92,
        );
        this.moveSettleTimeoutMs = Math.max(
            0,
            options.moveSettleTimeoutMs ?? Infinity,
        );
        this.resolveSequenceTarget = options.resolveTarget ?? null;
        this.resolveSequenceJointState = options.resolveJointState ?? null;
        this.getJawInnerGap = options.getJawInnerGap ?? null;
        this.onActuatorChange = options.onActuatorChange ?? (() => {});
        this.onStepEnter = options.onStepEnter ?? (() => {});
        this.onPoseReached = options.onPoseReached ?? (() => {});
        this.onComplete = options.onComplete ?? (() => {});

        this._solver = new ChainSolver({
            targetPosition: new Vector3(),
            targetQuaternion: new Quaternion(),
            chain: this.chain,
            maxIter: options.maxIter ?? 20,
            alpha: options.alpha ?? 0.05,
            tolerance: options.tolerance ?? 1e-3,
            solveMode: options.solveMode === 'Position + Rotation'
                ? 'Position + Rotation'
                : 'Position Only',
            solverMethod: options.solverMethod,
            damping: options.damping,
            dlsMaxDelta: options.dlsMaxDelta,
            rotationWeight: options.rotationWeight,
            rotationTolerance: options.rotationTolerance,
            debug: options.debug ?? false,
            forwardKinematics: (q) => {
                const applyForwardKinematics = this.forwardKinematics ?? this.applyQToChain;
                applyForwardKinematics(q, { syncToolEuler: false, syncReachRange: false });
            },
        });

        this._qCurrent = this.getInitialQ().slice();
        this._isSolving = false;
        this._pendingSolve = false;
        this._solveActive = false;
        this._solveRevision = 0;
        this._lastSolveMetrics = null;
        this._pendingTarget = new Vector3();
        this._pendingTargetQuat = new Quaternion();

        this._pickSequence = null;
        this._stepRuntime = null;
        this._stageLerp = null;
        this._graspJoint = null;
        this._graspedCube = null;
        this._prevJawInnerGap = null;

        this._sequenceResolver = createSequenceResolver({
            chain: this.chain,
            getPickParams: this.getPickParams,
            getContainerDropPoint: options.getContainerDropPoint,
        });

        this.loadSequence(options.sequence);
        this.syncSolverJoints();
    }

    loadSequence(sequence = { steps: [] }) {
        this.sequence = sequence;
    }

    clear() {
        this._pickSequence = null;
        this._stepRuntime = null;
        this._stageLerp = null;
    }

    reset() {
        this.clear();
        this.releaseGraspJoint();
        this._prevJawInnerGap = null;
        this._pendingSolve = false;
        this._solveActive = false;
        this._isSolving = false;
    }

    isLerping() {
        return this._stageLerp !== null;
    }

    isActive() {
        return this._pickSequence !== null;
    }

    isSolving() {
        return this._isSolving;
    }

    hasPendingSolve() {
        return this._pendingSolve || this._solveActive;
    }

    getSolveRevision() {
        return this._solveRevision;
    }

    getSolveMetrics() {
        return this._lastSolveMetrics
            ? {
                ...this._lastSolveMetrics,
                pending: this.hasPendingSolve(),
            }
            : null;
    }

    _getActuator() {
        return this.chain?.getActuator?.() ?? null;
    }

    hasGraspJoint() {
        return this._graspJoint !== null;
    }

    getGraspedCube() {
        return this._graspedCube;
    }

    getJointState() {
        return this._qCurrent.slice();
    }

    setJointState(q, options = {}) {
        this._qCurrent = q.slice();
        this.applyQToChain(this._qCurrent, options);
        this.syncSolverJoints();
    }

    syncSolverJoints() {
        this._solver.chain = this.chain;
        this._solver.joints = this.chain?.joints ?? [];
    }

    setSolverConfig(config = {}) {
        if (config.maxIter !== undefined) this._solver.maxIter = config.maxIter;
        if (config.alpha !== undefined) this._solver.alpha = config.alpha;
        if (config.tolerance !== undefined) {
            this._solver.tolerance = config.tolerance;
        }
        if (config.solverMethod === 'Jacobian' || config.solverMethod === 'DLS') {
            this._solver.solverMethod = config.solverMethod;
        }
        if (config.damping !== undefined) {
            this._solver.damping = Math.max(1e-5, config.damping);
        }
        if (config.dlsMaxDelta !== undefined) {
            this._solver.dlsMaxDelta = Math.max(1e-4, config.dlsMaxDelta);
        }
        if (config.rotationWeight !== undefined) {
            this._solver.rotationWeight = Math.max(0, config.rotationWeight);
        }
        if (config.rotationTolerance !== undefined) {
            this._solver.rotationTolerance = Math.max(
                1e-6,
                config.rotationTolerance,
            );
        }
        if (config.debug !== undefined) this._solver.debug = config.debug;
        if (config.solveMode === 'Position Only' || config.solveMode === 'Position + Rotation') {
            this._solver.solveMode = config.solveMode;
        }
    }

    queueSolveFromTarget() {
        if (!this.chain?.roboticArm) return;
        this._syncPendingTargetFromControl();
        this._pendingSolve = true;
        this._solveActive = true;
        this.requestRender();
    }

    solveIfPending({
        targetTolerance,
        pickStagePositionTolerance,
        descendStageTolerance,
        descendTimeoutMs,
    }) {
        if ((!this._pendingSolve && !this._solveActive) || this._isSolving || !this.chain?.roboticArm) return;
        this._pendingSolve = false;

        this._solver.targetPosition.copy(this._pendingTarget);
        this._solver.targetQuaternion.copy(this._pendingTargetQuat);
        this._isSolving = true;
        try {
            this._qCurrent = this._solver.solve(this._qCurrent);
            this.applyQToChain(this._qCurrent, { syncToolEuler: false, syncReachRange: false });
            this._solveRevision += 1;
        } finally {
            this._isSolving = false;
        }

        const taskError = this._solver.computeTaskError(this._qCurrent);
        const remainingPosError = taskError.posErr.length();
        const remainingRotationError = taskError.rotErr.length();
        const remainingError = this._solver.isPositionAndRotationMode()
            ? Math.hypot(remainingPosError, remainingRotationError)
            : remainingPosError;
        const { converged } = this.evaluateSolveResult({
            remainingError,
            remainingPosError,
            targetTolerance,
            pickStagePositionTolerance,
            descendStageTolerance,
            descendTimeoutMs,
        });
        this._lastSolveMetrics = {
            solverMethod: this._solver.solverMethod,
            positionError: remainingPosError,
            rotationError: remainingRotationError,
            taskError: remainingError,
            iterations: this._solver.lastIterationCount,
            converged,
            revision: this._solveRevision,
        };

        if (!converged) {
            this._solveActive = true;
            this._pendingSolve = true;
        } else {
            this._solveActive = false;
        }
    }

    releaseGraspJoint() {
        this._restoreHeldCubeCollisionFilter(this._graspedCube);
        const physicsWorld = this.getPhysicsWorld();
        if (physicsWorld && this._graspJoint) {
            physicsWorld.removeImpulseJoint(this._graspJoint, true);
        }
        this._graspJoint = null;
        this._graspedCube = null;
    }

    runManualGripStep() {
        this.clear();
        const actuator = this._getActuator();
        if (!actuator) return false;
        if (this._graspJoint && this._graspedCube) {
            return false;
        }

        const candidate = this._pickJawContactCandidate(this.getPhysicsCubes(), actuator);
        if (candidate && this._createGraspJointForCube(candidate, actuator)) {
            return true;
        }
        if (!candidate) {
            const gripCloseStep = this.getPickParams().gripCloseStep ?? 0.002;
            const step = Math.max(0.002, gripCloseStep);
            this._setActuatorOpenRatio(
                actuator,
                Math.max(0, actuator.getOpenRatio() - step),
            );
            return true;
        }
        return false;
    }

    beforePhysicsStep() {
        if (this._graspJoint && this._graspedCube?.body) {
            this._graspedCube.body.wakeUp();
        }
    }

    afterPhysicsStep() {
        const actuator = this._getActuator();
        if (this._graspJoint && actuator && this._graspedCube) {
            const jawGap = this._getJawInnerGap(actuator);
            const cubeSize = this._graspedCube.size
                ?? this.getPickParams().cubeSize;
            const isOpening = this._prevJawInnerGap !== null
                && jawGap > (this._prevJawInnerGap + this.jawGapOpenEps);
            if (jawGap >= cubeSize && isOpening) {
                this.releaseGraspJoint();
            }
        }
        if (this._graspJoint && !this.isCubeValid(this._graspedCube)) {
            this.releaseGraspJoint();
        }
        this._updateGripStep(actuator);
        this._prevJawInnerGap = actuator ? actuator.getJawInnerGap() : null;
    }

    startPickSequence(cubeItem, context = {}) {
        const targetObject = this.getTargetObject();
        if (!cubeItem || !targetObject || !this.sequence?.steps?.length) return false;

        this.clear();
        this._pickSequence = {
            cube: cubeItem,
            context,
            stepIndex: 0,
            requiresCube: true,
        };
        return this._enterCurrentStep();
    }

    startSequence(context = {}) {
        const targetObject = this.getTargetObject();
        if (!targetObject || !this.sequence?.steps?.length) return false;

        this.clear();
        this._pickSequence = {
            cube: null,
            context,
            stepIndex: 0,
            requiresCube: false,
        };
        return this._enterCurrentStep();
    }

    updateStageLerp() {
        const stageLerp = this._stageLerp;
        const targetObject = this.getTargetObject();
        if (!stageLerp || !targetObject) return false;

        const t = Math.min(1, (this.now() - stageLerp.startMs) / stageLerp.durationMs);
        if (stageLerp.kind === 'joint') {
            const eased = smoothstep(t);
            this._qCurrent = stageLerp.fromJointState.map((fromValue, index) => (
                fromValue
                + (stageLerp.toJointState[index] - fromValue) * eased
            ));
            this.applyQToChain(this._qCurrent, {
                syncToolEuler: false,
                syncReachRange: false,
            });
            this._syncTargetControlFromGrip();
            if (t >= 1) {
                const step = this._currentStep();
                this._stageLerp = null;
                this._notifyPoseReached(step);
                this._advanceStep();
            }
            this.requestRender();
            return true;
        }

        const progress = stageLerp.interpolation === 'smooth'
            ? smoothstep(t)
            : t;
        targetObject.position.lerpVectors(
            stageLerp.fromPos,
            stageLerp.toPos,
            progress,
        );
        if (stageLerp.rotationInterpolation === 'eulerXYZ') {
            _tmpCurrentEuler.set(
                stageLerp.fromEuler.x
                    + (stageLerp.toEuler.x - stageLerp.fromEuler.x) * progress,
                stageLerp.fromEuler.y
                    + (stageLerp.toEuler.y - stageLerp.fromEuler.y) * progress,
                stageLerp.fromEuler.z
                    + (stageLerp.toEuler.z - stageLerp.fromEuler.z) * progress,
                'XYZ',
            );
            targetObject.quaternion.setFromEuler(_tmpCurrentEuler);
        } else {
            targetObject.quaternion
                .copy(stageLerp.fromQuat)
                .slerp(stageLerp.toQuat, progress);
        }
        targetObject.updateMatrixWorld(true);
        if (stageLerp.solveWhileLerping) {
            this.queueSolveFromTarget();
        }

        if (t >= 1) {
            const step = this._currentStep();
            this._stageLerp = null;
            if (step?.type === 'move') {
                const completion = step.completion ?? 'solve';
                if (completion === 'solve') {
                    this._stepRuntime = {
                        kind: 'move',
                        awaitingConvergence: true,
                        startedMs: this.now(),
                    };
                    this.queueSolveFromTarget();
                } else {
                    this._notifyPoseReached(step);
                    this._advanceStep();
                }
            } else {
                this._advanceStep();
            }
        }
        return true;
    }

    evaluateSolveResult({
        remainingError,
        remainingPosError,
        targetTolerance,
        pickStagePositionTolerance,
        descendStageTolerance,
        descendTimeoutMs,
    }) {
        const step = this._currentStep();
        const awaitingMoveConvergence = step?.type === 'move'
            && this._stepRuntime?.awaitingConvergence;
        const useDescendProfile = awaitingMoveConvergence && step?.toleranceProfile === 'descend';
        const descendContactReady = useDescendProfile
            && this._pickSequence?.cube
            && this._pickJawContactCandidate([this._pickSequence.cube]) !== null;
        const descendTimedOut = useDescendProfile
            && this._stepRuntime?.startedMs !== undefined
            && (this.now() - this._stepRuntime.startedMs) >= descendTimeoutMs;
        const moveTimedOut = awaitingMoveConvergence
            && this._stepRuntime?.startedMs !== undefined
            && (this.now() - this._stepRuntime.startedMs) >= this.moveSettleTimeoutMs;
        const stagePosTolerance = useDescendProfile
            ? Math.min(targetTolerance, descendStageTolerance)
            : Math.max(targetTolerance, pickStagePositionTolerance);
        const converged = awaitingMoveConvergence
            ? (
                remainingPosError <= stagePosTolerance
                || descendContactReady
                || descendTimedOut
                || moveTimedOut
            )
            : remainingError <= targetTolerance;

        if (converged && awaitingMoveConvergence) {
            this._stepRuntime = null;
            this._notifyPoseReached(step);
            this._advanceStep();
        }

        return { converged };
    }

    _currentStep() {
        const stepIndex = this._pickSequence?.stepIndex;
        if (!Number.isInteger(stepIndex)) return null;
        return this.sequence?.steps?.[stepIndex] ?? null;
    }

    _notifyPoseReached(step) {
        if (step?.type !== 'move' && step?.type !== 'joint') {
            return;
        }
        this.onPoseReached(step, this._pickSequence?.cube ?? null);
    }

    _advanceStep() {
        if (!this._pickSequence) return false;
        this._pickSequence.stepIndex += 1;
        return this._enterCurrentStep();
    }

    _enterCurrentStep() {
        const step = this._currentStep();
        if (!step) {
            const completedCube = this._pickSequence?.cube ?? null;
            const completedContext = this._pickSequence?.context ?? {};
            this.clear();
            this.onComplete(completedCube, completedContext);
            this.requestRender();
            return false;
        }

        if (
            this._pickSequence?.requiresCube
            && !this.isCubeValid(this._pickSequence?.cube)
        ) {
            this.releaseGraspJoint();
            this.clear();
            return false;
        }
        if (
            step.when
            && this._pickSequence?.context?.[step.when] !== true
        ) {
            return this._advanceStep();
        }

        this.onStepEnter(step, this._pickSequence?.cube ?? null);

        if (step.type === 'wait') {
            this._stepRuntime = { kind: 'wait' };
            this._startCurrentLerp({
                durationMs: this._resolveDurationMs(step),
                solveWhileLerping: false,
                toPos: this.getTargetObject()?.position ?? _tmpTargetPos.set(0, 0, 0),
                toQuat: this.getTargetObject()?.quaternion ?? _tmpTargetQuat.identity(),
            });
            return true;
        }

        if (step.type === 'grip') {
            return this._enterGripStep(step);
        }

        if (step.type === 'move') {
            return this._enterMoveStep(step);
        }

        if (step.type === 'joint') {
            return this._enterJointStep(step);
        }

        this.clear();
        return false;
    }

    _enterMoveStep(step) {
        if (!this._resolveTarget(step.target, _tmpTargetPos, _tmpTargetQuat)) {
            this.clear();
            return false;
        }
        this._stepRuntime = {
            kind: 'move',
            awaitingConvergence: false,
            startedMs: this.now(),
        };
        this._startCurrentLerp({
            durationMs: this._resolveDurationMs(step),
            interpolation: step.interpolation,
            rotationInterpolation: step.rotationInterpolation,
            solveWhileLerping: step.solveWhileLerping ?? false,
            toPos: _tmpTargetPos,
            toQuat: _tmpTargetQuat,
        });
        this.requestRender();
        return true;
    }

    _enterGripStep(step) {
        const actuator = this._getActuator();
        if (!actuator) {
            this.clear();
            return false;
        }
        const timed = step.durationMs !== undefined
            || step.durationParam !== undefined;

        if (step.mode === 'open' && !timed) {
            this._setActuatorOpenRatio(actuator, 1);
            this.releaseGraspJoint();
            this.requestRender();
            return this._advanceStep();
        }

        if (step.mode === 'open' || step.mode === 'closeUntilContact') {
            this._stepRuntime = {
                kind: 'grip',
                mode: step.mode,
                startedMs: this.now(),
                durationMs: this._resolveDurationMs(step),
                fromOpenRatio: actuator.getOpenRatio(),
                toOpenRatio: step.mode === 'open' ? 1 : 0,
                timed,
            };
            this.requestRender();
            return true;
        }

        this.clear();
        return false;
    }

    _enterJointStep(step) {
        if (!this.resolveSequenceJointState) {
            this.clear();
            return false;
        }
        const fromJointState = this.getJointState();
        const toJointState = [];
        const resolved = this.resolveSequenceJointState(
            step.target ?? step.pose,
            {
                cubeItem: this._pickSequence?.cube ?? null,
                sequenceContext: this._pickSequence?.context ?? {},
                currentJointState: fromJointState.slice(),
                step,
                player: this,
            },
            toJointState,
        );
        if (
            resolved !== true
            || toJointState.length !== fromJointState.length
            || toJointState.some((value) => !Number.isFinite(value))
        ) {
            this.clear();
            return false;
        }
        this._stageLerp = {
            kind: 'joint',
            startMs: this.now(),
            durationMs: this._resolveDurationMs(step),
            fromJointState,
            toJointState: toJointState.slice(),
        };
        this.requestRender();
        return true;
    }

    _startCurrentLerp({
        durationMs,
        interpolation = 'linear',
        rotationInterpolation = 'quaternion',
        solveWhileLerping,
        toPos,
        toQuat,
    }) {
        const targetObject = this.getTargetObject();
        if (!targetObject) return;
        _tmpFromEuler.setFromQuaternion(targetObject.quaternion, 'XYZ');
        _tmpToEuler.setFromQuaternion(toQuat, 'XYZ');
        _tmpToEuler.set(
            unwrapRadians(_tmpToEuler.x, _tmpFromEuler.x),
            unwrapRadians(_tmpToEuler.y, _tmpFromEuler.y),
            unwrapRadians(_tmpToEuler.z, _tmpFromEuler.z),
            'XYZ',
        );
        this._stageLerp = {
            startMs: this.now(),
            durationMs: Math.max(1, durationMs ?? 1),
            interpolation,
            rotationInterpolation,
            solveWhileLerping,
            fromPos: targetObject.position.clone(),
            fromQuat: targetObject.quaternion.clone(),
            fromEuler: _tmpFromEuler.clone(),
            toPos: toPos.clone(),
            toQuat: toQuat.clone(),
            toEuler: _tmpToEuler.clone(),
        };
    }

    _resolveDurationMs(step) {
        const scale = step.durationScale ?? 1;
        if (step.durationMs !== undefined) {
            return Math.max(1, step.durationMs * scale);
        }
        const key = step.durationParam ?? '';
        const value = key ? this.getPickParams()?.[key] : null;
        return Math.max(1, (value ?? 1) * scale);
    }

    _resolveTarget(targetSpec, outPos, outQuat) {
        if (!targetSpec) return false;
        const cubeItem = this._pickSequence?.cube ?? null;
        const hover = this._resolveHover(targetSpec, cubeItem);
        const context = {
            cubeItem,
            hover,
            sequenceContext: this._pickSequence?.context ?? {},
            player: this,
        };
        if (
            this.resolveSequenceTarget
            && this.resolveSequenceTarget(targetSpec, context, outPos, outQuat) === true
        ) {
            return true;
        }
        return this._sequenceResolver?.resolveTarget?.(
            targetSpec,
            context,
            outPos,
            outQuat,
        ) === true;
    }

    _resolveHover(targetSpec, cubeItem) {
        if (targetSpec?.hover !== undefined) return targetSpec.hover;
        const resolved = this._sequenceResolver?.resolveHover?.(targetSpec, { cubeItem });
        return resolved ?? this.getPickParams().graspHover;
    }

    _updateGripStep(actuator = this._getActuator()) {
        const step = this._currentStep();
        if (!step || step.type !== 'grip' || !actuator) return;

        if (step.mode === 'open') {
            const runtime = this._stepRuntime;
            const elapsed = this.now() - runtime.startedMs;
            const progress = smoothstep(elapsed / runtime.durationMs);
            this._setActuatorOpenRatio(
                actuator,
                runtime.fromOpenRatio
                    + (runtime.toOpenRatio - runtime.fromOpenRatio) * progress,
            );
            if (progress >= 1) {
                this.releaseGraspJoint();
                this._advanceStep();
            }
            return;
        }

        if (step.mode !== 'closeUntilContact') return;

        const cubeItem = this._pickSequence?.cube;
        if (!this.isCubeValid(cubeItem) || !cubeItem?.body || !cubeItem?.collider) {
            this.releaseGraspJoint();
            this.clear();
            return;
        }

        if (this._graspJoint) {
            this._advanceStep();
            return;
        }

        cubeItem.body.wakeUp();
        const candidate = this._pickJawContactCandidate([cubeItem], actuator);
        if (candidate && this._createGraspJointForCube(candidate, actuator)) {
            this._advanceStep();
            return;
        }

        const runtime = this._stepRuntime;
        const openRatio = actuator.getOpenRatio();
        if (openRatio <= 0) {
            this.clear();
            this.requestRender();
            return;
        }

        let nextOpenRatio;
        if (runtime?.timed) {
            const elapsed = this.now() - runtime.startedMs;
            const progress = smoothstep(elapsed / runtime.durationMs);
            nextOpenRatio = runtime.fromOpenRatio
                + (runtime.toOpenRatio - runtime.fromOpenRatio) * progress;
        } else {
            const gripCloseStep = this.getPickParams().gripCloseStep ?? 0.002;
            nextOpenRatio = openRatio - Math.max(0.002, gripCloseStep);
        }
        this._setActuatorOpenRatio(actuator, Math.max(0, nextOpenRatio));
        this.queueSolveFromTarget();
        this.requestRender();
    }

    _setActuatorOpenRatio(actuator, openRatio) {
        actuator?.setOpenRatio?.(openRatio);
        this.onActuatorChange(actuator, openRatio);
    }

    _getJawInnerGap(actuator = this._getActuator()) {
        const resolved = this.getJawInnerGap?.(actuator);
        return Math.max(0, resolved ?? actuator?.getJawInnerGap?.() ?? 0);
    }

    _applyHeldCubeCollisionFilter(cubeItem) {
        if (!cubeItem?.collider || cubeItem.gripFilterApplied) return;
        cubeItem.savedCollisionGroups = cubeItem.collider.collisionGroups();
        cubeItem.savedSolverGroups = cubeItem.collider.solverGroups();
        cubeItem.collider.setCollisionGroups(this.heldCubeInteractionGroups);
        cubeItem.collider.setSolverGroups(this.heldCubeInteractionGroups);
        cubeItem.gripFilterApplied = true;
    }

    _restoreHeldCubeCollisionFilter(cubeItem) {
        if (!cubeItem?.collider || !cubeItem.gripFilterApplied) return;
        const collisionGroups = cubeItem.savedCollisionGroups
            ?? this.defaultInteractionGroups;
        const solverGroups = cubeItem.savedSolverGroups
            ?? this.defaultInteractionGroups;
        cubeItem.collider.setCollisionGroups(collisionGroups);
        cubeItem.collider.setSolverGroups(solverGroups);
        cubeItem.savedCollisionGroups = null;
        cubeItem.savedSolverGroups = null;
        cubeItem.gripFilterApplied = false;
    }

    _areCollidersTouching(colliderA, colliderB) {
        const physicsWorld = this.getPhysicsWorld();
        if (!physicsWorld || !colliderA || !colliderB) return false;
        let hasContact = false;
        physicsWorld.contactPair(colliderA, colliderB, () => {
            hasContact = true;
        });
        return hasContact || physicsWorld.intersectionPair(colliderA, colliderB);
    }

    _getJawContactState(cubeItem, actuator = this._getActuator()) {
        if (!actuator || !cubeItem?.collider) {
            return { left: false, right: false };
        }
        const { left, right } = actuator.getJawColliders();
        if (!left || !right) {
            return { left: false, right: false };
        }
        return {
            left: this._areCollidersTouching(left, cubeItem.collider),
            right: this._areCollidersTouching(right, cubeItem.collider),
        };
    }

    _pickJawContactCandidate(cubeList, actuator = this._getActuator()) {
        if (!actuator || cubeList.length === 0) return null;
        const jawGap = this._getJawInnerGap(actuator);
        for (const cubeItem of cubeList) {
            if (!cubeItem?.collider || !cubeItem?.body || !this.isCubeValid(cubeItem)) continue;
            const contact = this._getJawContactState(cubeItem, actuator);
            if (!(contact.left && contact.right)) continue;
            const cubeSize = cubeItem.size ?? this.getPickParams().cubeSize;
            if (jawGap <= this.jawContactGapRatio * cubeSize) {
                return cubeItem;
            }
        }
        return null;
    }

    _createGraspJointForCube(cubeItem, actuator = this._getActuator()) {
        const physicsWorld = this.getPhysicsWorld();
        const toolBody = actuator?.getPhysicsBody?.();
        if (!toolBody || !cubeItem?.body || !physicsWorld) return false;

        const cubeT = cubeItem.body.translation();
        _tmpGraspWorldPos.set(cubeT.x, cubeT.y, cubeT.z);
        worldToBodyLocalPoint(toolBody, _tmpGraspWorldPos, _tmpLocalAnchorA);
        _tmpLocalAnchorB.set(0, 0, 0);
        copyBodyPose(toolBody, _tmpWorldPosA, _tmpWorldQuatA);
        copyBodyPose(cubeItem.body, _tmpWorldPosB, _tmpWorldQuatB);
        _tmpJointLocalRotB.copy(_tmpWorldQuatB).invert().multiply(_tmpWorldQuatA).normalize();

        this._graspJoint = physicsWorld.createImpulseJoint(
            JointData.fixed(
                { x: _tmpLocalAnchorA.x, y: _tmpLocalAnchorA.y, z: _tmpLocalAnchorA.z },
                { x: 0, y: 0, z: 0, w: 1 },
                { x: _tmpLocalAnchorB.x, y: _tmpLocalAnchorB.y, z: _tmpLocalAnchorB.z },
                { x: _tmpJointLocalRotB.x, y: _tmpJointLocalRotB.y, z: _tmpJointLocalRotB.z, w: _tmpJointLocalRotB.w },
            ),
            toolBody,
            cubeItem.body,
            true,
        );
        this._graspedCube = cubeItem;
        this._applyHeldCubeCollisionFilter(cubeItem);
        cubeItem.body.wakeUp();
        return true;
    }

    _syncPendingTargetFromControl() {
        const targetObject = this.getTargetObject();
        if (!targetObject) return;
        targetObject.getWorldPosition(_tmpWorldPosA);
        targetObject.getWorldQuaternion(_tmpWorldQuatA);
        const actuator = this._getActuator();
        if (actuator) {
            actuator.computeEndTargetFromGripTarget(
                _tmpWorldPosA,
                _tmpWorldQuatA,
                this._pendingTarget,
                this._pendingTargetQuat
            );
            return;
        }
        this._pendingTarget.copy(_tmpWorldPosA);
        this._pendingTargetQuat.copy(_tmpWorldQuatA);
    }

    _syncTargetControlFromGrip() {
        const targetObject = this.getTargetObject();
        const actuator = this._getActuator();
        if (!targetObject || !actuator) return;
        actuator.getGripWorldPosition(_tmpWorldPosA);
        actuator.getGripWorldQuaternion(_tmpWorldQuatA);
        if (targetObject.parent) {
            targetObject.parent.worldToLocal(_tmpWorldPosA);
            targetObject.parent.getWorldQuaternion(_tmpInvWorldQuat).invert();
            _tmpWorldQuatA.premultiply(_tmpInvWorldQuat);
        }
        targetObject.position.copy(_tmpWorldPosA);
        targetObject.quaternion.copy(_tmpWorldQuatA);
        targetObject.updateMatrixWorld(true);
    }
}

export {
    createSequenceResolver,
    SequencePlayer,
    SequencePlayer as default,
};
