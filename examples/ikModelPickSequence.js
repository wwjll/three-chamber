import { CLOSE_ACTION } from '../extend/kinematic/SequenceGenerator.js';

export const DYNAMIC_CUBE_TARGET_KIND = 'ikModelPickCubeTarget';

function cloneSequenceStep(step) {
    return {
        ...step,
        target: step.target ? { ...step.target } : undefined,
    };
}

export function createTrajectoryPreviewSequence(sequence) {
    return {
        ...sequence,
        name: `${sequence.name}-preview`,
        steps: sequence.steps
            .filter((step) => step.type !== 'grip')
            .map(cloneSequenceStep),
    };
}

export function createPickAndReturnSequence(sequence, { currentChainPose, gripDurationMs }) {
    const forwardSteps = sequence.steps.map(cloneSequenceStep);
    const recordedPoseSteps = forwardSteps.filter(
        (step) => (
            step.keyframeId
            && step.keyframeKind === 'recorded'
            && step.type === 'joint'
        ),
    );
    if (recordedPoseSteps.length === 0) {
        return null;
    }
    // Rejoin the recorded route using actual joints, not the editor selection.
    let nearestIndex = 0;
    let nearestDistance = Infinity;
    recordedPoseSteps.forEach((step, index) => {
        const distance = step.target.chainPose.reduce((sum, angle, joint) => (
            sum + (angle - currentChainPose[joint]) ** 2
        ), 0);
        if (distance < nearestDistance) {
            nearestIndex = index;
            nearestDistance = distance;
        }
    });
    // An exact keyframe pose can start with the preceding waypoint immediately.
    const entryCount = nearestIndex + (nearestDistance <= 1e-12 ? 0 : 1);
    const approachSteps = recordedPoseSteps.slice(0, entryCount).reverse().map((step) => ({
        ...cloneSequenceStep(step),
        id: `approach-${step.id}`,
        approachStep: true,
    }));
    const returnSteps = recordedPoseSteps
        .slice(0, -1)
        .reverse()
        .map((step) => ({
            ...cloneSequenceStep(step),
            id: `return-${step.id}`,
            returnStep: true,
        }));
    return {
        ...sequence,
        name: `${sequence.name}-pick-and-return`,
        steps: [
            ...approachSteps,
            {
                id: 'dynamic-cube-target-pose',
                type: 'move',
                target: { kind: DYNAMIC_CUBE_TARGET_KIND },
                durationMs: 500,
                interpolation: 'smooth',
                rotationInterpolation: 'eulerXYZ',
                solveWhileLerping: true,
                completion: 'solve',
                toleranceProfile: 'descend',
                dynamicCubeTarget: true,
            },
            {
                id: 'dynamic-cube-target-hold',
                type: 'wait',
                durationMs: 80,
                dynamicCubeTarget: true,
            },
            {
                id: 'dynamic-cube-target-grip',
                type: 'grip',
                mode: CLOSE_ACTION,
                durationMs: gripDurationMs,
                dynamicCubeTarget: true,
            },
            ...forwardSteps,
            ...returnSteps,
        ],
    };
}
