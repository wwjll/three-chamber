import assert from 'node:assert/strict';
import test from 'node:test';

import {
    bsdfEventFlags,
    clientPointToRenderTargetPixel,
    decodeFlags,
    pathDiagnosticModes,
    pathFailureFlags,
    pathTerminationReasons,
} from '../../extend/path-tracing/Diagnostics.js';
import { Common } from '../../extend/path-tracing/shaders/common.glsl.js';
import { Sample } from '../../extend/path-tracing/shaders/sample.glsl.js';
import { Struct } from '../../extend/path-tracing/shaders/struct.glsl.js';

function shaderDefineValues(source, prefix) {
    return [...source.matchAll(new RegExp(`#define ${prefix}\\w+\\s+(?:uint\\()?(\\d+)`, 'g'))]
        .map(([, value]) => Number(value));
}

function labelKeys(labels) {
    return Object.keys(labels).map(Number);
}

test('path diagnostics expose stable summary and metric contracts', () => {
    assert.match(Struct, /struct PathDiagnostic/);
    assert.match(Common, /vec3 pathTrace\(out PathDiagnostic diagnostic\)/);
    assert.match(Common, /vec4 encodeDiagnosticSummary/);
    assert.match(Common, /vec4 encodeDiagnosticMetrics/);
    assert.match(Common, /recordPathFailure/);
    assert.match(Common, /isFiniteVec3/);
});

test('diagnostic output is selected after the path estimator runs', () => {
    const main = Common.slice(Common.search(/void\s+main\s*\(/));
    const traceIndex = main.search(/pathTrace\s*\(/);
    const diagnosticIndex = main.search(/\bdiagnosticOutput\b/);
    const accumulationIndex = main.search(/texelFetch\s*\(\s*outTexture\b/);

    assert.ok(traceIndex >= 0);
    assert.ok(diagnosticIndex > traceIndex);
    assert.ok(accumulationIndex > diagnosticIndex);
});

test('diagnostic label tables cover every shader-encoded value', () => {
    assert.equal(pathDiagnosticModes.radiance, 0);
    assert.deepEqual(labelKeys(pathTerminationReasons), shaderDefineValues(Common, 'PATH_TERMINATION_'));
    assert.deepEqual(labelKeys(pathFailureFlags), shaderDefineValues(Common, 'PATH_FAILURE_'));
    assert.deepEqual(labelKeys(bsdfEventFlags), shaderDefineValues(Sample, 'BSDF_EVENT_'));
});

test('decodeFlags lists every set bit and falls back to None', () => {
    const labels = { 1: 'A', 2: 'B', 4: 'C' };
    assert.deepEqual(decodeFlags(5, labels), ['A', 'C']);
    assert.deepEqual(decodeFlags(3.9, labels), ['C']);
    assert.deepEqual(decodeFlags(0, labels), ['None']);
});

test('client coordinates map to physical render-target pixels at any DPI', () => {
    const bounds = {
        left: 100,
        top: 50,
        width: 800,
        height: 600,
    };

    assert.deepEqual(
        clientPointToRenderTargetPixel(500, 350, bounds, 1600, 1200),
        { x: 800, y: 600 }
    );
    assert.deepEqual(
        clientPointToRenderTargetPixel(100, 50, bounds, 1600, 1200),
        { x: 0, y: 1199 }
    );
    assert.deepEqual(
        clientPointToRenderTargetPixel(900, 650, bounds, 1600, 1200),
        { x: 1599, y: 0 }
    );
});
