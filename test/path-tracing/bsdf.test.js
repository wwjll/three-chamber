import assert from 'node:assert/strict';
import test from 'node:test';

import { Brdf } from '../../extend/path-tracing/shaders/brdf.glsl.js';
import { Sample } from '../../extend/path-tracing/shaders/sample.glsl.js';
import { Struct } from '../../extend/path-tracing/shaders/struct.glsl.js';

const PI = Math.PI;
const EPSILON = 1e-5;

/**
 * Use a fixed-seed pseudo-random generator so every Monte Carlo test run uses
 * the same sample sequence. A failure then signals an algorithm change rather
 * than ordinary random fluctuation.
 */
function createRandom(seed) {
    return () => {
        seed |= 0;
        seed = (seed + 0x6D2B79F5) | 0;
        let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
}

function dot(a, b) {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function normalize(vector) {
    const inverseLength = 1 / Math.sqrt(dot(vector, vector));
    return vector.map((component) => component * inverseLength);
}

function roughnessToAlpha(roughness) {
    return Math.max(roughness * roughness, 0.001);
}

// Match the GGX normal distribution used by the shader's GTR2() function.
function gtr2(normalDotHalf, alpha) {
    const alphaSquared = alpha * alpha;
    const denominator = 1 + (alphaSquared - 1) * normalDotHalf * normalDotHalf;
    return alphaSquared / (PI * denominator * denominator);
}

function bsdfPdf(view, light, roughness, specularWeight) {
    const normalDotLight = Math.max(light[2], 0);
    const normalDotView = Math.max(view[2], 0);
    if (normalDotLight <= 0 || normalDotView <= 0) {
        return 0;
    }

    const halfVector = normalize([
        view[0] + light[0],
        view[1] + light[1],
        view[2] + light[2],
    ]);
    const normalDotHalf = Math.max(halfVector[2], 0);
    const lightDotHalf = Math.max(dot(light, halfVector), 0);
    // GGX first samples the half-vector H. Converting that distribution to the
    // outgoing direction L requires the Jacobian 1 / (4 * dot(L, H)).
    const specularPdf = gtr2(normalDotHalf, roughnessToAlpha(roughness))
        * normalDotHalf
        / Math.max(4 * lightDotHalf, EPSILON);
    const diffusePdf = normalDotLight / PI;

    // SampleBSDF() selects a branch using specularWeight, so the final PDF must
    // be the same weighted mixture instead of only the selected branch's PDF.
    return (1 - specularWeight) * diffusePdf + specularWeight * specularPdf;
}

function sampleGgxDirection(random, view, roughness) {
    const alpha = roughnessToAlpha(roughness);
    const alphaSquared = alpha * alpha;
    const phi = 2 * PI * random();
    const sample = random();
    const cosTheta = Math.sqrt((1 - sample) / (1 + (alphaSquared - 1) * sample));
    const sinTheta = Math.sqrt(Math.max(0, 1 - cosTheta * cosTheta));
    // Sample the microfacet half-vector H from the GGX distribution.
    const halfVector = [
        sinTheta * Math.cos(phi),
        sinTheta * Math.sin(phi),
        cosTheta,
    ];
    const viewDotHalf = dot(view, halfVector);

    // Compute the microfacet reflection direction L = reflect(-V, H).
    return [
        2 * viewDotHalf * halfVector[0] - view[0],
        2 * viewDotHalf * halfVector[1] - view[1],
        2 * viewDotHalf * halfVector[2] - view[2],
    ];
}

function sampleCosineDirection(random) {
    const sample = random();
    const radius = Math.sqrt(sample);
    const phi = 2 * PI * random();
    return [
        radius * Math.cos(phi),
        radius * Math.sin(phi),
        Math.sqrt(Math.max(0, 1 - sample)),
    ];
}

function integrateCosineWithBsdfSampler({
    roughness,
    specularWeight,
    viewAngleDegrees,
    sampleCount,
}) {
    const random = createRandom(0xC0FFEE);
    const viewAngle = viewAngleDegrees * PI / 180;
    const view = [Math.sin(viewAngle), 0, Math.cos(viewAngle)];
    let estimate = 0;

    for (let i = 0; i < sampleCount; i++) {
        // Reproduce the shader's mixture sampler: choose the GGX or diffuse
        // branch, then weight the sample with the complete mixture PDF.
        const sampleSpecular = random() < specularWeight;
        const light = sampleSpecular
            ? sampleGgxDirection(random, view, roughness)
            : sampleCosineDirection(random);

        // GGX can produce a reflection below the geometric hemisphere. It must
        // remain a zero-contribution null event. Resampling diffuse while using
        // the original mixture PDF would introduce systematic bias.
        if (light[2] <= 0) {
            continue;
        }

        const pdf = bsdfPdf(view, light, roughness, specularWeight);

        // Integrate the normalized cosine distribution with the BSDF sampler:
        //
        //   integral_hemisphere cos(theta) / PI dω = 1
        //
        // The Monte Carlo estimator is f(L) / p(L). If the sampler and PDF
        // match exactly, the estimate converges to 1 with enough samples.
        estimate += (light[2] / PI) / pdf;
    }

    return estimate / sampleCount;
}

test('shader exposes a structured BSDF sampling contract', () => {
    // This is an interface contract test; it does not execute GLSL. It keeps
    // direction, PDF, weight, and event flags in one BSDFSample result.
    assert.match(Struct, /struct BSDFSample/);
    assert.match(Sample, /BSDFSample SampleBSDF/);
    assert.match(Sample, /BSDF_EVENT_DIFFUSE/);
    assert.match(Sample, /BSDF_EVENT_GLOSSY/);
    assert.doesNotMatch(Sample, /SampleBRDFDirection/);
    assert.match(Brdf, /float BSDFPDF/);
    assert.match(Brdf, /vec3 BSDFEvaluate/);
});

test('mixed diffuse/GGX sampling matches its PDF at normal and grazing views', () => {
    // These cases increase specular weight, reduce roughness, and approach
    // grazing angles, where Jacobian and mixture-PDF errors are most visible.
    const cases = [
        { roughness: 0.7, specularWeight: 0.5, viewAngleDegrees: 45 },
        { roughness: 0.35, specularWeight: 0.95, viewAngleDegrees: 75 },
        { roughness: 0.1, specularWeight: 0.95, viewAngleDegrees: 85 },
    ];

    for (const sampleCase of cases) {
        // 500,000 samples keep ordinary Monte Carlo fluctuation within the
        // tolerance while retaining a sub-second deterministic test.
        const estimate = integrateCosineWithBsdfSampler({
            ...sampleCase,
            sampleCount: 500_000,
        });
        assert.ok(
            Math.abs(estimate - 1) < 0.025,
            `Expected unit cosine integral, received ${estimate} for ${JSON.stringify(sampleCase)}`
        );
    }
});
