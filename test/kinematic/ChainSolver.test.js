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

function createRevoluteFixture(options = {}) {
    const radius = options.radius ?? 1;
    const endPosition = new Vector3(radius, 0, 0);
    const endQuaternion = new Quaternion();
    const axis = new Vector3(0, 0, 1);
    const joint = {
        getWorldPosition: (out) => out.set(0, 0, 0),
        getWorldAxis: (out) => out.copy(axis),
    };
    const solver = new ChainSolver({
        chain: {
            getActuatorWorldPosition: (out) => out.copy(endPosition),
            getActuatorWorldQuaternion: (out) => out.copy(endQuaternion),
        },
        joints: [joint],
        forwardKinematics: ([angle]) => {
            endPosition.set(radius * Math.cos(angle), radius * Math.sin(angle), 0);
            endQuaternion.setFromAxisAngle(axis, angle);
        },
        ...options,
    });
    return { solver, endPosition, endQuaternion, joint, axis };
}

test('DLS position-only steps ignore the orientation objective', () => {
    const { solver, endPosition } = createRevoluteFixture({
        radius: 0.1,
        targetPosition: new Vector3(0, 0.1, 0),
        solverMethod: 'DLS',
        solveMode: 'Position Only',
        maxIter: 40,
        tolerance: 1e-5,
        damping: 0.02,
        dlsMaxDelta: 0.2,
        rotationWeight: 0.25,
    });
    const q = solver.solve([0]);
    const result = solver.getSolveResult();

    assert.ok(Math.abs(q[0] - Math.PI / 2) < 1e-3);
    assert.ok(endPosition.distanceTo(solver.targetPosition) < 1e-5);
    assert.equal(result.converged, true);
    assert.equal(result.status, 'converged');
    assert.ok(result.rotationError > 1.5);
});

for (const solverMethod of ['Jacobian', 'DLS']) {
    test(`${solverMethod} uses independent position and rotation tolerances`, () => {
        const { solver, axis, joint } = createRevoluteFixture({
            solverMethod,
            solveMode: 'Position + Rotation',
            targetPosition: new Vector3(1, 0, 0),
            tolerance: 0.006,
            rotationTolerance: 0.03,
            maxIter: 1,
        });
        solver.targetQuaternion.setFromAxisAngle(axis, 0.02);
        assert.equal(solver.getSolveResult(), null);
        assert.deepEqual(solver.solve([0]), [0]);
        assert.equal(solver.getSolveResult().status, 'converged');
        assert.equal(solver.isTaskConverged(0.007, 0), false);
        assert.equal(solver.isTaskConverged(0, 0.031), false);

        joint.minAngle = 0;
        joint.maxAngle = 0;
        solver.targetQuaternion.setFromAxisAngle(axis, 0.05);
        solver.solve([0]);
        const result = solver.getSolveResult();
        assert.equal(result.status, 'iteration-limit');
        assert.equal(result.converged, false);
        assert.ok(Math.abs(result.rotationError - 0.05) < 1e-12);
        assert.equal(result.positionError, 0);
        assert.equal(result.iterations, 1);
        result.q[0] = 20;
        assert.deepEqual(solver.getSolveResult().q, [0]);
    });
}

test('DLS result records per-call convergence thresholds', () => {
    const { solver, axis } = createRevoluteFixture({
        solveMode: 'Position + Rotation',
        targetPosition: new Vector3(1, 0, 0),
        rotationTolerance: 0.001,
    });
    solver.targetQuaternion.setFromAxisAngle(axis, 0.02);
    solver.solveDampedLeastSquares([0], { rotationTolerance: 0.03 });

    assert.equal(solver.getSolveResult().status, 'converged');
    assert.equal(solver.getSolveResult().rotationTolerance, 0.03);
    assert.equal(solver.evaluateConvergence([0]).converged, false);
});

test('Jacobian restores the returned pose after every trial is rejected', () => {
    const targetAngle = 0.01;
    const { solver, endPosition } = createRevoluteFixture({
        solverMethod: 'Jacobian',
        targetPosition: new Vector3(Math.cos(targetAngle), Math.sin(targetAngle), 0),
        alpha: 100,
        maxIter: 1,
        tolerance: 1e-5,
    });
    const q = solver.solve([0]);

    assert.deepEqual(q, [0]);
    assert.ok(endPosition.distanceTo(new Vector3(1, 0, 0)) < 1e-12);
    assert.equal(solver.getSolveResult().status, 'iteration-limit');
});

test('numeric Jacobian matches a revolute derivative and restores the sampled pose', () => {
    const { solver, endPosition } = createRevoluteFixture();
    const q = [0.7];
    solver.forwardKinematics(q);
    const position = endPosition.clone();
    const analytic = solver.computeJacobianAnalytic(q);
    const numeric = solver.computeJacobianNumeric(q);

    for (let row = 0; row < 3; row++) {
        assert.ok(Math.abs(analytic[row][0] - numeric[row][0]) < 1e-9);
    }
    assert.ok(endPosition.distanceTo(position) < 1e-12);
    assert.deepEqual(q, [0.7]);
});

test('numeric Jacobian restores the requested pose when a sample fails', () => {
    const { solver, endPosition } = createRevoluteFixture();
    const applyPose = solver.forwardKinematics;
    solver.forwardKinematics = (q) => {
        applyPose(q);
        if (q[0] !== 0) {
            throw new Error('sample failed');
        }
    };

    assert.throws(() => solver.computeJacobianNumeric([0]), /sample failed/);
    assert.ok(endPosition.distanceTo(new Vector3(1, 0, 0)) < 1e-12);
});

for (const solverMethod of ['Jacobian', 'DLS']) {
    test(`${solverMethod} reports non-finite task errors as numerical failures`, () => {
        const { solver } = createRevoluteFixture({
            solverMethod,
            targetPosition: new Vector3(NaN, 0, 0),
            maxIter: 1,
        });
        const q = solver.solve([0]);
        const result = solver.getSolveResult();

        assert.deepEqual(q, [0]);
        assert.equal(result.status, 'numerical-failure');
        assert.equal(result.converged, false);
        assert.equal(result.finite, false);
    });
}
