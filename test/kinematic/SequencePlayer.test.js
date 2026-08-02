import assert from 'node:assert/strict';
import test from 'node:test';
import { Euler, Object3D, Quaternion, Vector3 } from 'three';
import { SequencePlayer } from '../../extend/kinematic/SequencePlayer.js';

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
