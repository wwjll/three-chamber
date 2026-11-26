import assert from 'node:assert/strict';
import test from 'node:test';

import { getTileRect } from '../../extend/path-tracing/Tiles.js';

function coverage(tilesX, tilesY, width, height) {
    const counts = new Uint8Array(width * height);
    for (let index = 0; index < tilesX * tilesY; index++) {
        const { x, y, width: tileWidth, height: tileHeight } = getTileRect(index, tilesX, tilesY, width, height);
        for (let py = y; py < y + tileHeight; py++) {
            for (let px = x; px < x + tileWidth; px++) {
                counts[py * width + px]++;
            }
        }
    }
    return counts;
}

test('tiles cover every pixel exactly once', () => {
    for (const [tilesX, tilesY, width, height] of [[1, 1, 7, 5], [3, 3, 100, 61], [8, 8, 1219, 1233], [4, 2, 9, 9]]) {
        const counts = coverage(tilesX, tilesY, width, height);
        assert.ok(counts.every((count) => count === 1), `${tilesX}×${tilesY} over ${width}×${height}`);
    }
});

test('a single tile spans the whole target', () => {
    assert.deepEqual(getTileRect(0, 1, 1, 640, 480), { x: 0, y: 0, width: 640, height: 480 });
});

test('tiles start at the top-left and advance row by row', () => {
    assert.deepEqual(getTileRect(0, 2, 2, 100, 80), { x: 0, y: 40, width: 50, height: 40 });
    assert.deepEqual(getTileRect(1, 2, 2, 100, 80), { x: 50, y: 40, width: 50, height: 40 });
    assert.deepEqual(getTileRect(2, 2, 2, 100, 80), { x: 0, y: 0, width: 50, height: 40 });
    assert.deepEqual(getTileRect(3, 2, 2, 100, 80), { x: 50, y: 0, width: 50, height: 40 });
});
