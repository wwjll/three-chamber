/** A bounded fixed-step clock shared by animation and physics. */
class SimulationClock {
    constructor({ stepSeconds = 1 / 60, maxSubsteps = 8 } = {}) {
        if (!Number.isFinite(stepSeconds) || stepSeconds <= 0
            || !Number.isInteger(maxSubsteps) || maxSubsteps < 1) {
            throw new RangeError('A positive step and substep count are required.');
        }
        this.stepSeconds = stepSeconds;
        this.maxSubsteps = maxSubsteps;
        this.time = 0;
        this._accumulator = 0;
    }

    advance(deltaSeconds, step) {
        if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) {
            throw new RangeError('Frame delta must be finite and nonnegative.');
        }
        // Drop excess wall time for every simulation consumer together.
        this._accumulator += Math.min(
            deltaSeconds, this.stepSeconds * this.maxSubsteps,
        );
        const count = Math.min(this.maxSubsteps, Math.floor(
            (this._accumulator + this.stepSeconds * 1e-9) / this.stepSeconds,
        ));
        for (let index = 0; index < count; index++) {
            this._accumulator = Math.max(0, this._accumulator - this.stepSeconds);
            this.time += this.stepSeconds;
            step(this.stepSeconds, this.time);
        }
        return count;
    }
}

export { SimulationClock };
