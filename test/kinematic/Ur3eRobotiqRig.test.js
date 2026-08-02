import assert from 'node:assert/strict';
import test from 'node:test';
import { createUr3eRobotiqRig } from '../../extend/kinematic/Ur3eRobotiqRig.js';

test('setGripperGap solves the 2F-85 linkage for a requested pad spacing', () => {
    const rig = createUr3eRobotiqRig();
    const requestedGap = 0.028 + 0.00635;

    const openRatio = rig.setGripperGap(requestedGap);

    assert.ok(openRatio > 0.25 && openRatio < 0.35);
    assert.ok(Math.abs(rig.getPadCenterGap() - requestedGap) < 1e-5);
});
