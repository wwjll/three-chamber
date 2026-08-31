import assert from 'node:assert/strict';
import test from 'node:test';
import RenderLoopController from '../../extend/tools/RenderLoopController.js';

test('RenderLoopController stops after one requested idle frame', () => {
    const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
    const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
    const callbacks = [];
    let renderCount = 0;

    globalThis.requestAnimationFrame = (callback) => {
        callbacks.push(callback);
        return callbacks.length;
    };
    globalThis.cancelAnimationFrame = () => {};

    try {
        const loop = new RenderLoopController().configure({
            fps: 60,
            render: () => {
                renderCount++;
            },
        });
        loop.setContinuous(false);
        callbacks.shift()(100);
        callbacks.shift()(117);

        assert.equal(renderCount, 1);
        assert.equal(loop._running, false);
        assert.equal(callbacks.length, 0);
    } finally {
        if (originalRequestAnimationFrame) {
            globalThis.requestAnimationFrame = originalRequestAnimationFrame;
        } else {
            delete globalThis.requestAnimationFrame;
        }
        if (originalCancelAnimationFrame) {
            globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
        } else {
            delete globalThis.cancelAnimationFrame;
        }
    }
});
