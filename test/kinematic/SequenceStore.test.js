import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeSequenceKeyframes } from '../../extend/kinematic/SequenceStore.js';

test('normalizeSequenceKeyframes stores recorded trajectory and chain poses', () => {
    const sourcePosition = [0.1, 0.2, 0.3];
    const sourceChainPose = [0, 1, 2, 3, 4, 5];
    const normalized = normalizeSequenceKeyframes([
        {
            id: 'keyframe-7',
            label: 'Carry',
            kind: 'recorded',
            position: sourcePosition,
            rotation: [10, 20, 30],
            chainPose: sourceChainPose,
            durationMs: 650,
            holdMs: 80,
            gripAction: 'open',
            gripDurationMs: 400,
        },
        {
            id: 'dynamic-target',
            kind: 'resolver',
        },
    ]);

    assert.deepEqual(normalized, [
        {
            id: 'keyframe-7',
            label: 'Carry',
            kind: 'recorded',
            position: [0.1, 0.2, 0.3],
            rotation: [10, 20, 30],
            chainPose: [0, 1, 2, 3, 4, 5],
            durationMs: 650,
            holdMs: 80,
            gripAction: 'open',
            gripDurationMs: 400,
        },
    ]);
    assert.notEqual(normalized[0].position, sourcePosition);
    assert.notEqual(normalized[0].chainPose, sourceChainPose);
});

test('normalizeSequenceKeyframes migrates legacy joint arrays to chain poses', () => {
    const [normalized] = normalizeSequenceKeyframes([
        {
            id: 'legacy',
            kind: 'recorded',
            position: [0, 0, 0],
            rotation: [0, 0, 0],
            joints: [0, 1, 2, 3, 4, 5],
        },
    ]);

    assert.deepEqual(normalized.chainPose, [0, 1, 2, 3, 4, 5]);
    assert.equal('joints' in normalized, false);
});

test('normalizeSequenceKeyframes rejects incomplete chain poses', () => {
    const normalized = normalizeSequenceKeyframes([
        {
            id: 'incomplete-chain',
            kind: 'recorded',
            position: [0, 0, 0],
            rotation: [0, 0, 0],
            chainPose: [0, 1],
        },
    ]);

    assert.deepEqual(normalized, []);
});
