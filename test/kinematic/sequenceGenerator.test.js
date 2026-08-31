import assert from 'node:assert/strict';
import test from 'node:test';
import {
    Euler,
    MathUtils,
    Object3D,
    Quaternion,
    Scene,
    Vector3,
} from 'three';
import {
    CLOSE_ACTION,
    OPEN_ACTION,
    SequenceGenerator,
} from '../../extend/kinematic/SequenceGenerator.js';

test('SequenceGenerator compiles dynamic and recorded keyframes in timeline order', () => {
    const targetObject = new Object3D();
    targetObject.position.set(0.2, 0.3, 0.4);
    targetObject.rotation.set(0.1, 0.2, 0.3);
    const generator = new SequenceGenerator({
        targetObject,
        defaultDurationMs: 400,
        defaultGripDurationMs: 250,
        getCurrentChainPose: () => [0, 0.1, 0.2, 0.3, 0.4, 0.5],
    });

    generator.addResolverKeyframe({
        id: 'cube-target',
        label: 'Cube target',
        resolver: (context, outPosition, outQuaternion) => {
            outPosition.copy(context.cubeItem.position);
            outQuaternion.identity();
            return true;
        },
        durationMs: 300,
        holdMs: 20,
        gripAction: CLOSE_ACTION,
    });
    const recorded = generator.addRecordedKeyframe({
        label: 'Basket',
        durationMs: 600,
        holdMs: 0,
        gripAction: OPEN_ACTION,
    });
    const sequence = generator.buildSequence();

    assert.deepEqual(
        sequence.steps.map((step) => step.type),
        ['move', 'wait', 'grip', 'joint', 'grip'],
    );
    assert.equal(sequence.steps[0].keyframeLabel, 'Cube target');
    assert.equal(sequence.steps[0].keyframeKind, 'resolver');
    assert.equal(sequence.steps[2].mode, CLOSE_ACTION);
    assert.equal(sequence.steps[3].durationMs, 600);
    assert.equal(sequence.steps[3].keyframeKind, 'recorded');
    assert.equal(sequence.steps[4].mode, OPEN_ACTION);
    assert.equal(sequence.steps[0].rotationInterpolation, 'eulerXYZ');
    assert.equal(sequence.steps[3].type, 'joint');
    assert.equal(sequence.steps[3].solveWhileLerping, undefined);
    assert.deepEqual(recorded.position, [0.2, 0.3, 0.4]);
    assert.equal(recorded.rotation.length, 3);
    assert.deepEqual(
        recorded.chainPose,
        [0, 0.1, 0.2, 0.3, 0.4, 0.5],
    );
    const resolvedJoints = [];
    assert.equal(
        generator.resolveJointState(
            sequence.steps[3].target,
            {},
            resolvedJoints,
        ),
        true,
    );
    assert.deepEqual(resolvedJoints, recorded.chainPose);
});

test('SequenceGenerator resolves live and recorded Euler targets', () => {
    const generator = new SequenceGenerator();
    const livePosition = new Vector3(1, 2, 3);
    const liveQuaternion = new Quaternion().setFromAxisAngle(
        new Vector3(0, 1, 0),
        Math.PI / 2,
    );
    generator.addResolverKeyframe({
        id: 'live',
        resolver: (context, outPosition, outQuaternion) => {
            outPosition.copy(context.cubeItem.position);
            outQuaternion.copy(context.cubeItem.quaternion);
            return true;
        },
    });
    generator.keyframes.push({
        id: 'recorded',
        label: 'Recorded',
        kind: 'recorded',
        position: [0, 0, 0],
        rotation: [10, 20, 30],
        durationMs: 100,
        holdMs: 0,
        gripAction: 'hold',
        gripDurationMs: 100,
    });

    const outPosition = new Vector3();
    const outQuaternion = new Quaternion();
    assert.equal(
        generator.resolveTarget(
            { kind: 'sequenceKeyframe', keyframeId: 'live' },
            {
                cubeItem: {
                    position: livePosition,
                    quaternion: liveQuaternion,
                },
            },
            outPosition,
            outQuaternion,
        ),
        true,
    );
    assert.deepEqual(outPosition.toArray(), livePosition.toArray());
    assert.ok(outQuaternion.angleTo(liveQuaternion) < 1e-12);

    const expectedQuaternion = new Quaternion().setFromEuler(
        new Euler(
            MathUtils.degToRad(10),
            MathUtils.degToRad(20),
            MathUtils.degToRad(30),
            'XYZ',
        ),
    );
    assert.equal(
        generator.resolveTarget(
            { kind: 'sequenceKeyframe', keyframeId: 'recorded' },
            {},
            outPosition,
            outQuaternion,
        ),
        true,
    );
    assert.deepEqual(outPosition.toArray(), [0, 0, 0]);
    assert.ok(outQuaternion.angleTo(expectedQuaternion) < 1e-7);
});

test('SequenceGenerator rejects a recorded frame before IK reaches the target', () => {
    const targetObject = new Object3D();
    targetObject.position.set(0.2, 0, 0);
    let status = '';
    const generator = new SequenceGenerator({
        targetObject,
        getCurrentPose: (outPosition, outQuaternion) => {
            outPosition.set(0, 0, 0);
            outQuaternion.identity();
            return true;
        },
        onStatus: (message) => {
            status = message;
        },
        getCurrentChainPose: () => [0, 0.1, 0.2, 0.3, 0.4, 0.5],
        recordPositionTolerance: 0.01,
    });

    assert.equal(generator.addRecordedKeyframe(), null);
    assert.equal(generator.getKeyframes().length, 0);
    assert.match(status, /IK target not settled/);

    const preset = generator.addRecordedKeyframe({
        label: 'Preset',
        position: [0.3, 0.2, -0.1],
        rotation: [-0.5, 0.5, -90],
        durationMs: 500,
    });
    assert.deepEqual(preset.position, [0.3, 0.2, -0.1]);
    assert.deepEqual(preset.rotation, [-0.5, 0.5, -90]);
});

test('SequenceGenerator waits for IK before recording the solved chain pose', async () => {
    const targetObject = new Object3D();
    targetObject.position.set(0.25, 0.3, -0.15);
    const currentPosition = new Vector3();
    const currentQuaternion = new Quaternion();
    let currentJoints = [0, 0, 0, 0, 0, 0];
    let pendingSolve = false;
    let solveRevision = 0;
    const solvedJoints = [0.2, -0.4, 0.6, -0.8, 1, -1.2];
    const sequencePlayer = {
        queueSolveFromTarget() {
            pendingSolve = true;
            setTimeout(() => {
                currentPosition.copy(targetObject.position);
                currentQuaternion.copy(targetObject.quaternion);
                currentJoints = solvedJoints.slice();
                solveRevision += 1;
                pendingSolve = false;
            }, 5);
        },
        hasPendingSolve: () => pendingSolve,
        isSolving: () => false,
        getSolveRevision: () => solveRevision,
    };
    const generator = new SequenceGenerator({
        targetObject,
        sequencePlayer,
        getCurrentPose: (outPosition, outQuaternion) => {
            outPosition.copy(currentPosition);
            outQuaternion.copy(currentQuaternion);
            return true;
        },
        getCurrentChainPose: () => currentJoints,
    });

    const recording = generator.addRecordedKeyframeAfterSolve();
    assert.equal(generator.getKeyframes().length, 0);

    const recorded = await recording;
    assert.equal(generator.getKeyframes().length, 1);
    assert.deepEqual(recorded.position, targetObject.position.toArray());
    assert.deepEqual(recorded.chainPose, solvedJoints);
});

test('SequenceGenerator records the reached end pose instead of the requested target', () => {
    const targetObject = new Object3D();
    targetObject.position.set(0.2, 0.3, -0.1);
    const reachedPosition = new Vector3(0.195, 0.302, -0.098);
    const reachedQuaternion = new Quaternion().setFromEuler(
        new Euler(0.03, -0.02, 0.01, 'XYZ'),
    );
    const generator = new SequenceGenerator({
        targetObject,
        getCurrentPose: (outPosition, outQuaternion) => {
            outPosition.copy(reachedPosition);
            outQuaternion.copy(reachedQuaternion);
            return true;
        },
        getCurrentChainPose: () => [0, 0.1, 0.2, 0.3, 0.4, 0.5],
        recordPositionTolerance: 0.01,
        recordRotationTolerance: 0.1,
    });

    const recorded = generator.addRecordedKeyframe();
    const recordedQuaternion = new Quaternion().setFromEuler(
        new Euler(
            MathUtils.degToRad(recorded.rotation[0]),
            MathUtils.degToRad(recorded.rotation[1]),
            MathUtils.degToRad(recorded.rotation[2]),
            'XYZ',
        ),
    );

    assert.deepEqual(recorded.position, reachedPosition.toArray());
    assert.ok(recordedQuaternion.angleTo(reachedQuaternion) < 1e-7);
});

test('SequenceGenerator ignores rotation mismatch when orientation is unconstrained', () => {
    const targetObject = new Object3D();
    targetObject.quaternion.setFromEuler(new Euler(0, Math.PI / 2, 0));
    const generator = new SequenceGenerator({
        targetObject,
        getCurrentPose: (outPosition, outQuaternion) => {
            outPosition.copy(targetObject.position);
            outQuaternion.identity();
            return true;
        },
        getCurrentChainPose: () => [0, 0, 0, 0, 0, 0],
        isOrientationConstrained: () => false,
    });

    const recorded = generator.addRecordedKeyframe();

    assert.ok(recorded);
});

test('SequenceGenerator renders trajectory independently from end controls', () => {
    const scene = new Scene();
    const targetObject = new Object3D();
    let sampleCount = 0;
    const generator = new SequenceGenerator({
        scene,
        targetObject,
        visualizationVisible: false,
        trajectoryVisible: true,
        sampleChainPose: (chainPose, outPosition, outQuaternion) => {
            sampleCount++;
            outPosition.set(
                chainPose[0],
                chainPose[0] * chainPose[0],
                0,
            );
            outQuaternion.identity();
            return true;
        },
    });
    generator.addRecordedKeyframe({
        position: [0.1, 0.2, 0.3],
        rotation: [0, 0, 0],
        chainPose: [0, 0, 0, 0, 0, 0],
    });
    generator.addRecordedKeyframe({
        position: [0.2, 0.25, 0.35],
        rotation: [0, 0, 0],
        chainPose: [1, 0, 0, 0, 0, 0],
    });
    generator.addRecordedKeyframe({
        position: [0.25, 0.3, 0.2],
        rotation: [0, 0, 0],
        chainPose: [2, 0, 0, 0, 0, 0],
    });

    const trajectoryGroup = scene.getObjectByName(
        'sequenceGeneratorKeyframes',
    );
    assert.equal(trajectoryGroup.visible, true);
    assert.equal(
        trajectoryGroup.children.filter(
            (child) => child.userData.sequenceKeyframeMarker,
        ).length,
        3,
    );
    assert.equal(
        trajectoryGroup.children.filter(
            (child) => child.userData.sequenceTrajectory,
        ).length,
        1,
    );
    const trajectory = trajectoryGroup.children.find(
        (child) => child.userData.sequenceTrajectory,
    );
    const sampledCurves = trajectory.geometry.parameters.path.curves;
    assert.equal(sampledCurves.length, 64);
    assert.ok(Math.abs(sampledCurves[15].v2.x - 0.5) < 1e-12);
    assert.ok(Math.abs(sampledCurves[15].v2.y - 0.25) < 1e-12);

    const samplesBeforeSelection = sampleCount;
    generator.selectKeyframe(0, { preview: false });
    assert.equal(
        trajectoryGroup.children.find(
            (child) => child.userData.sequenceTrajectory,
        ),
        trajectory,
    );
    assert.equal(sampleCount, samplesBeforeSelection);
    const markers = trajectoryGroup.children.filter(
        (child) => child.userData.sequenceKeyframeMarker,
    );
    assert.equal(markers[0].material.color.getHex(), 0xffd166);
    assert.equal(markers[2].material.color.getHex(), 0x62d4a8);

    generator.setVisualizationVisible(false);
    assert.equal(trajectoryGroup.visible, true);
    generator.setTrajectoryVisible(false);
    assert.equal(trajectoryGroup.visible, false);
    generator.dispose();
});

test('SequenceGenerator toggles one playback control between play and stop', () => {
    const targetObject = new Object3D();
    let stopped = false;
    const generator = new SequenceGenerator({
        targetObject,
        onPlay: () => true,
        getCurrentChainPose: () => [0, 0.1, 0.2, 0.3, 0.4, 0.5],
        onStop: () => {
            stopped = true;
        },
    });
    generator.addRecordedKeyframe({
        position: [0.2, 0.3, 0.4],
        rotation: [0, 0, -90],
    });
    assert.equal(generator.togglePlayback(), true);
    assert.equal(generator.getContext(), null);
    assert.equal(generator.isPlaybackActive(), true);
    assert.equal(generator.togglePlayback(), false);
    assert.equal(generator.isPlaybackActive(), false);
    assert.equal(stopped, true);
});

test('SequenceGenerator preserves stored ids and advances the id counter', () => {
    const generator = new SequenceGenerator({
        targetObject: new Object3D(),
        getCurrentChainPose: () => [0, 0, 0, 0, 0, 0],
    });
    const restored = generator.addRecordedKeyframe({
        id: 'keyframe-12',
        position: [0.2, 0.3, 0.4],
        rotation: [0, 0, -90],
    });
    const added = generator.addRecordedKeyframe({
        position: [0.3, 0.4, 0.5],
        rotation: [0, 0, -90],
    });

    assert.equal(restored.id, 'keyframe-12');
    assert.equal(added.id, 'keyframe-13');
});

test('SequenceGenerator loads recorded keyframes with one sequence commit', () => {
    let commitCount = 0;
    const generator = new SequenceGenerator({
        targetObject: new Object3D(),
        onSequenceChange: () => {
            commitCount++;
        },
    });
    const recorded = generator.addRecordedKeyframes([
        {
            label: 'First',
            position: [0.2, 0.3, 0.4],
            rotation: [0, 0, -90],
            chainPose: [0, 0.1, 0.2, 0.3, 0.4, 0.5],
        },
        {
            label: 'Second',
            position: [0.3, 0.4, 0.5],
            rotation: [0, 0, -90],
            chainPose: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6],
        },
    ], { selectedIndex: 0 });

    assert.equal(recorded.length, 2);
    assert.equal(commitCount, 1);
    assert.equal(generator.getKeyframes().length, 2);
    assert.equal(generator.getSelectedKeyframe().label, 'First');
});
