import { JointData } from '@dimforge/rapier3d-compat';
import { Quaternion, Vector3 } from 'three';
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

const sequenceJson = {
    name: 'ik-pick-default',
    version: 1,
    steps: [
        {
            id: 'approach',
            type: 'move',
            target: { kind: 'cube', pose: 'topDownPick', hoverRef: 'openStage' },
            durationParam: 'approachDurationMs',
            solveWhileLerping: true,
            completion: 'solve',
        },
        {
            id: 'waitOpen',
            type: 'wait',
            durationParam: 'stageDelayMs',
        },
        {
            id: 'openGrip',
            type: 'grip',
            mode: 'open',
        },
        {
            id: 'waitDescend',
            type: 'wait',
            durationParam: 'stageDelayMs',
        },
        {
            id: 'descend',
            type: 'move',
            target: { kind: 'cube', pose: 'topDownPick', hoverRef: 'descendStage' },
            durationParam: 'descendDurationMs',
            solveWhileLerping: true,
            completion: 'solve',
            toleranceProfile: 'descend',
        },
        {
            id: 'grip',
            type: 'grip',
            mode: 'closeUntilContact',
        },
        {
            id: 'lift',
            type: 'move',
            target: { kind: 'cube', pose: 'topDownPick', hoverRef: 'graspHover' },
            durationParam: 'liftDurationMs',
            solveWhileLerping: true,
            completion: 'solve',
        },
        {
            id: 'waitCarry',
            type: 'wait',
            durationParam: 'stageDelayMs',
        },
        {
            id: 'carry',
            type: 'move',
            target: { kind: 'container', pose: 'dropTop', hoverRef: 'graspHover' },
            durationParam: 'carryDurationMs',
            solveWhileLerping: true,
            completion: 'solve',
        },
        {
            id: 'waitDrop',
            type: 'wait',
            durationParam: 'stageDelayMs',
        },
        {
            id: 'release',
            type: 'grip',
            mode: 'open',
        },
    ],
};

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
    const pickParamsGetter = typeof getPickParams === 'function' ? getPickParams : () => ({});
    const containerDropPointGetter = typeof getContainerDropPoint === 'function'
        ? getContainerDropPoint
        : (out) => out.set(0, 0, 0);

    function computePickTargetFromCube(cubeItem, hover, outPos, outQuat) {
        if (!cubeItem?.mesh || !outPos || !outQuat) return false;
        cubeItem.mesh.getWorldPosition(_tmpPickPos);
        const pickParams = pickParamsGetter();
        const cubeSize = Number.isFinite(cubeItem.size) ? cubeItem.size : pickParams.cubeSize;
        const hoverOffset = Number.isFinite(hover) ? hover : pickParams.graspHover;
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
        const hoverOffset = Number.isFinite(hover) ? hover : pickParams.graspHover;
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
        const cubeSize = Number.isFinite(cubeItem?.size) ? cubeItem.size : pickParams.cubeSize;
        return Math.max(0, cubeSize * 1.5);
    }

    function getDescendStageHover(cubeItem) {
        const pickParams = pickParamsGetter();
        const cubeSize = Number.isFinite(cubeItem?.size) ? cubeItem.size : pickParams.cubeSize;
        return -Math.min(Math.max(cubeSize * 0.9 + 0.012, 0.018), 0.05);
    }

    const targetResolvers = {
        'cube.topDownPick': (context, targetSpec, outPos, outQuat) => {
            const cubeItem = context?.cubeItem ?? null;
            const hover = Number.isFinite(context?.hover) ? context.hover : undefined;
            return computePickTargetFromCube(cubeItem, hover, outPos, outQuat);
        },
        'container.dropTop': (context, targetSpec, outPos, outQuat) => {
            const hover = Number.isFinite(context?.hover) ? context.hover : undefined;
            return setPickTargetToContainer(hover, outPos, outQuat);
        },
    };

    const hoverResolvers = {
        openStage: ({ cubeItem }) => getOpenStageHover(cubeItem),
        descendStage: ({ cubeItem }) => getDescendStageHover(cubeItem),
        graspHover: () => pickParamsGetter().graspHover,
    };

    function resolveTarget(targetSpec, context, outPos, outQuat) {
        const kind = typeof targetSpec?.kind === 'string' ? targetSpec.kind : '';
        const pose = typeof targetSpec?.pose === 'string' ? targetSpec.pose : '';
        const resolver = targetResolvers[`${kind}.${pose}`];
        return typeof resolver === 'function'
            ? resolver(context, targetSpec, outPos, outQuat) === true
            : false;
    }

    function resolveHover(targetSpec, context) {
        if (Number.isFinite(targetSpec?.hover)) return targetSpec.hover;
        const hoverRef = typeof targetSpec?.hoverRef === 'string' ? targetSpec.hoverRef : '';
        const resolver = hoverResolvers[hoverRef];
        if (typeof resolver === 'function') {
            const resolved = resolver(context, targetSpec);
            if (Number.isFinite(resolved)) return resolved;
        }
        return pickParamsGetter().graspHover;
    }

    function resolve(sequence) {
        return sequence && Array.isArray(sequence.steps) ? sequence : sequenceJson;
    }

    return {
        resolve,
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
        this.getTargetObject = typeof options.getTargetObject === 'function'
            ? options.getTargetObject
            : () => null;
        this.getPhysicsWorld = typeof options.getPhysicsWorld === 'function'
            ? options.getPhysicsWorld
            : () => null;
        this.getPhysicsCubes = typeof options.getPhysicsCubes === 'function'
            ? options.getPhysicsCubes
            : () => [];
        this.requestRender = typeof options.requestRender === 'function'
            ? options.requestRender
            : () => {};
        this.now = typeof options.now === 'function'
            ? options.now
            : () => performance.now();
        this.getPickParams = typeof options.getPickParams === 'function'
            ? options.getPickParams
            : () => ({});
        this.forwardKinematics = typeof options.forwardKinematics === 'function'
            ? options.forwardKinematics
            : null;
        this.applyQToChain = typeof options.applyQToChain === 'function'
            ? options.applyQToChain
            : () => {};
        this.getInitialQ = typeof options.getInitialQ === 'function'
            ? options.getInitialQ
            : () => [];
        this.isCubeValid = typeof options.isCubeValid === 'function'
            ? options.isCubeValid
            : (cubeItem) => Boolean(cubeItem?.mesh?.parent);
        this.defaultInteractionGroups = Number.isFinite(options.defaultInteractionGroups)
            ? options.defaultInteractionGroups
            : 0xffffffff;
        this.heldCubeInteractionGroups = Number.isFinite(options.heldCubeInteractionGroups)
            ? options.heldCubeInteractionGroups
            : this.defaultInteractionGroups;
        this.jawGapOpenEps = Number.isFinite(options.jawGapOpenEps)
            ? options.jawGapOpenEps
            : 1e-4;

        this._solver = new ChainSolver({
            targetPosition: new Vector3(),
            targetQuaternion: new Quaternion(),
            chain: this.chain,
            maxIter: Number.isFinite(options.maxIter) ? options.maxIter : 20,
            alpha: Number.isFinite(options.alpha) ? options.alpha : 0.05,
            tolerance: Number.isFinite(options.tolerance) ? options.tolerance : 1e-3,
            solveMode: options.solveMode === 'Position + Rotation'
                ? 'Position + Rotation'
                : 'Position Only',
            debug: options.debug === true,
            forwardKinematics: (q) => {
                const applyForwardKinematics = this.forwardKinematics ?? this.applyQToChain;
                applyForwardKinematics(q, { syncToolEuler: false, syncReachRange: false });
            },
        });

        this._qCurrent = this.getInitialQ().slice();
        this._isSolving = false;
        this._pendingSolve = false;
        this._solveActive = false;
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

        this.loadSequence(this._sequenceResolver.resolve(options.sequence));
    }

    loadSequence(sequence) {
        this.sequence = this._sequenceResolver?.resolve(sequence) ?? sequenceJson;
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

    isSolving() {
        return this._isSolving;
    }

    hasPendingSolve() {
        return this._pendingSolve || this._solveActive;
    }

    _getActuator() {
        return this.chain?.getActuator?.() ?? null;
    }

    hasGraspJoint() {
        return this._graspJoint !== null;
    }

    getJointState() {
        return this._qCurrent.slice();
    }

    setJointState(q, options = {}) {
        this._qCurrent = Array.isArray(q) ? q.slice() : [];
        this.applyQToChain(this._qCurrent, options);
        this.syncSolverJoints();
    }

    syncSolverJoints() {
        this._solver.chain = this.chain;
        this._solver.joints = this.chain?.joints ?? [];
    }

    setSolverConfig(config = {}) {
        if (Number.isFinite(config.maxIter)) this._solver.maxIter = config.maxIter;
        if (Number.isFinite(config.alpha)) this._solver.alpha = config.alpha;
        if (Number.isFinite(config.tolerance)) this._solver.tolerance = config.tolerance;
        if (typeof config.debug === 'boolean') this._solver.debug = config.debug;
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
        } finally {
            this._isSolving = false;
        }

        const remainingError = this._solver.computeSolveErrorNorm(this._qCurrent);
        const remainingPosError = this._solver.computePositionError(this._qCurrent).length();
        const { converged } = this.evaluateSolveResult({
            remainingError,
            remainingPosError,
            targetTolerance,
            pickStagePositionTolerance,
            descendStageTolerance,
            descendTimeoutMs,
        });

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
            const gripCloseStep = Number.isFinite(this.getPickParams().gripCloseStep)
                ? this.getPickParams().gripCloseStep
                : 0.002;
            const step = Math.max(0.002, gripCloseStep);
            actuator.setOpenRatio(Math.max(0, actuator.getOpenRatio() - step));
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
            const jawGap = actuator.getJawInnerGap();
            const cubeSize = Number.isFinite(this._graspedCube.size)
                ? this._graspedCube.size
                : this.getPickParams().cubeSize;
            const isOpening = Number.isFinite(this._prevJawInnerGap)
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

    startPickSequence(cubeItem) {
        const targetObject = this.getTargetObject();
        if (!cubeItem || !targetObject || !this.sequence?.steps?.length) return false;

        this.clear();
        this._pickSequence = {
            cube: cubeItem,
            stepIndex: 0,
        };
        return this._enterCurrentStep();
    }

    updateStageLerp() {
        const stageLerp = this._stageLerp;
        const targetObject = this.getTargetObject();
        if (!stageLerp || !targetObject) return false;

        const t = Math.min(1, (this.now() - stageLerp.startMs) / stageLerp.durationMs);
        targetObject.position.lerpVectors(stageLerp.fromPos, stageLerp.toPos, t);
        targetObject.quaternion.copy(stageLerp.fromQuat).slerp(stageLerp.toQuat, t);
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
        const awaitingMoveConvergence = step?.type === 'move' && this._stepRuntime?.awaitingConvergence === true;
        const useDescendProfile = awaitingMoveConvergence && step?.toleranceProfile === 'descend';
        const descendContactReady = useDescendProfile
            && this._pickSequence?.cube
            && this._pickJawContactCandidate([this._pickSequence.cube]) !== null;
        const descendTimedOut = useDescendProfile
            && Number.isFinite(this._stepRuntime?.startedMs)
            && (this.now() - this._stepRuntime.startedMs) >= descendTimeoutMs;
        const stagePosTolerance = useDescendProfile
            ? Math.min(targetTolerance, descendStageTolerance)
            : Math.max(targetTolerance, pickStagePositionTolerance);
        const converged = awaitingMoveConvergence
            ? (remainingPosError <= stagePosTolerance || descendContactReady || descendTimedOut)
            : remainingError <= targetTolerance;

        if (converged && awaitingMoveConvergence) {
            this._stepRuntime = null;
            this._advanceStep();
        }

        return { converged };
    }

    _currentStep() {
        const stepIndex = this._pickSequence?.stepIndex;
        if (!Number.isInteger(stepIndex)) return null;
        return this.sequence?.steps?.[stepIndex] ?? null;
    }

    _advanceStep() {
        if (!this._pickSequence) return false;
        this._pickSequence.stepIndex += 1;
        return this._enterCurrentStep();
    }

    _enterCurrentStep() {
        const step = this._currentStep();
        if (!step) {
            this.clear();
            this.requestRender();
            return false;
        }

        if (!this.isCubeValid(this._pickSequence?.cube)) {
            this.releaseGraspJoint();
            this.clear();
            return false;
        }

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
            solveWhileLerping: step.solveWhileLerping === true,
            toPos: _tmpTargetPos,
            toQuat: _tmpTargetQuat,
        });
        this.requestRender();
        return true;
    }

    _enterGripStep(step) {
        if (step.mode === 'open') {
            this.chain?.openActuator?.();
            this.requestRender();
            return this._advanceStep();
        }

        if (step.mode === 'closeUntilContact') {
            this._stepRuntime = {
                kind: 'grip',
                mode: 'closeUntilContact',
            };
            this.requestRender();
            return true;
        }

        this.clear();
        return false;
    }

    _startCurrentLerp({ durationMs, solveWhileLerping, toPos, toQuat }) {
        const targetObject = this.getTargetObject();
        if (!targetObject) return;
        this._stageLerp = {
            startMs: this.now(),
            durationMs: Math.max(1, Number.isFinite(durationMs) ? durationMs : 1),
            solveWhileLerping,
            fromPos: targetObject.position.clone(),
            fromQuat: targetObject.quaternion.clone(),
            toPos: toPos.clone(),
            toQuat: toQuat.clone(),
        };
    }

    _resolveDurationMs(step) {
        if (Number.isFinite(step.durationMs)) return step.durationMs;
        const key = typeof step.durationParam === 'string' ? step.durationParam : '';
        const value = key ? this.getPickParams()?.[key] : null;
        return Number.isFinite(value) ? value : 1;
    }

    _resolveTarget(targetSpec, outPos, outQuat) {
        if (!targetSpec) return false;
        const cubeItem = this._pickSequence?.cube ?? null;
        const hover = this._resolveHover(targetSpec, cubeItem);
        return this._sequenceResolver?.resolveTarget?.(targetSpec, { cubeItem, hover }, outPos, outQuat) === true;
    }

    _resolveHover(targetSpec, cubeItem) {
        if (Number.isFinite(targetSpec?.hover)) return targetSpec.hover;
        const resolved = this._sequenceResolver?.resolveHover?.(targetSpec, { cubeItem });
        return Number.isFinite(resolved) ? resolved : this.getPickParams().graspHover;
    }

    _updateGripStep(actuator = this._getActuator()) {
        const step = this._currentStep();
        if (!step || step.type !== 'grip' || step.mode !== 'closeUntilContact' || !actuator) return;

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

        const openRatio = actuator.getOpenRatio();
        if (openRatio <= 0) {
            this.clear();
            this.requestRender();
            return;
        }

        const gripCloseStep = Number.isFinite(this.getPickParams().gripCloseStep)
            ? this.getPickParams().gripCloseStep
            : 0.002;
        const gripStep = Math.max(0.002, gripCloseStep);
        actuator.setOpenRatio(Math.max(0, openRatio - gripStep));
        this.queueSolveFromTarget();
        this.requestRender();
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
        const collisionGroups = Number.isFinite(cubeItem.savedCollisionGroups)
            ? cubeItem.savedCollisionGroups
            : this.defaultInteractionGroups;
        const solverGroups = Number.isFinite(cubeItem.savedSolverGroups)
            ? cubeItem.savedSolverGroups
            : this.defaultInteractionGroups;
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
        if (!actuator || !Array.isArray(cubeList) || cubeList.length === 0) return null;
        const jawGap = actuator.getJawInnerGap();
        for (const cubeItem of cubeList) {
            if (!cubeItem?.collider || !cubeItem?.body || !this.isCubeValid(cubeItem)) continue;
            const contact = this._getJawContactState(cubeItem, actuator);
            if (!(contact.left && contact.right)) continue;
            const cubeSize = Number.isFinite(cubeItem.size)
                ? cubeItem.size
                : this.getPickParams().cubeSize;
            if (jawGap <= 0.92 * cubeSize) {
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
}

export {
    sequenceJson,
    createSequenceResolver,
    SequencePlayer,
    SequencePlayer as default,
};
