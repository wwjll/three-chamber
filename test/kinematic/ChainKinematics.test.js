import assert from 'node:assert/strict';
import test from 'node:test';
import { Quaternion, Scene, Vector3 } from 'three';
import { Chain } from '../../extend/kinematic/Chain.js';
import { ChainSolver } from '../../extend/kinematic/ChainSolver.js';

const style = {
    jointColor: 0x777777,
    linkColor: 0x111111,
    jointRadius: 0.02,
    jointHeight: 0.1,
    linkRadius: 0.01,
};

for (const mdhMode of [false, true]) {
    test(`${mdhMode ? 'MDH' : 'DH'} preserves joint offsets across pose updates`, () => {
        const chain = new Chain(new Scene());
        chain.update([[0, 0, 1, 0, Math.PI / 2, 45, 135]], style, { mdhMode });
        const builtPosition = chain.getActuatorWorldPosition(new Vector3()).clone();
        const builtQuaternion = chain.getActuatorWorldQuaternion(new Quaternion()).clone();
        chain.updateJoint([0]);

        assert.ok(builtPosition.distanceTo(new Vector3(0, 1, 0)) < 1e-12);
        assert.ok(chain.getActuatorWorldPosition(new Vector3()).distanceTo(builtPosition) < 1e-12);
        assert.ok(chain.getActuatorWorldQuaternion(new Quaternion()).angleTo(builtQuaternion) < 1e-7);
        assert.equal(chain.joints[0].dh.thetaOffset, Math.PI / 2);
        const solver = new ChainSolver({ chain, joints: chain.joints });
        const [limit] = solver.buildJointLimits(1);
        assert.ok(Math.abs(limit.min + Math.PI / 4) < 1e-12);
        assert.ok(Math.abs(limit.max - Math.PI / 4) < 1e-12);
        chain.updateJoint([0.2]);
        const expected = new Vector3(Math.cos(Math.PI / 2 + 0.2), Math.sin(Math.PI / 2 + 0.2), 0);
        assert.ok(chain.getActuatorWorldPosition(new Vector3()).distanceTo(expected) < 1e-12);
    });

    test(`${mdhMode ? 'MDH' : 'DH'} analytic Jacobian matches sampled FK at several poses`, () => {
        const chain = new Chain(new Scene());
        chain.update([
            [0, 0.15, 0.2, Math.PI / 2, 0.1, -180, 180],
            [0, 0, 0.25, 0, -0.2, -180, 180],
            [0, 0.05, 0.1, -Math.PI / 2, 0.3, -180, 180],
        ], style, { mdhMode });
        const solver = new ChainSolver({
            chain,
            joints: chain.joints,
            forwardKinematics: (q) => chain.updateJoint(q),
        });
        for (const q of [[0, 0, 0], [0.3, -0.7, 1.1], [-1.2, 0.8, -0.4]]) {
            chain.updateJoint(q);
            const initial = chain.getActuatorWorldPosition(new Vector3()).clone();
            const analytic = solver.computeJacobianAnalytic(q);
            const numeric = solver.computeJacobianNumeric(q);
            for (let row = 0; row < 3; row++) {
                for (let column = 0; column < q.length; column++) {
                    assert.ok(Math.abs(analytic[row][column] - numeric[row][column]) < 1e-8);
                }
            }
            assert.ok(chain.getActuatorWorldPosition(new Vector3()).distanceTo(initial) < 1e-12);
        }
    });
}
