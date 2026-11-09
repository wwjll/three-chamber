/**
 * @fileoverview Iterative IK solver for a serial chain with optional orientation control.
 *
 * Solver model:
 * - `Jacobian`: Jacobian-transpose descent with an adaptive step length.
 * - `DLS`: damped least squares.
 * - Both minimise `|e_pos|² + rotationWeight² * |e_rot|²` with backtracking.
 * - Supports two modes:
 *   - `Position Only`
 *   - `Position + Rotation`
 * - Applies joint limits each step (`buildJointLimits` + `clampJointValue`).
 *
 * Expected external dependencies:
 * - `chain.getActuatorWorldPosition(out)` and `chain.getActuatorWorldQuaternion(out)`
 *   for the default tracked frame (the chain flange).
 * - Optional `endEffector` Object3D that replaces the flange as the tracked frame.
 * - `joint.getWorldPosition(out)` and `joint.getWorldAxis(out)` for Jacobian columns.
 * - Optional `forwardKinematics(q)` callback to push candidate `q` into scene transforms.
 *
 * Key public fields and meaning:
 * - `targetPosition`: desired end-effector world position.
 * - `targetQuaternion`: desired end-effector world orientation.
 * - `chain`: chain wrapper used for querying current actuator pose.
 * - `endEffector`: optional tracked frame rigidly attached past the last joint,
 *   such as a gripper tool center point; `null` tracks the chain flange.
 * - `joints`: ordered joint list for Jacobian construction.
 * - `maxIter`: max solver iterations per solve call.
 * - `tolerance`: position convergence threshold in scene units.
 * - `rotationTolerance`: orientation convergence threshold in radians.
 * - `solveMode`: `'Position Only'` or `'Position + Rotation'`.
 * - `debug`: enables optional verbose logging hooks.
 *
 * `_tmp` scratch fields (allocation-free math workspace):
 * - `p`: current end-effector world position.
 * - `pi`: current joint world position.
 * - `ai`: current joint world axis.
 * - `r`: lever arm vector (`p - pi`).
 * - `jcol`: temporary Jacobian translational column (`ai x r`).
 * - `posErr`: position error vector.
 * - `rotErr`: axis-angle rotation error vector.
 * - `currentQuat`, `invCurrentQuat`, `deltaQuat`: orientation error pipeline.
 * - `errorVec6`: packed weighted task error `[ex, ey, ez, w*erx, w*ery, w*erz]`.
 */
import { Quaternion, Vector3 } from 'three';

function solveLinearSystem(
    matrix,
    vector,
    output = new Array(vector.length),
    augmented = [],
) {
    const size = vector.length;
    for (let row = 0; row < size; row++) {
        const augmentedRow = augmented[row] ?? [];
        augmented[row] = augmentedRow;
        for (let column = 0; column < size; column++) {
            augmentedRow[column] = matrix[row][column];
        }
        augmentedRow[size] = vector[row];
        augmentedRow.length = size + 1;
    }
    augmented.length = size;

    for (let column = 0; column < size; column++) {
        let pivotRow = column;
        for (let row = column + 1; row < size; row++) {
            if (
                Math.abs(augmented[row][column])
                > Math.abs(augmented[pivotRow][column])
            ) {
                pivotRow = row;
            }
        }
        if (Math.abs(augmented[pivotRow][column]) < 1e-12) {
            return null;
        }
        [augmented[column], augmented[pivotRow]] = [
            augmented[pivotRow],
            augmented[column],
        ];

        const pivot = augmented[column][column];
        for (let entry = column; entry <= size; entry++) {
            augmented[column][entry] /= pivot;
        }
        for (let row = 0; row < size; row++) {
            if (row === column) {
                continue;
            }
            const factor = augmented[row][column];
            for (let entry = column; entry <= size; entry++) {
                augmented[row][entry] -= factor * augmented[column][entry];
            }
        }
    }
    output.length = size;
    for (let row = 0; row < size; row++) {
        output[row] = augmented[row][size];
    }
    return output;
}

class ChainSolver {
    constructor(options = {}) {
        this.targetPosition = options.targetPosition?.clone() ?? new Vector3();
        this.targetQuaternion = options.targetQuaternion?.clone()
            ?? new Quaternion();
        this.chain = options.chain ?? null;
        this.endEffector = options.endEffector ?? null;
        this.maxIter = options.maxIter ?? 20;
        this.tolerance = options.tolerance ?? 1e-3;
        this.solveMode = options.solveMode === 'Position + Rotation'
            ? 'Position + Rotation'
            : 'Position Only';
        this.solverMethod = options.solverMethod === 'DLS'
            ? 'DLS'
            : 'Jacobian';
        this.damping = Math.max(1e-5, options.damping ?? 0.04);
        this.dlsMaxDelta = Math.max(1e-4, options.dlsMaxDelta ?? 0.08);
        this.rotationWeight = Math.max(0, options.rotationWeight ?? 0.25);
        this.rotationTolerance = Math.max(
            1e-6,
            options.rotationTolerance ?? 0.03,
        );
        this.lastIterationCount = 0;
        this._lastSolveResult = null;
        this.debug = options.debug ?? false;
        this.joints = options.joints ?? null;
        this.thetaOffsets = options.thetaOffsets?.slice() ?? [];
        this._tmp = {
            p: new Vector3(),
            pi: new Vector3(),
            ai: new Vector3(),
            r: new Vector3(),
            jcol: new Vector3(),
            posErr: new Vector3(),
            rotErr: new Vector3(),
            currentQuat: new Quaternion(),
            invCurrentQuat: new Quaternion(),
            deltaQuat: new Quaternion(),
            errorVec6: [0, 0, 0, 0, 0, 0],
        };
        this._dlsScratch = {
            rowWeights: [1, 1, 1, 1, 1, 1],
            rawError: new Array(6),
            weightedError: new Array(6),
            jacobian: Array.from({ length: 6 }, () => []),
            weightedJacobian: Array.from({ length: 6 }, () => []),
            normalMatrix: Array.from({ length: 6 }, () => new Array(6)),
            augmented: Array.from({ length: 6 }, () => new Array(7)),
            taskStep: new Array(6),
            candidate: [],
            deltas: [],
        };

        this.forwardKinematics = options.forwardKinematics ?? null;
    }

    buildJointLimits(count) {
        const limits = new Array(count);
        const toRad = Math.PI / 180;
        const joints = this.joints?.length > 0
            ? this.joints
            : this.chain?.joints ?? [];

        for (let i = 0; i < count; i++) {
            const joint = joints[i];
            const minAngleDeg = joint?.minAngle ?? null;
            const maxAngleDeg = joint?.maxAngle ?? null;
            if (minAngleDeg === null || maxAngleDeg === null) {
                limits[i] = null;
                continue;
            }

            const thetaOffset = joint?.dh?.thetaOffset
                ?? this.thetaOffsets[i]
                ?? 0;
            const qMin = minAngleDeg * toRad - thetaOffset;
            const qMax = maxAngleDeg * toRad - thetaOffset;
            // Keep min/max ordering as-is:
            // - min <= max: normal interval clamp.
            // - min > max: wrap-around interval (crosses +/-pi), used by ring DOF as well.
            limits[i] = { min: qMin, max: qMax, wrap: qMin > qMax };
        }

        return limits;
    }

    wrapToPi(angle) {
        return Math.atan2(Math.sin(angle), Math.cos(angle));
    }

    positiveModulo(value, mod) {
        const out = value % mod;
        return out < 0 ? out + mod : out;
    }

    clampJointValue(value, limit) {
        if (!limit) return value;
        if (!limit.wrap) {
            if (value < limit.min) return limit.min;
            if (value > limit.max) return limit.max;
            return value;
        }

        // Wrap-around interval semantics:
        // min > max means a cyclic interval on S1.
        // Evaluate membership by measuring phase from min over one full turn.
        const twoPi = Math.PI * 2;
        const span = this.positiveModulo(limit.max - limit.min, twoPi);
        if (span <= 1e-12) return value;

        const phase = this.positiveModulo(value - limit.min, twoPi);
        const inside = phase <= span;
        if (inside) return value;

        const distToMin = Math.min(phase, twoPi - phase);
        const deltaToMax = Math.abs(phase - span);
        const distToMax = Math.min(deltaToMax, twoPi - deltaToMax);
        const targetBoundary = distToMin <= distToMax ? limit.min : limit.max;
        return value + this.wrapToPi(targetBoundary - value);
    }

    computeTaskError(q) {
        this.forwardKinematics?.(q);
        const endEffectorPosition = this.getEndEffectorWorldPosition(this._tmp.p);
        const posErr = this._tmp.posErr.copy(this.targetPosition).sub(endEffectorPosition);
        const rotErr = this._tmp.rotErr.set(0, 0, 0);

        const currentQuat = this.getEndEffectorWorldQuaternion(this._tmp.currentQuat);
        const invCurrentQuat = this._tmp.invCurrentQuat.copy(currentQuat).invert();
        const deltaQuat = this._tmp.deltaQuat
            .multiplyQuaternions(this.targetQuaternion, invCurrentQuat)
            .normalize();
        if (deltaQuat.w < 0) {
            deltaQuat.x = -deltaQuat.x;
            deltaQuat.y = -deltaQuat.y;
            deltaQuat.z = -deltaQuat.z;
            deltaQuat.w = -deltaQuat.w;
        }

        const clampedW = Math.min(1, Math.max(-1, deltaQuat.w));
        const angle = 2 * Math.acos(clampedW);
        const sinHalf = Math.sqrt(Math.max(1e-16, 1 - clampedW * clampedW));
        if (angle > 1e-8) {
            rotErr.set(
                deltaQuat.x / sinHalf,
                deltaQuat.y / sinHalf,
                deltaQuat.z / sinHalf
            ).multiplyScalar(angle);
        }

        return { posErr, rotErr };
    }

    getEndEffectorWorldPosition(out) {
        return this.endEffector?.getWorldPosition(out)
            ?? this.chain?.getActuatorWorldPosition?.(out)
            ?? out.set(0, 0, 0);
    }

    getEndEffectorWorldQuaternion(out) {
        return this.endEffector?.getWorldQuaternion(out)
            ?? this.chain?.getActuatorWorldQuaternion?.(out)
            ?? out.identity();
    }

    computePositionError(q) {
        return this.computeTaskError(q).posErr.clone();
    }

    computeTaskErrorNorm(q) {
        const { posErr, rotErr } = this.computeTaskError(q);
        return Math.hypot(posErr.x, posErr.y, posErr.z, rotErr.x, rotErr.y, rotErr.z);
    }

    isPositionAndRotationMode() {
        return this.solveMode === 'Position + Rotation';
    }

    isTaskConverged(positionError, rotationError, {
        positionTolerance = this.tolerance,
        rotationTolerance = this.rotationTolerance,
    } = {}) {
        return positionError <= Math.max(1e-6, positionTolerance)
            && (
                !this.isPositionAndRotationMode()
                || rotationError <= Math.max(1e-6, rotationTolerance)
            );
    }

    // Evaluating a pose applies FK(q); callers can read getSolveResult() without resampling.
    evaluateConvergence(q, {
        positionTolerance = this.tolerance,
        rotationTolerance = this.rotationTolerance,
    } = {}) {
        const { posErr, rotErr } = this.computeTaskError(q);
        const positionError = posErr.length();
        const rotationError = rotErr.length();
        const thresholds = {
            positionTolerance: Math.max(1e-6, positionTolerance),
            rotationTolerance: Math.max(1e-6, rotationTolerance),
        };
        const includeRotation = this.isPositionAndRotationMode();
        const finite = Number.isFinite(positionError)
            && (!includeRotation || Number.isFinite(rotationError));
        return {
            ...thresholds,
            positionError,
            rotationError,
            errorNorm: includeRotation
                ? Math.hypot(positionError, rotationError)
                : positionError,
            finite,
            converged: finite && this.isTaskConverged(
                positionError,
                rotationError,
                thresholds,
            ),
        };
    }

    _recordSolveResult(q, options = {}, numericalFailure = false) {
        // Re-evaluate the returned state so rejected trials cannot remain in FK.
        const convergence = this.evaluateConvergence(q, options);
        this._lastSolveResult = {
            ...convergence,
            q: q.slice(),
            iterations: this.lastIterationCount,
            status: numericalFailure || !convergence.finite
                ? 'numerical-failure'
                : convergence.converged ? 'converged' : 'iteration-limit',
        };
    }

    getSolveResult() {
        if (!this._lastSolveResult) {
            return null;
        }
        return {
            ...this._lastSolveResult,
            q: this._lastSolveResult.q.slice(),
        };
    }

    computeSolveErrorNorm(q) {
        if (this.isPositionAndRotationMode()) {
            return this.computeTaskErrorNorm(q);
        }
        return this.computePositionError(q).length();
    }

    computeJacobianAnalytic(q, output = null) {
        // Analytic Jacobian for revolute joints:
        // J = [Jv_i, Jw_i], Jv_i = a_i x (p - p_i), Jw_i = a_i.
        // p is the tracked frame origin; any frame rigidly attached past the
        // last joint (flange or tool center point) shares the same Jw columns.
        const n = q.length;
        const jacobian = output ?? Array.from(
            { length: 6 },
            () => new Array(n),
        );
        for (let row = 0; row < 6; row++) {
            jacobian[row] ??= [];
            jacobian[row].length = n;
        }
        const joints = this.joints || [];
        const p = this.getEndEffectorWorldPosition(this._tmp.p);
        const pi = this._tmp.pi;
        const ai = this._tmp.ai;
        const r = this._tmp.r;
        const jcol = this._tmp.jcol;

        for (let i = 0; i < n; i++) {
            const joint = joints[i];
            if (!joint) {
                for (let row = 0; row < 6; row++) {
                    jacobian[row][i] = 0;
                }
                continue;
            }

            joint.getWorldPosition(pi);
            joint.getWorldAxis(ai);
            r.subVectors(p, pi);
            jcol.crossVectors(ai, r);

            jacobian[0][i] = jcol.x;
            jacobian[1][i] = jcol.y;
            jacobian[2][i] = jcol.z;
            jacobian[3][i] = ai.x;
            jacobian[4][i] = ai.y;
            jacobian[5][i] = ai.z;
        }

        return jacobian;
    }

    computeJacobianNumeric(q) {
        // Central differences measure d(position)/dq, matching the analytic columns.
        const eps = 1e-5;
        const n = q.length;
        const jacobian = [new Array(n), new Array(n), new Array(n)];
        const qPerturbed = q.slice();

        try {
            for (let i = 0; i < n; i++) {
                qPerturbed[i] = q[i] - eps;
                const negativeError = this.computePositionError(qPerturbed);
                qPerturbed[i] = q[i] + eps;
                const positiveError = this.computePositionError(qPerturbed);
                const column = negativeError.sub(positiveError)
                    .multiplyScalar(1 / (2 * eps));
                qPerturbed[i] = q[i];

                jacobian[0][i] = column.x;
                jacobian[1][i] = column.y;
                jacobian[2][i] = column.z;
            }
        } finally {
            this.forwardKinematics?.(q);
        }

        return jacobian;
    }

    solveDampedLeastSquares(qe, options = {}) {
        const maxIter = Math.max(1, options.maxIter ?? this.maxIter);
        const maxDelta = Math.max(
            1e-4,
            options.maxDelta ?? this.dlsMaxDelta,
        );
        const includeRotation = this.isPositionAndRotationMode();
        const rotationWeight = includeRotation ? Math.max(
            0,
            options.rotationWeight ?? this.rotationWeight,
        ) : 0;
        const positionTolerance = Math.max(
            1e-6,
            options.positionTolerance ?? this.tolerance,
        );
        const rotationTolerance = Math.max(
            1e-6,
            options.rotationTolerance ?? this.rotationTolerance,
        );
        let damping = Math.max(1e-5, options.damping ?? this.damping);
        const q = qe.slice();
        let numericalFailure = false;
        this.lastIterationCount = 0;
        const jointLimits = this.buildJointLimits(q.length);
        const rowCount = includeRotation ? 6 : 3;
        const scratch = this._dlsScratch;
        const {
            rowWeights,
            rawError,
            weightedError,
            jacobian,
            weightedJacobian,
            normalMatrix,
            augmented,
            taskStep,
            candidate,
            deltas,
        } = scratch;
        rowWeights[3] = rotationWeight;
        rowWeights[4] = rotationWeight;
        rowWeights[5] = rotationWeight;
        weightedError.length = rowCount;
        candidate.length = q.length;
        deltas.length = q.length;
        for (let row = 0; row < rowCount; row++) {
            weightedJacobian[row].length = q.length;
            normalMatrix[row].length = rowCount;
        }
        for (let index = 0; index < q.length; index++) {
            q[index] = this.clampJointValue(q[index], jointLimits[index]);
        }

        for (let iteration = 0; iteration < maxIter; iteration++) {
            this.lastIterationCount = iteration + 1;
            const { posErr, rotErr } = this.computeTaskError(q);
            if (this.isTaskConverged(posErr.length(), rotErr.length(), {
                positionTolerance,
                rotationTolerance,
            })) {
                break;
            }

            rawError[0] = posErr.x;
            rawError[1] = posErr.y;
            rawError[2] = posErr.z;
            rawError[3] = rotErr.x;
            rawError[4] = rotErr.y;
            rawError[5] = rotErr.z;
            this.computeJacobianAnalytic(q, jacobian);
            for (let row = 0; row < rowCount; row++) {
                const rowWeight = rowWeights[row];
                weightedError[row] = rawError[row] * rowWeight;
                for (let joint = 0; joint < q.length; joint++) {
                    weightedJacobian[row][joint]
                        = jacobian[row][joint] * rowWeight;
                }
            }
            for (let row = 0; row < rowCount; row++) {
                for (let column = 0; column < rowCount; column++) {
                    let sum = row === column ? damping * damping : 0;
                    for (let joint = 0; joint < q.length; joint++) {
                        sum += weightedJacobian[row][joint]
                            * weightedJacobian[column][joint];
                    }
                    normalMatrix[row][column] = sum;
                }
            }
            if (!solveLinearSystem(
                normalMatrix,
                weightedError,
                taskStep,
                augmented,
            )) {
                numericalFailure = true;
                break;
            }

            let largestDelta = 0;
            for (let joint = 0; joint < q.length; joint++) {
                let delta = 0;
                for (let row = 0; row < rowCount; row++) {
                    delta += weightedJacobian[row][joint] * taskStep[row];
                }
                deltas[joint] = delta;
                largestDelta = Math.max(largestDelta, Math.abs(delta));
            }
            const deltaScale = largestDelta > maxDelta
                ? maxDelta / largestDelta
                : 1;
            for (let joint = 0; joint < q.length; joint++) {
                candidate[joint] = this.clampJointValue(
                    q[joint] + deltas[joint] * deltaScale,
                    jointLimits[joint],
                );
            }

            const currentScore = posErr.lengthSq()
                + rotationWeight * rotationWeight * rotErr.lengthSq();
            const candidateError = this.computeTaskError(candidate);
            const candidateScore = candidateError.posErr.lengthSq()
                + rotationWeight * rotationWeight * candidateError.rotErr.lengthSq();
            if (candidateScore <= currentScore) {
                for (let joint = 0; joint < q.length; joint++) {
                    q[joint] = candidate[joint];
                }
                damping = Math.max(1e-5, damping * 0.8);
            } else {
                damping = Math.min(1, damping * 2);
            }
        }
        this._recordSolveResult(q, {
            positionTolerance,
            rotationTolerance,
        }, numericalFailure);
        return q;
    }

    solve(qe) {
        if (this.solverMethod === 'DLS') {
            return this.solveDampedLeastSquares(qe);
        }
        return this.solveJacobianTranspose(qe);
    }

    solveJacobianTranspose(qe) {
        // The joint direction g = Jᵀe is the steepest-descent direction of the
        // weighted error. A unit step along g moves the end effector by
        // v = J g under the linear model, so the step length
        // alpha = (e·v) / (v·v) = |g|² / |v|² minimises |e - alpha v|²
        // (Buss, adaptive Jacobian transpose). maxDelta then caps the largest
        // joint change without bending the direction.
        const maxRetry = 5;
        const maxDelta = 0.05;
        const q = qe.slice();
        const jointCount = q.length;
        this.lastIterationCount = 0;
        const jointLimits = this.buildJointLimits(jointCount);
        for (let joint = 0; joint < jointCount; joint++) {
            q[joint] = this.clampJointValue(q[joint], jointLimits[joint]);
        }
        const includeRotation = this.isPositionAndRotationMode();
        const rotationWeight = includeRotation ? this.rotationWeight : 0;
        const rowCount = includeRotation ? 6 : 3;
        // Rotation rows are scaled so metres and radians contribute comparably.
        const rowWeights = [1, 1, 1, rotationWeight, rotationWeight, rotationWeight];
        const weightedError = this._tmp.errorVec6;
        const jacobian = Array.from({ length: 6 }, () => new Array(jointCount));
        const gradient = new Array(jointCount);
        const candidate = new Array(jointCount);

        for (let iteration = 0; iteration < this.maxIter; iteration++) {
            this.lastIterationCount = iteration + 1;
            const { posErr, rotErr } = this.computeTaskError(q);
            if (this.isTaskConverged(posErr.length(), rotErr.length())) {
                break;
            }
            const currentScore = posErr.lengthSq()
                + rotationWeight * rotationWeight * rotErr.lengthSq();
            weightedError[0] = posErr.x;
            weightedError[1] = posErr.y;
            weightedError[2] = posErr.z;
            weightedError[3] = rotErr.x * rotationWeight;
            weightedError[4] = rotErr.y * rotationWeight;
            weightedError[5] = rotErr.z * rotationWeight;
            this.computeJacobianAnalytic(q, jacobian);

            let gradientSq = 0;
            let largestGradient = 0;
            for (let joint = 0; joint < jointCount; joint++) {
                let sum = 0;
                for (let row = 0; row < rowCount; row++) {
                    sum += rowWeights[row] * jacobian[row][joint] * weightedError[row];
                }
                gradient[joint] = sum;
                gradientSq += sum * sum;
                largestGradient = Math.max(largestGradient, Math.abs(sum));
            }
            // A vanishing or non-finite gradient leaves no descent direction.
            if (!(gradientSq > 1e-20)) {
                break;
            }
            let predictedSq = 0;
            for (let row = 0; row < rowCount; row++) {
                let sum = 0;
                for (let joint = 0; joint < jointCount; joint++) {
                    sum += rowWeights[row] * jacobian[row][joint] * gradient[joint];
                }
                predictedSq += sum * sum;
            }
            let step = Math.min(
                gradientSq / predictedSq,
                maxDelta / largestGradient,
            );

            // The linear model ignores curvature, so halve rejected steps.
            let accepted = false;
            for (let retry = 0; retry < maxRetry && !accepted; retry++) {
                for (let joint = 0; joint < jointCount; joint++) {
                    candidate[joint] = this.clampJointValue(
                        q[joint] + gradient[joint] * step,
                        jointLimits[joint],
                    );
                }
                const next = this.computeTaskError(candidate);
                const candidateScore = next.posErr.lengthSq()
                    + rotationWeight * rotationWeight * next.rotErr.lengthSq();
                if (candidateScore <= currentScore) {
                    for (let joint = 0; joint < jointCount; joint++) {
                        q[joint] = candidate[joint];
                    }
                    accepted = true;
                } else {
                    step *= 0.5;
                }
            }

            if (this.debug) {
                console.log(`[IK] iter=${iteration} score=${currentScore} step=${step} accepted=${accepted}`);
            }
            // Every halving failed: the pose is at a local minimum or joint limit.
            if (!accepted) {
                break;
            }
        }

        this._recordSolveResult(q);
        return q;
    }
}

export { ChainSolver, ChainSolver as default };
