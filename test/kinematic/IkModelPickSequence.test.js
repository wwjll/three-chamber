import assert from 'node:assert/strict';
import test from 'node:test';
import { Object3D } from 'three';
import { SequencePlayer } from '../../extend/kinematic/SequencePlayer.js';
import {
    createPickAndReturnSequence,
    createTrajectoryPreviewSequence,
} from '../../examples/ikModelPickSequence.js';

function recordedSequence() {
    return {
        name: 'test-route',
        steps: [0, 1, 2].flatMap((angle, index) => [
            {
                id: `pose-${index}`,
                type: 'joint',
                keyframeId: `frame-${index}`,
                keyframeIndex: index,
                keyframeKind: 'recorded',
                keyframeLabel: `Frame ${index}`,
                target: { chainPose: [angle] },
                durationMs: 300 + index * 100,
            },
            { id: `grip-${index}`, type: 'grip', mode: 'open', durationMs: 100, target: undefined },
            { id: `wait-${index}`, type: 'wait', durationMs: 100, target: undefined },
        ]),
    };
}

for (const [label, current, expected] of [
    ['last keyframe', 2, [1, 0]],
    ['middle keyframe', 1, [0]],
    ['first keyframe', 0, []],
    ['manually edited pose', 1.2, [1, 0]],
]) {
    test(`Pick sequence rejoins the route from the ${label} before targeting a cube`, () => {
        const source = recordedSequence();
        const snapshot = structuredClone(source);
        const sequence = createPickAndReturnSequence(source, {
            currentChainPose: [current], gripDurationMs: 450,
        });
        const firstCubeStep = sequence.steps.findIndex((step) => step.dynamicCubeTarget);
        const approach = sequence.steps.slice(0, firstCubeStep);
        assert.deepEqual(approach.map((step) => step.keyframeIndex), expected);
        assert.ok(approach.every((step) => step.type === 'joint' && step.approachStep));
        assert.equal(sequence.steps[firstCubeStep].id, 'dynamic-cube-target-pose');
        assert.deepEqual(sequence.steps.slice(firstCubeStep + 3, firstCubeStep + 3 + source.steps.length), source.steps);
        assert.deepEqual(sequence.steps.filter((step) => step.returnStep).map((step) => step.keyframeIndex), [1, 0]);
        assert.deepEqual(source, snapshot);
    });
}

test('Pick sequence refuses to target a cube without a recorded joint route', () => {
    assert.equal(createPickAndReturnSequence({ name: 'empty', steps: [] }, {
        currentChainPose: [0], gripDurationMs: 450,
    }), null);
});

test('Pick startup plays intermediate joints before resolving the dynamic cube target', () => {
    let nowMs = 0;
    let cubeTargetResolutions = 0;
    const applied = [];
    const reached = [];
    const target = new Object3D();
    const player = new SequencePlayer({
        chain: { roboticArm: new Object3D(), joints: [], getActuator: () => null },
        getTargetObject: () => target,
        getInitialQ: () => [2],
        now: () => nowMs,
        isCubeValid: () => true,
        applyQToChain: (q) => applied.push(q.slice()),
        onPoseReached: (step) => reached.push(step.keyframeIndex),
        resolveTarget: (_spec, _context, position, quaternion) => {
            cubeTargetResolutions++;
            position.set(0.2, 0.3, 0.4);
            quaternion.identity();
            return true;
        },
    });
    player.queueSolveFromTarget();
    player.loadSequence(createPickAndReturnSequence(recordedSequence(), {
        currentChainPose: player.getJointState(), gripDurationMs: 450,
    }));
    assert.equal(player.startPickSequence({}), true);
    assert.deepEqual(player.getJointState(), [2]);
    assert.deepEqual(applied, []);
    assert.equal(cubeTargetResolutions, 0);

    nowMs = 200;
    player.updateStageLerp();
    player.solveIfPending();
    assert.deepEqual(player.getJointState(), [1.5]);
    nowMs = 400;
    player.updateStageLerp();
    assert.deepEqual(player.getJointState(), [1]);
    assert.deepEqual(reached, [1]);
    assert.equal(cubeTargetResolutions, 0);
    nowMs = 700;
    player.updateStageLerp();
    assert.deepEqual(player.getJointState(), [0]);
    assert.deepEqual(reached, [1, 0]);
    assert.equal(player.getSolveRevision(), 0);
    assert.equal(cubeTargetResolutions, 1);
});

test('Trajectory preview still follows the forward route without gripper actions', () => {
    const source = recordedSequence();
    assert.deepEqual(createTrajectoryPreviewSequence(source).steps,
        source.steps.filter((step) => step.type !== 'grip').map((step) => ({
            ...step, target: step.target ? { ...step.target } : undefined,
        })));
});
