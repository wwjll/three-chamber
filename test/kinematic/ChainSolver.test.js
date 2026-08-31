import assert from 'node:assert/strict';
import test from 'node:test';
import { Quaternion, Vector3 } from 'three';
import { ChainSolver } from '../../extend/kinematic/ChainSolver.js';

test('ChainSolver runs only the selected IK method', () => {
    const solver = new ChainSolver();
    const calls = [];
    solver.solveJacobianTranspose = (q) => {
        calls.push('Jacobian');
        return q.slice();
    };
    solver.solveDampedLeastSquares = (q) => {
        calls.push('DLS');
        return q.slice();
    };

    solver.solverMethod = 'Jacobian';
    solver.solve([0, 0]);
    assert.deepEqual(calls, ['Jacobian']);

    calls.length = 0;
    solver.solverMethod = 'DLS';
    solver.solve([0, 0]);
    assert.deepEqual(calls, ['DLS']);
});

test('ChainSolver DLS converges on a reachable revolute target', () => {
    const endPosition = new Vector3(1, 0, 0);
    const identity = new Quaternion();
    const solver = new ChainSolver({
        targetPosition: new Vector3(0, 1, 0),
        chain: {
            getActuatorWorldPosition: (out) => out.copy(endPosition),
            getActuatorWorldQuaternion: (out) => out.copy(identity),
        },
        joints: [{
            getWorldPosition: (out) => out.set(0, 0, 0),
            getWorldAxis: (out) => out.set(0, 0, 1),
        }],
        forwardKinematics: ([angle]) => {
            endPosition.set(Math.cos(angle), Math.sin(angle), 0);
        },
        solverMethod: 'DLS',
        maxIter: 40,
        tolerance: 1e-5,
        damping: 0.02,
        dlsMaxDelta: 0.2,
    });

    const result = solver.solve([0]);

    assert.ok(Math.abs(result[0] - Math.PI / 2) < 1e-3);
    assert.ok(endPosition.distanceTo(solver.targetPosition) < 1e-5);
});
