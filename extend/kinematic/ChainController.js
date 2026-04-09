import { Vector3 } from 'three';

const _tmpCubeWorldPos = new Vector3();
const _tmpCubeLocalPos = new Vector3();

const kukaKr5ChainProfile = {
    name: 'kuka-kr5',
    segments: [
        { theta: 0, axisSign: 1, thetaOffset: 0, d: 0.4, a: 0.18, alpha: 90, minAngle: -155, maxAngle: 155 },
        { theta: 90, axisSign: -1, thetaOffset: 0, d: 0, a: 0.6, alpha: 0, minAngle: -180, maxAngle: 65 },
        { theta: 0, axisSign: 1, thetaOffset: 0, d: 0, a: 0.12, alpha: 90, minAngle: -15, maxAngle: 158 },
        { theta: 0, axisSign: 1, thetaOffset: 0, d: 0.62, a: 0, alpha: -90, minAngle: -350, maxAngle: 350 },
        { theta: 0, axisSign: 1, thetaOffset: 0, d: 0, a: 0, alpha: 90, minAngle: -130, maxAngle: 130 },
        { theta: 0, axisSign: 1, thetaOffset: 0, d: 0.115, a: 0, alpha: 0, minAngle: -350, maxAngle: 350 }
    ],
};

function positiveModulo(value, mod) {
    const out = value % mod;
    return out < 0 ? out + mod : out;
}

function isAngleWithinRangeDeg(angleDeg, minDeg, maxDeg) {
    const rawSpan = maxDeg - minDeg;
    if (rawSpan >= 360 || rawSpan <= -360) return true;

    let span = positiveModulo(rawSpan, 360);
    if (span <= 1e-9 && maxDeg !== minDeg) {
        span = 360;
    }
    if (span <= 1e-9) {
        const delta = Math.abs(positiveModulo(angleDeg - minDeg + 180, 360) - 180);
        return delta <= 1e-6;
    }

    const phase = positiveModulo(angleDeg - minDeg, 360);
    return phase <= span;
}

function getProfileSegments(profileOrSegments = kukaKr5ChainProfile) {
    if (Array.isArray(profileOrSegments)) return profileOrSegments;
    if (Array.isArray(profileOrSegments?.segments)) return profileOrSegments.segments;
    return kukaKr5ChainProfile.segments;
}

function createInitialJointState(profileOrSegments = kukaKr5ChainProfile) {
    const segments = getProfileSegments(profileOrSegments);
    const toRad = Math.PI / 180;
    return segments.map((segment) => (Number.isFinite(segment.theta) ? segment.theta : 0) * toRad);
}

function convertSegmentAxisLimitsToDh(segment, axisSign, thetaOffsetDeg) {
    const minAxisDeg = Number.isFinite(segment.minAngle) ? segment.minAngle : -185;
    const maxAxisDeg = Number.isFinite(segment.maxAngle) ? segment.maxAngle : 185;
    const isWrap = minAxisDeg > maxAxisDeg;

    const mappedMin = axisSign * minAxisDeg + thetaOffsetDeg;
    const mappedMax = axisSign * maxAxisDeg + thetaOffsetDeg;

    if (!isWrap) {
        return mappedMin <= mappedMax
            ? [mappedMin, mappedMax]
            : [mappedMax, mappedMin];
    }

    return axisSign === 1
        ? [mappedMin, mappedMax]
        : [mappedMax, mappedMin];
}

function createDhParametersFromJointState(q, profileOrSegments = kukaKr5ChainProfile) {
    const segments = getProfileSegments(profileOrSegments);
    const toRad = Math.PI / 180;
    return segments.map((segment, index) => {
        const theta = Number.isFinite(q[index]) ? q[index] : 0;
        const axisSign = segment.axisSign === -1 ? -1 : 1;
        const thetaOffsetDeg = Number.isFinite(segment.thetaOffset) ? segment.thetaOffset : 0;
        const thetaOffset = thetaOffsetDeg * toRad;
        const alpha = (Number.isFinite(segment.alpha) ? segment.alpha : 0) * toRad;
        const [minDhDeg, maxDhDeg] = convertSegmentAxisLimitsToDh(segment, axisSign, thetaOffsetDeg);
        return [theta, segment.d, segment.a, alpha, thetaOffset, minDhDeg, maxDhDeg];
    });
}

function getBaseAngleRangeCheck({ chain, cubeItem, profile = kukaKr5ChainProfile }) {
    const segments = getProfileSegments(profile);
    const baseJointNode = chain?.joints?.[0] || null;
    const baseJoint = segments[0];
    const minAngleDeg = Number.isFinite(baseJointNode?.minAngle)
        ? baseJointNode.minAngle
        : (Number.isFinite(baseJoint?.minAngle) ? baseJoint.minAngle : null);
    const maxAngleDeg = Number.isFinite(baseJointNode?.maxAngle)
        ? baseJointNode.maxAngle
        : (Number.isFinite(baseJoint?.maxAngle) ? baseJoint.maxAngle : null);
    const parentFrame = baseJointNode?.parent || chain?.robotContainer || null;
    if (!Number.isFinite(minAngleDeg) || !Number.isFinite(maxAngleDeg) || !cubeItem?.mesh || !parentFrame) {
        return { valid: true };
    }

    cubeItem.mesh.getWorldPosition(_tmpCubeWorldPos);
    _tmpCubeLocalPos.copy(_tmpCubeWorldPos);
    parentFrame.worldToLocal(_tmpCubeLocalPos);

    const planarRadius2 = _tmpCubeLocalPos.x * _tmpCubeLocalPos.x + _tmpCubeLocalPos.y * _tmpCubeLocalPos.y;
    if (planarRadius2 <= 1e-10) {
        return {
            valid: true,
            baseDhAngleDeg: 0,
            minAngleDeg,
            maxAngleDeg,
        };
    }

    const baseDhAngleDeg = Math.atan2(_tmpCubeLocalPos.y, _tmpCubeLocalPos.x) * 180 / Math.PI;
    const valid = isAngleWithinRangeDeg(baseDhAngleDeg, minAngleDeg, maxAngleDeg);
    return {
        valid,
        baseDhAngleDeg,
        minAngleDeg,
        maxAngleDeg,
    };
}

class ChainController {
    constructor({
        chain,
        getSequencePlayer,
        profile,
        styleParams,
        baseParams,
        createInitialJointStateFn,
        createDhParametersFromJointStateFn,
        getToolEuler,
        updateReachRangePose,
    } = {}) {
        this.chain = chain ?? null;
        this.getSequencePlayer = typeof getSequencePlayer === 'function'
            ? getSequencePlayer
            : () => null;
        this.profile = profile ?? { segments: [] };
        this.styleParams = styleParams ?? {};
        this.baseParams = baseParams ?? {};
        this.createInitialJointState = typeof createInitialJointStateFn === 'function'
            ? createInitialJointStateFn
            : createInitialJointState;
        this.createDhParametersFromJointState = typeof createDhParametersFromJointStateFn === 'function'
            ? createDhParametersFromJointStateFn
            : createDhParametersFromJointState;
        this.getToolEuler = typeof getToolEuler === 'function'
            ? getToolEuler
            : () => ({ x: 0, y: 0, z: 0 });
        this.updateReachRangePose = typeof updateReachRangePose === 'function'
            ? updateReachRangePose
            : () => {};
    }

    setProfile(profile) {
        this.profile = profile ?? { segments: [] };
    }

    syncTargetFromActuator(targetObject) {
        const actuator = this.chain?.getActuator?.();
        if (!targetObject || !actuator) return;
        actuator.getGripWorldPosition(targetObject.position);
        actuator.getGripWorldQuaternion(targetObject.quaternion);
        targetObject.updateMatrixWorld(true);
    }

    build({ targetObject } = {}) {
        const qInitial = this.createInitialJointState(this.profile);
        this.rebuildChain(qInitial, {
            syncToolEuler: true,
            syncReachRange: true,
        });
        const sequencePlayer = this.getSequencePlayer();
        sequencePlayer?.setJointState(qInitial, { syncToolEuler: false, syncReachRange: false });
        sequencePlayer?.releaseGraspJoint();
        this.chain?.openActuator?.();
        this.syncTargetFromActuator(targetObject);
    }

    updateArm() {
        const sequencePlayer = this.getSequencePlayer();
        const qCurrent = sequencePlayer?.getJointState?.() ?? [];
        this.rebuildChain(qCurrent, {
            syncToolEuler: true,
            syncReachRange: true,
        });
    }

    rebuildChain(q, {
        syncToolEuler = false,
        syncReachRange = false,
    } = {}) {
        if (!this.chain) return;
        this.chain.update(this.createDhParametersFromJointState(q, this.profile), this.styleParams, this.baseParams);
        this.syncAttachments({ syncToolEuler, syncReachRange });
    }

    rebuildJointState(q, {
        syncToolEuler = false,
        syncReachRange = false,
    } = {}) {
        this.rebuildChain(q, {
            syncToolEuler,
            syncReachRange,
        });
    }

    updateJointState(q, {
        syncToolEuler = false,
        syncReachRange = false,
    } = {}) {
        if (!this.chain?.robotContainer) return;
        this.chain.updateJoint(q);
        if (syncToolEuler || syncReachRange) {
            this.syncAttachments({ syncToolEuler, syncReachRange });
        }
    }

    syncAttachments({ syncToolEuler = false, syncReachRange = false } = {}) {
        const actuator = this.chain?.getActuator?.();
        const mountNode = this.chain?.getActuatorNode?.();
        if (actuator) {
            const isAlreadyAttached = actuator.object?.parent === mountNode;
            if (!isAlreadyAttached) {
                this.chain?.attachActuator?.(actuator, { preserveWorld: false });
            }
        }
        if (syncToolEuler) {
            this.updateActuator();
        }
        if (syncReachRange) {
            this.updateReachRangePose();
        }
        this.getSequencePlayer()?.syncSolverJoints();
    }

    updateActuator() {
        const actuator = this.chain?.getActuator?.();
        if (!actuator) return;
        const euler = this.getToolEuler();
        actuator.setToolEulerDeg(euler.x, euler.y, euler.z);
    }
}

export {
    kukaKr5ChainProfile,
    createInitialJointState,
    convertSegmentAxisLimitsToDh,
    createDhParametersFromJointState,
    getBaseAngleRangeCheck,
    ChainController,
    ChainController as default,
};
