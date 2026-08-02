import { ModelRig } from './ModelRig.js';

// Convert standard-DH joint variables to the ROS-Industrial controller frames.
// These fixed signs and zero offsets keep the model flange coincident with the
// procedural Chain end transform for every joint pose.
const chainToModelJointTransforms = [
    (value) => -value,
    (value) => -value,
    (value) => Math.PI / 2 - value,
    (value) => -Math.PI - value,
    (value) => value,
    (value) => -value,
];

function mapKukaKr5ChainPose(values = []) {
    if (Array.isArray(values)) {
        return chainToModelJointTransforms.map((transform, index) => (
            transform(Number.isFinite(values[index]) ? values[index] : 0)
        ));
    }
    const mappedValues = {};
    for (let index = 0; index < chainToModelJointTransforms.length; index++) {
        const key = `j${index + 1}`;
        if (!Number.isFinite(values[key])) {
            continue;
        }
        mappedValues[key] = chainToModelJointTransforms[index](values[key]);
    }
    return mappedValues;
}

function createKukaKr5Rig({
    parent,
    assetUrl,
    rootTransform = {},
    materialResolver = null,
} = {}) {
    const rig = new ModelRig({
        parent,
        name: 'KUKA KR5 model rig',
        assetUrl,
        rootTransform,
        materialResolver,
        jointValueMapper: mapKukaKr5ChainPose,
    });

    // Joint origins follow the ROS-Industrial KR5 ARC Xacro frames.
    rig.addJoint('j1', {
        name: 'A1',
        position: [0, 0, 0.4],
        rpy: [Math.PI, 0, 0],
    });
    rig.addJoint('j2', {
        parent: 'j1',
        name: 'A2',
        position: [0.18, 0, 0],
        rpy: [Math.PI / 2, 0, 0],
    });
    rig.addJoint('j3', {
        parent: 'j2',
        name: 'A3',
        position: [0.6, 0, 0],
    });
    rig.addJoint('j4', {
        parent: 'j3',
        name: 'A4',
        position: [0, -0.12, 0],
        rpy: [0, -Math.PI / 2, 0],
    });
    rig.addJoint('j5', {
        parent: 'j4',
        name: 'A5',
        position: [0, 0, -0.62],
        rpy: [0, Math.PI / 2, 0],
    });
    rig.addJoint('j6', {
        parent: 'j5',
        name: 'A6',
        rpy: [0, -Math.PI / 2, 0],
    });
    rig.addFrame('tool0', {
        parent: 'j6',
        name: 'KUKA flange',
        position: [0, 0, -0.115],
        rpy: [0, -Math.PI, -Math.PI / 2],
    });

    rig
        .addVisual({ file: 'base_link.dae' })
        .addVisual({ file: 'link_1.dae', parent: 'j1' })
        .addVisual({ file: 'link_2.dae', parent: 'j2' })
        .addVisual({ file: 'link_3.dae', parent: 'j3' })
        .addVisual({ file: 'link_4.dae', parent: 'j4' })
        .addVisual({ file: 'link_5.dae', parent: 'j5' })
        .addVisual({ file: 'link_6.dae', parent: 'j6' });

    return rig;
}

export {
    createKukaKr5Rig,
    createKukaKr5Rig as default,
    mapKukaKr5ChainPose,
};
