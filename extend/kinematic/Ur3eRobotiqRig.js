import { BoxGeometry, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import { ModelRig } from './ModelRig.js';

const defaultPadMaterial = new MeshStandardMaterial({
    color: 0xcad1ee,
    roughness: 0.46,
    metalness: 0.22,
});

function addGripperPad(parent, material) {
    // The visualization Xacro defines the finger pad as a box rather than the legacy pad DAE.
    const pad = new Mesh(
        new BoxGeometry(0.022, 0.00635, 0.0375),
        material,
    );
    pad.name = 'Robotiq 2F-85 finger pad';
    pad.castShadow = true;
    pad.receiveShadow = true;
    parent.add(pad);
}

function createRobotiq2f85Rig({
    parent,
    assetUrl,
    rootTransform = {},
    materialResolver = null,
    padMaterial = defaultPadMaterial,
}) {
    const rig = new ModelRig({
        parent,
        name: 'Robotiq 2F-85 model rig',
        assetUrl,
        rootTransform,
        materialResolver,
    });

    rig.addJoint('leftOuterKnuckle', {
        name: 'Robotiq left outer knuckle',
        position: [0, -0.0306011, 0.054904],
        rpy: [0, 0, Math.PI],
        axis: 'x',
    });
    rig.addFrame('leftOuterFinger', {
        parent: 'leftOuterKnuckle',
        position: [0, 0.0315, -0.0041],
    });
    rig.addJoint('leftInnerFinger', {
        parent: 'leftOuterFinger',
        position: [0, 0.0061, 0.0471],
        axis: 'x',
    });
    rig.addFrame('leftPad', {
        parent: 'leftInnerFinger',
        position: [0, -0.0220203446692936, 0.03242],
    });
    rig.addJoint('leftInnerKnuckle', {
        name: 'Robotiq left inner knuckle',
        position: [0, -0.0127, 0.06142],
        rpy: [0, 0, Math.PI],
        axis: 'x',
    });

    rig.addJoint('rightOuterKnuckle', {
        name: 'Robotiq right outer knuckle',
        position: [0, 0.0306011, 0.054904],
        axis: 'x',
    });
    rig.addFrame('rightOuterFinger', {
        parent: 'rightOuterKnuckle',
        position: [0, 0.0315, -0.0041],
    });
    rig.addJoint('rightInnerFinger', {
        parent: 'rightOuterFinger',
        position: [0, 0.0061, 0.0471],
        axis: 'x',
    });
    rig.addFrame('rightPad', {
        parent: 'rightInnerFinger',
        position: [0, -0.0220203446692936, 0.03242],
    });
    rig.addJoint('rightInnerKnuckle', {
        name: 'Robotiq right inner knuckle',
        position: [0, 0.0127, 0.06142],
        axis: 'x',
    });

    const meshScale = 0.001;
    rig
        .addVisual({ file: 'robotiq_arg2f_85_base_link.dae', scale: meshScale })
        .addVisual({
            file: 'robotiq_arg2f_85_outer_knuckle.dae',
            parent: 'leftOuterKnuckle',
            scale: meshScale,
        })
        .addVisual({
            file: 'robotiq_arg2f_85_outer_finger.dae',
            parent: 'leftOuterFinger',
            scale: meshScale,
        })
        .addVisual({
            file: 'robotiq_arg2f_85_inner_finger.dae',
            parent: 'leftInnerFinger',
            scale: meshScale,
        })
        .addVisual({
            file: 'robotiq_arg2f_85_inner_knuckle.dae',
            parent: 'leftInnerKnuckle',
            scale: meshScale,
        })
        .addVisual({
            file: 'robotiq_arg2f_85_outer_knuckle.dae',
            parent: 'rightOuterKnuckle',
            scale: meshScale,
        })
        .addVisual({
            file: 'robotiq_arg2f_85_outer_finger.dae',
            parent: 'rightOuterFinger',
            scale: meshScale,
        })
        .addVisual({
            file: 'robotiq_arg2f_85_inner_finger.dae',
            parent: 'rightInnerFinger',
            scale: meshScale,
        })
        .addVisual({
            file: 'robotiq_arg2f_85_inner_knuckle.dae',
            parent: 'rightInnerKnuckle',
            scale: meshScale,
        });

    addGripperPad(rig.resolveNode('leftPad'), padMaterial);
    addGripperPad(rig.resolveNode('rightPad'), padMaterial);
    return rig;
}

function createUr3eRig({
    parent,
    assetUrl,
    rootTransform = {},
    materialResolver = null,
} = {}) {
    const rig = new ModelRig({
        parent,
        name: 'UR3e model rig',
        assetUrl,
        rootTransform,
        materialResolver,
    });

    rig.addJoint('j1', {
        name: 'J1 shoulder pan',
        position: [0, 0, 0.15185],
    });
    rig.addJoint('j2', {
        parent: 'j1',
        name: 'J2 shoulder lift',
        rpy: [Math.PI / 2, 0, 0],
    });
    rig.addJoint('j3', {
        parent: 'j2',
        name: 'J3 elbow',
        position: [-0.24355, 0, 0],
    });
    rig.addJoint('j4', {
        parent: 'j3',
        name: 'J4 wrist 1',
        position: [-0.2132, 0, 0.13105],
    });
    rig.addJoint('j5', {
        parent: 'j4',
        name: 'J5 wrist 2',
        position: [0, -0.08535, 0],
        rpy: [Math.PI / 2, 0, 0],
    });
    rig.addJoint('j6', {
        parent: 'j5',
        name: 'J6 wrist 3',
        position: [0, 0.0921, 0],
        rpy: [Math.PI / 2, Math.PI, Math.PI],
    });
    rig.addFrame('flange', {
        parent: 'j6',
        name: 'UR3e flange',
        rpy: [0, -Math.PI / 2, -Math.PI / 2],
    });

    rig
        .addVisual({ file: 'base.dae', rpy: [0, 0, Math.PI] })
        .addVisual({
            file: 'shoulder.dae',
            parent: 'j1',
            rpy: [0, 0, Math.PI],
        })
        .addVisual({
            file: 'upperarm.dae',
            parent: 'j2',
            position: [0, 0, 0.12],
            rpy: [Math.PI / 2, 0, -Math.PI / 2],
        })
        .addVisual({
            file: 'forearm.dae',
            parent: 'j3',
            position: [0, 0, 0.027],
            rpy: [Math.PI / 2, 0, -Math.PI / 2],
        })
        .addVisual({
            file: 'wrist1.dae',
            parent: 'j4',
            position: [0, 0, -0.104],
            rpy: [Math.PI / 2, 0, 0],
        })
        .addVisual({
            file: 'wrist2.dae',
            parent: 'j5',
            position: [0, 0, -0.08535],
        })
        .addVisual({
            file: 'wrist3.dae',
            parent: 'j6',
            position: [0, 0, -0.0921],
            rpy: [Math.PI / 2, 0, 0],
        });

    return rig;
}

function createUr3eRobotiqRig({
    parent,
    ur3eAssetUrl,
    gripperAssetUrl,
    rootTransform = {},
    gripperRootTransform = {},
    ur3eMaterialResolver = null,
    gripperMaterialResolver = null,
    padMaterial = defaultPadMaterial,
} = {}) {
    const ur3eRig = createUr3eRig({
        parent,
        assetUrl: ur3eAssetUrl,
        rootTransform,
        materialResolver: ur3eMaterialResolver,
    });

    const gripperRig = createRobotiq2f85Rig({
        parent: ur3eRig.resolveNode('flange'),
        assetUrl: gripperAssetUrl,
        rootTransform: gripperRootTransform,
        materialResolver: gripperMaterialResolver,
        padMaterial,
    });
    const leftPadPosition = new Vector3();
    const rightPadPosition = new Vector3();

    function setJointValues(values = {}) {
        ur3eRig.setJointValues(values);
    }

    function setGripperOpen(openRatio = 1) {
        const normalizedOpen = Math.min(1, Math.max(0, openRatio));
        const jointAngle = (1 - normalizedOpen) * 0.8;
        gripperRig.setJointValues({
            leftOuterKnuckle: jointAngle,
            rightOuterKnuckle: jointAngle,
            leftInnerKnuckle: jointAngle,
            rightInnerKnuckle: jointAngle,
            leftInnerFinger: -jointAngle,
            rightInnerFinger: -jointAngle,
        });
    }

    function getPadCenterGap() {
        gripperRig.root.updateWorldMatrix(true, true);
        gripperRig.resolveNode('leftPad').getWorldPosition(leftPadPosition);
        gripperRig.resolveNode('rightPad').getWorldPosition(rightPadPosition);
        gripperRig.root.worldToLocal(leftPadPosition);
        gripperRig.root.worldToLocal(rightPadPosition);
        return leftPadPosition.distanceTo(rightPadPosition);
    }

    function setGripperGap(padCenterGap = 0) {
        const targetGap = Math.max(0, padCenterGap);
        let lowerOpen = 0;
        let upperOpen = 1;

        for (let iteration = 0; iteration < 14; iteration++) {
            const openRatio = (lowerOpen + upperOpen) * 0.5;
            setGripperOpen(openRatio);
            if (getPadCenterGap() < targetGap) {
                lowerOpen = openRatio;
            } else {
                upperOpen = openRatio;
            }
        }

        const openRatio = (lowerOpen + upperOpen) * 0.5;
        setGripperOpen(openRatio);
        return openRatio;
    }

    return {
        root: ur3eRig.root,
        ur3eRig,
        gripperRig,
        load() {
            return Promise.all([ur3eRig.load(), gripperRig.load()]);
        },
        setJointValues,
        setGripperOpen,
        getPadCenterGap,
        setGripperGap,
        syncBase(options) {
            ur3eRig.syncBase(options);
        },
        setVisible(visible) {
            ur3eRig.setVisible(visible);
        },
        removeFromParent() {
            ur3eRig.removeFromParent();
        },
    };
}

export {
    createRobotiq2f85Rig,
    createUr3eRig,
    createUr3eRobotiqRig,
};
