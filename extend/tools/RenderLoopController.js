class RenderLoopController {
    constructor() {
        this._fps = 60;
        this._frameIntervalMs = 1000 / this._fps;
        this._renderFn = null;
        this._rafId = 0;
        this._running = false;
        this._continuous = false;
        this._renderOnIdle = false;
        this._dirty = false;
        this._lastRenderTime = 0;
        this._tick = this._tick.bind(this);
    }

    configure({ fps = 60, render }) {
        this.setFPS(fps);
        this._renderFn = render;
        return this;
    }

    setFPS(fps = 60) {
        this._fps = Math.max(1, fps);
        this._frameIntervalMs = 1000 / this._fps;
        return this;
    }

    setContinuous(enabled) {
        this._continuous = !!enabled;
        if (this._continuous) {
            this.start();
        } else {
            this.requestRender();
        }
        return this;
    }

    setRenderOnIdle(enabled) {
        this._renderOnIdle = !!enabled;
        if (this._renderOnIdle) {
            this.start();
        } else if (!this._continuous) {
            this.requestRender();
        }
        return this;
    }

    requestRender() {
        this._dirty = true;
        this.start();
        return this;
    }

    start() {
        if (this._running || typeof this._renderFn !== 'function') {
            return this;
        }
        this._running = true;
        this._rafId = requestAnimationFrame(this._tick);
        return this;
    }

    stop() {
        if (this._rafId) {
            cancelAnimationFrame(this._rafId);
            this._rafId = 0;
        }
        this._running = false;
        this._lastRenderTime = 0;
        return this;
    }

    _tick(nowMs) {
        if (!this._running) {
            return;
        }

        // Use a fixed-step timeline anchored to the previous render time.
        // We advance by whole frame intervals instead of snapping to nowMs,
        // so RAF jitter does not accumulate into long-term FPS drift.
        if (!this._lastRenderTime) {
            this._lastRenderTime = nowMs;
        }

        const elapsedMs = nowMs - this._lastRenderTime;
        if (elapsedMs >= this._frameIntervalMs) {
            // Catch up by N fixed steps; keep remainder for next tick.
            const frameSteps = Math.max(1, Math.floor(elapsedMs / this._frameIntervalMs));
            const steppedMs = frameSteps * this._frameIntervalMs;
            const deltaSec = steppedMs / 1000;
            this._lastRenderTime += steppedMs;
            const shouldRender = this._continuous || this._dirty || this._renderOnIdle;

            if (shouldRender) {
                this._dirty = false;
                this._renderFn(deltaSec);
            }
        }

        if (!this._continuous && !this._dirty && !this._renderOnIdle) {
            this._running = false;
            this._rafId = 0;
            this._lastRenderTime = 0;
            return;
        }

        this._rafId = requestAnimationFrame(this._tick);
    }
}

export default RenderLoopController;
