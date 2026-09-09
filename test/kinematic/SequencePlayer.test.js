import assert from 'node:assert/strict';
import test from 'node:test';
import { Euler, Object3D, Quaternion, Vector3 } from 'three';
import { SequencePlayer } from '../../extend/kinematic/SequencePlayer.js';

test('SequencePlayer starts with an empty sequence', () => {
    const player = new SequencePlayer();

    assert.deepEqual(player.sequence, { steps: [] });
});

test('SequencePlayer interpolates a resolved joint step and preserves context', () => {
    let nowMs = 0;
    let appliedJointState = [];
    let completedCube = null;
    let completedContext = null;
    let reachedStep = null;
    const targetObject = new Object3D();
    const cubeItem = { mesh: new Object3D() };
    const player = new SequencePlayer({
        sequence: {
            steps: [
                {
                    id: 'conditional-return',
                    type: 'joint',
                    target: { kind: 'test', pose: 'return' },
                    durationMs: 1000,
                    when: 'returnViaWaypoint',
                },
                {
                    id: 'waypoint',
                    type: 'joint',
                    target: { kind: 'test', pose: 'waypoint' },
                    durationMs: 1000,
                },
            ],
        },
        chain: {
            roboticArm: new Object3D(),
            joints: [],
            getActuator: () => null,
        },
        getTargetObject: () => targetObject,
        getInitialQ: () => [0, 1],
        isCubeValid: () => true,
        now: () => nowMs,
        resolveJointState: (target, context, outJointState) => {
            assert.equal(target.pose, 'waypoint');
            assert.deepEqual(context.currentJointState, [0, 1]);
            assert.equal(context.sequenceContext.jobId, 7);
            outJointState.push(2, 3);
            return true;
        },
        applyQToChain: (jointState) => {
            appliedJointState = jointState.slice();
        },
        onPoseReached: (step) => {
            reachedStep = step;
        },
        onComplete: (cube, context) => {
            completedCube = cube;
            completedContext = context;
        },
    });

    assert.equal(player.startPickSequence(cubeItem, { jobId: 7 }), true);
    nowMs = 500;
    assert.equal(player.updateStageLerp(), true);
    assert.deepEqual(appliedJointState, [1, 2]);
    assert.equal(reachedStep, null);

    nowMs = 1000;
    assert.equal(player.updateStageLerp(), true);
    assert.deepEqual(appliedJointState, [2, 3]);
    assert.equal(reachedStep.id, 'waypoint');
    assert.equal(player.isActive(), false);
    assert.equal(completedCube, cubeItem);
    assert.deepEqual(completedContext, { jobId: 7 });
});

test('SequencePlayer plays recorded joint steps without a cube', () => {
    let nowMs = 0;
    let completedCube = 'not completed';
    let completedContext = null;
    const targetObject = new Object3D();
    const player = new SequencePlayer({
        sequence: {
            steps: [
                {
                    id: 'preview-pose',
                    type: 'joint',
                    target: { kind: 'test', pose: 'preview' },
                    durationMs: 100,
                },
            ],
        },
        chain: {
            roboticArm: new Object3D(),
            joints: [],
            getActuator: () => null,
        },
        getTargetObject: () => targetObject,
        getInitialQ: () => [0],
        isCubeValid: () => false,
        now: () => nowMs,
        resolveJointState: (_target, _context, outJointState) => {
            outJointState.push(1);
            return true;
        },
        onComplete: (cube, context) => {
            completedCube = cube;
            completedContext = context;
        },
    });

    assert.equal(player.startSequence({ playbackMode: 'preview' }), true);
    nowMs = 100;
    assert.equal(player.updateStageLerp(), true);
    assert.equal(player.isActive(), false);
    assert.equal(completedCube, null);
    assert.deepEqual(completedContext, { playbackMode: 'preview' });
});

test('SequencePlayer keeps the target control on the FK pose during joint playback', () => {
    let nowMs = 0;
    let appliedJointValue = 0;
    const targetObject = new Object3D();
    const actuator = {
        getGripWorldPosition: (outPosition) => {
            outPosition.set(
                appliedJointValue,
                appliedJointValue * 2,
                appliedJointValue * 3,
            );
        },
        getGripWorldQuaternion: (outQuaternion) => {
            outQuaternion.setFromEuler(
                new Euler(0, appliedJointValue, 0, 'XYZ'),
            );
        },
    };
    const player = new SequencePlayer({
        sequence: {
            steps: [
                {
                    id: 'preview-pose',
                    type: 'joint',
                    target: { kind: 'test', pose: 'preview' },
                    durationMs: 1000,
                },
            ],
        },
        chain: {
            roboticArm: new Object3D(),
            joints: [],
            getActuator: () => actuator,
        },
        getTargetObject: () => targetObject,
        getInitialQ: () => [0],
        now: () => nowMs,
        resolveJointState: (_target, _context, outJointState) => {
            outJointState.push(2);
            return true;
        },
        applyQToChain: (jointState) => {
            [appliedJointValue] = jointState;
        },
    });

    assert.equal(player.startSequence(), true);
    nowMs = 500;
    assert.equal(player.updateStageLerp(), true);
    assert.equal(appliedJointValue, 1);
    assert.deepEqual(targetObject.position.toArray(), [1, 2, 3]);
    const expectedQuaternion = new Quaternion().setFromEuler(
        new Euler(0, 1, 0, 'XYZ'),
    );
    assert.ok(targetObject.quaternion.angleTo(expectedQuaternion) < 1e-12);
    assert.equal(player.isActive(), true);
});

test('SequencePlayer opens an actuator over the configured grip duration', () => {
    let nowMs = 0;
    let openRatio = 0.2;
    const targetObject = new Object3D();
    const actuator = {
        getOpenRatio: () => openRatio,
        setOpenRatio: (value) => {
            openRatio = value;
        },
        getJawInnerGap: () => openRatio,
    };
    const player = new SequencePlayer({
        sequence: {
            steps: [
                {
                    id: 'release',
                    type: 'grip',
                    mode: 'open',
                    durationMs: 400,
                },
            ],
        },
        chain: {
            roboticArm: new Object3D(),
            joints: [],
            getActuator: () => actuator,
        },
        getTargetObject: () => targetObject,
        getInitialQ: () => [],
        isCubeValid: () => true,
        now: () => nowMs,
    });

    assert.equal(player.startPickSequence({ mesh: new Object3D() }), true);
    nowMs = 200;
    player.afterPhysicsStep();
    assert.ok(Math.abs(openRatio - 0.6) < 1e-12);
    assert.equal(player.isActive(), true);

    nowMs = 400;
    player.afterPhysicsStep();
    assert.equal(openRatio, 1);
    assert.equal(player.isActive(), false);
});

test('SequencePlayer interpolates generated Euler channels with smooth timing', () => {
    let nowMs = 0;
    const targetObject = new Object3D();
    const targetQuaternion = new Quaternion().setFromEuler(
        new Euler(0, 0, Math.PI / 2, 'XYZ'),
    );
    const player = new SequencePlayer({
        sequence: {
            steps: [
                {
                    id: 'recorded-pose',
                    type: 'move',
                    target: { kind: 'recorded', id: 1 },
                    durationMs: 1000,
                    interpolation: 'smooth',
                    rotationInterpolation: 'eulerXYZ',
                    completion: 'time',
                },
            ],
        },
        chain: {
            roboticArm: new Object3D(),
            joints: [],
            getActuator: () => null,
        },
        getTargetObject: () => targetObject,
        getInitialQ: () => [],
        isCubeValid: () => true,
        now: () => nowMs,
        resolveTarget: (_target, _context, outPosition, outQuaternion) => {
            outPosition.copy(new Vector3(1, 2, 3));
            outQuaternion.copy(targetQuaternion);
            return true;
        },
    });

    assert.equal(player.startPickSequence({ mesh: new Object3D() }), true);
    nowMs = 500;
    assert.equal(player.updateStageLerp(), true);
    assert.deepEqual(targetObject.position.toArray(), [0.5, 1, 1.5]);
    const halfwayQuaternion = new Quaternion().setFromEuler(
        new Euler(0, 0, Math.PI / 4, 'XYZ'),
    );
    assert.ok(targetObject.quaternion.angleTo(halfwayQuaternion) < 1e-12);
});


test('SequencePlayer cancels pending IK before recorded joint playback and manual joints', () => {
    let nowMs = 0;
    let appliedJointState;
    const targetObject = new Object3D();
    const player = new SequencePlayer({
        chain: { roboticArm: new Object3D(), joints: [], getActuator: () => null },
        getTargetObject: () => targetObject,
        getInitialQ: () => [0],
        now: () => nowMs,
        applyQToChain: (q) => { appliedJointState = q.slice(); },
        sequence: { steps: [{ type: 'joint', target: { chainPose: [1] }, durationMs: 1000 }] },
    });
    player.queueSolveFromTarget();
    assert.equal(player.hasPendingSolve(), true);
    assert.equal(player.startSequence(), true);
    nowMs = 500;
    player.updateStageLerp();
    player.solveIfPending();
    assert.deepEqual(appliedJointState, [0.5]);
    assert.equal(player.hasPendingSolve(), false);

    player.queueSolveFromTarget();
    assert.equal(player.setJointState([0.25]), true);
    player.solveIfPending();
    assert.deepEqual(appliedJointState, [0.25]);
    assert.equal(player.hasPendingSolve(), false);
});

test('SequencePlayer rejects a recorded joint pose outside model limits', () => {
    const errors = [];
    const player = new SequencePlayer({
        chain: { roboticArm: new Object3D(), joints: [{ minAngle: -90, maxAngle: 90 }], getActuator: () => null },
        getTargetObject: () => new Object3D(),
        getInitialQ: () => [0],
        onError: (error) => errors.push(error),
        sequence: { steps: [{ type: 'joint', target: { chainPose: [Math.PI] }, durationMs: 100 }] },
    });
    assert.equal(player.setJointState([Math.PI]), false);
    assert.deepEqual(player.getJointState(), [0]);
    assert.equal(player.startSequence(), false);
    assert.equal(player.isActive(), false);
    assert.equal(errors.length, 2);
    assert.equal(errors[0].code, 'invalid-joint-state');
    assert.equal(errors[1].code, 'invalid-joint-state');
});

function createStationarySolverPlayer({ rotationError = 0, ...options } = {}) {
    const targetObject = new Object3D();
    const orientation = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), rotationError);
    return new SequencePlayer({
        chain: {
            roboticArm: new Object3D(),
            joints: [],
            getActuator: () => null,
            getActuatorWorldPosition: (out) => out.set(0, 0, 0),
            getActuatorWorldQuaternion: (out) => out.copy(orientation),
        },
        getTargetObject: () => targetObject,
        getInitialQ: () => [0],
        solverMethod: 'DLS',
        solveMode: 'Position + Rotation',
        tolerance: 0.006,
        rotationTolerance: 0.03,
        ...options,
    });
}

test('SequencePlayer accepts the same position and rotation tolerances as DLS', () => {
    const player = createStationarySolverPlayer({ rotationError: 0.02 });
    player.queueSolveFromTarget();
    player.solveIfPending();
    assert.equal(player.hasPendingSolve(), false);
    assert.equal(player.getSolveMetrics().converged, true);
    assert.ok(player.getSolveMetrics().rotationError > 0.006);
});

test('SequencePlayer stops a stalled manual target and reports a failure', () => {
    let nowMs = 0;
    const errors = [];
    const player = createStationarySolverPlayer({
        rotationError: Math.PI / 2,
        now: () => nowMs,
        solveStallTimeoutMs: 100,
        onError: (error) => errors.push(error),
    });
    player.queueSolveFromTarget();
    player.solveIfPending();
    assert.equal(player.hasPendingSolve(), true);
    nowMs = 101;
    player.solveIfPending();
    assert.equal(player.hasPendingSolve(), false);
    assert.equal(errors.length, 1);
    assert.equal(errors[0].code, 'solve-stalled');
    assert.equal(player.getSolveMetrics().failed, true);
    player.solveIfPending();
    assert.equal(errors.length, 1);
});

test('SequencePlayer does not report a reached pose when orientation settling times out', () => {
    let nowMs = 0;
    let reached = 0;
    let completed = 0;
    const errors = [];
    const player = createStationarySolverPlayer({
        rotationError: Math.PI / 2,
        now: () => nowMs,
        moveSettleTimeoutMs: 100,
        solveStallTimeoutMs: 1000,
        onPoseReached: () => { reached++; },
        onComplete: () => { completed++; },
        onError: (error) => errors.push(error),
        resolveTarget: (_spec, _context, position, quaternion) => {
            position.set(0, 0, 0);
            quaternion.identity();
            return true;
        },
        sequence: { steps: [{ type: 'move', target: {}, durationMs: 1, completion: 'solve' }] },
    });
    assert.equal(player.startSequence(), true);
    nowMs = 1;
    player.updateStageLerp();
    player.solveIfPending();
    assert.equal(player.isActive(), true);
    nowMs = 102;
    player.solveIfPending();
    assert.equal(player.isActive(), false);
    assert.equal(player.hasPendingSolve(), false);
    assert.equal(reached, 0);
    assert.equal(completed, 0);
    assert.equal(errors[0].code, 'solve-timeout');
});

test('SequencePlayer measures opening with the custom jaw gap in both frames', () => {
    let gap = 0.025;
    const actuator = { getJawInnerGap: () => 0.001 };
    const player = new SequencePlayer({
        chain: { getActuator: () => actuator },
        getJawInnerGap: () => gap,
        isCubeValid: () => true,
    });
    let released = 0;
    player._graspJoint = {};
    player._graspedCube = { size: 0.02 };
    player.releaseGraspJoint = () => { released++; };
    player.afterPhysicsStep();
    player.afterPhysicsStep();
    assert.equal(released, 0);
    gap = 0.03;
    player.afterPhysicsStep();
    assert.equal(released, 1);
});


test('SequencePlayer rejects sparse manual joints and clears motion before reporting failure', () => {
    let errorCount = 0;
    let appliedCount = 0;
    let nowMs = 0;
    const player = new SequencePlayer({
        getTargetObject: () => new Object3D(),
        getInitialQ: () => [0, 0],
        now: () => nowMs,
        applyQToChain: () => { appliedCount++; },
        sequence: {
            steps: [{ id: 'moving', type: 'joint', target: { chainPose: [1, 1] }, durationMs: 100 }],
        },
        onError: (error) => {
            errorCount++;
            assert.equal(error.code, 'invalid-joint-state');
            assert.equal(error.stepId, 'moving');
            assert.equal(player.isActive(), false);
            assert.equal(player.isLerping(), false);
            assert.equal(player.hasPendingSolve(), false);
            player.reset();
        },
    });
    assert.equal(player.startSequence(), true);
    assert.equal(player.setJointState(new Array(2)), false);
    assert.deepEqual(player.getJointState(), [0, 0]);
    nowMs = 200;
    assert.equal(player.updateStageLerp(), false);
    player.solveIfPending();
    player.afterPhysicsStep();
    assert.equal(appliedCount, 0);
    assert.equal(errorCount, 1);
});

test('SequencePlayer does not resolve a replacement for an invalid explicit joint snapshot', () => {
    let resolverCalls = 0;
    const errors = [];
    const player = new SequencePlayer({
        getTargetObject: () => new Object3D(),
        getInitialQ: () => [0],
        resolveJointState: (_target, _context, out) => {
            resolverCalls++;
            out.push(1);
            return true;
        },
        onError: (error) => errors.push(error),
    });
    for (const chainPose of [null, new Array(1), [NaN], []]) {
        player.loadSequence({ steps: [{
            type: 'joint',
            target: { chainPose },
            pose: { chainPose: [1] },
            durationMs: 100,
        }] });
        assert.equal(player.startSequence(), false);
        assert.equal(player.isActive(), false);
        assert.deepEqual(player.getJointState(), [0]);
    }
    assert.equal(resolverCalls, 0);
    assert.equal(errors.length, 4);
});

test('SequencePlayer direct joint edits stop playback before it can overwrite them', () => {
    let nowMs = 0;
    const player = new SequencePlayer({
        getTargetObject: () => new Object3D(),
        getInitialQ: () => [0],
        now: () => nowMs,
        sequence: {
            steps: [{ type: 'joint', target: { chainPose: [1] }, durationMs: 100 }],
        },
    });
    assert.equal(player.startSequence(), true);
    nowMs = 50;
    player.updateStageLerp();
    assert.deepEqual(player.getJointState(), [0.5]);
    assert.equal(player.setJointState([0.25]), true);
    assert.equal(player.isActive(), false);
    nowMs = 100;
    assert.equal(player.updateStageLerp(), false);
    player.solveIfPending();
    assert.deepEqual(player.getJointState(), [0.25]);
});


test('SequencePlayer ignores IK requests while a joint trajectory owns the pose', () => {
    let nowMs = 0;
    const targetObject = new Object3D();
    const player = createStationarySolverPlayer({
        getTargetObject: () => targetObject,
        now: () => nowMs,
        sequence: {
            steps: [{ type: 'joint', target: { chainPose: [1] }, durationMs: 100 }],
        },
    });
    assert.equal(player.startSequence(), true);
    targetObject.position.set(1, 0, 0);
    player.queueSolveFromTarget();
    assert.equal(player.hasPendingSolve(), false);
    nowMs = 50;
    player.updateStageLerp();
    player.solveIfPending();
    assert.deepEqual(player.getJointState(), [0.5]);
    assert.equal(player.getSolveRevision(), 0);
    player.clear();
    player.queueSolveFromTarget();
    assert.equal(player.hasPendingSolve(), true);
});
