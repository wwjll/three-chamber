import assert from 'node:assert/strict';
import test from 'node:test';
import { Object3D, Quaternion, Scene, Vector3 } from 'three';
import { Chain } from '../../extend/kinematic/Chain.js';
import {
    createDhParametersFromJointState,
    kukaKr5ChainProfile,
} from '../../extend/kinematic/ChainController.js';
import {
    createKukaKr5Rig,
    mapKukaKr5ChainPose,
} from '../../extend/kinematic/KukaKr5Rig.js';
import { createUr3eRig } from '../../extend/kinematic/Ur3eRobotiqRig.js';

test('robot model rigs accept ordered joint arrays', () => {
    const parent = new Object3D();
    const values = [0.1, -0.2, 0.3, -0.4, 0.5, -0.6];
    const kukaRig = createKukaKr5Rig({ parent });
    const ur3eRig = createUr3eRig({ parent });

    kukaRig.setJointValues(values);
    ur3eRig.setJointValues(values);
    const mappedKukaValues = mapKukaKr5ChainPose(values);

    for (let index = 0; index < values.length; index++) {
        assert.equal(
            kukaRig.resolveNode(`j${index + 1}`).rotation.z,
            mappedKukaValues[index],
        );
        assert.equal(
            ur3eRig.resolveNode(`j${index + 1}`).rotation.z,
            values[index],
        );
    }
});

test('KUKA gripper flange inherits the complete six-joint hierarchy', () => {
    const rig = createKukaKr5Rig();
    let node = rig.resolveNode('tool0');
    const jointNames = [];

    while (node && node !== rig.root) {
        if (/^A[1-6]$/.test(node.name)) {
            jointNames.push(node.name);
        }
        node = node.parent;
    }

    assert.deepEqual(jointNames, ['A6', 'A5', 'A4', 'A3', 'A2', 'A1']);
});

test('KUKA model flange follows the procedural chain end position', () => {
    const scene = new Scene();
    const chainPose = [0.3, 1.1, 0.2, 0.4, -0.3, 0.5];
    const chain = new Chain(scene);
    chain.update(
        createDhParametersFromJointState(chainPose, kukaKr5ChainProfile),
        {
            jointColor: 0x777777,
            linkColor: 0x111111,
            jointRadius: 0.02,
            jointHeight: 0.1,
            linkRadius: 0.01,
            syncUp: true,
        },
        { mdhMode: false, baseOffset: {} },
    );
    const rig = createKukaKr5Rig({ parent: scene });
    rig.syncBase({ syncUp: true });
    rig.setJointValues(chainPose);
    scene.updateMatrixWorld(true);

    const chainEnd = chain.getActuatorWorldPosition(new Vector3());
    const modelEnd = rig.resolveNode('tool0').getWorldPosition(new Vector3());
    const chainRotation = chain.getActuatorWorldQuaternion(new Quaternion());
    const modelRotation = rig.resolveNode('tool0')
        .getWorldQuaternion(new Quaternion());

    assert.ok(chainEnd.distanceTo(modelEnd) < 1e-12);
    assert.ok(chainRotation.angleTo(modelRotation) < 1e-7);
});
