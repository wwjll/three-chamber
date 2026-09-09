import assert from 'node:assert/strict';
import test from 'node:test';
import { SimulationClock } from '../../extend/tools/SimulationClock.js';

test('simulation and physics advance identically at different render rates', () => {
    const results = [30, 60, 120].map((fps) => {
        const clock = new SimulationClock();
        let physicsTime = 0;
        let position = 0;
        for (let frame = 0; frame < fps * 2; frame++) {
            clock.advance(1 / fps, (dt, time) => {
                physicsTime += dt;
                position = time * time;
            });
        }
        assert.ok(Math.abs(physicsTime - 2) < 1e-12);
        return position;
    });
    assert.deepEqual(results, [results[0], results[0], results[0]]);
});

test('a long suspended frame advances by bounded time without a backlog', () => {
    const clock = new SimulationClock({ maxSubsteps: 4 });
    assert.equal(clock.advance(20, () => {}), 4);
    assert.ok(Math.abs(clock.time - 4 / 60) < 1e-12);
    assert.equal(clock.advance(0, () => assert.fail('Unexpected backlog')), 0);
});

test('fractional frames accumulate and invalid deltas fail at the boundary', () => {
    const clock = new SimulationClock();
    let steps = 0;
    clock.advance(1 / 120, () => steps++);
    assert.equal(steps, 0);
    clock.advance(1 / 120, () => steps++);
    assert.equal(steps, 1);
    assert.throws(() => clock.advance(NaN, () => {}), RangeError);
    assert.throws(() => clock.advance(-1, () => {}), RangeError);
});
