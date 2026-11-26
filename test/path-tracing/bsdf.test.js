import assert from 'node:assert/strict';
import test from 'node:test';

import { Brdf } from '../../extend/path-tracing/shaders/brdf.glsl.js';
import { Common } from '../../extend/path-tracing/shaders/common.glsl.js';
import { Sample } from '../../extend/path-tracing/shaders/sample.glsl.js';
import { Struct } from '../../extend/path-tracing/shaders/struct.glsl.js';

const PI = Math.PI;
const EPSILON = 1e-5;

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
    const halfVector = [
        sinTheta * Math.cos(phi),
        sinTheta * Math.sin(phi),
        cosTheta,
    ];
    const viewDotHalf = dot(view, halfVector);

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

// Runs the shader's own FresnelDielectric in JavaScript. Its body only uses
// float locals, arithmetic, and sqrt, so a textual translation is exact.
function loadShaderFresnel() {
    const [, body] = Sample.match(/float FresnelDielectric\(float cosThetaI, float relativeIor\) \{([\s\S]*?)\n {4}\}/);
    const javascriptBody = body.replace(/\bfloat\s+/g, 'let ').replace(/\bsqrt\(/g, 'Math.sqrt(');
    return new Function('cosThetaI', 'relativeIor', javascriptBody);
}

// GLSL refract(): incident and normal point against each other.
function refract(incident, normal, relativeIor) {
    const cosine = dot(normal, incident);
    const k = 1 - relativeIor * relativeIor * (1 - cosine * cosine);
    if (k < 0) {
        return [0, 0, 0];
    }
    const normalScale = relativeIor * cosine + Math.sqrt(k);
    return incident.map((component, axis) => relativeIor * component - normalScale * normal[axis]);
}

function reflect(incident, normal) {
    const scale = 2 * dot(normal, incident);
    return incident.map((component, axis) => component - scale * normal[axis]);
}

test('shader exposes a structured BSDF sampling contract', () => {
    assert.match(Struct, /struct BSDFSample/);
    assert.match(Sample, /BSDFSample SampleBSDF/);
    assert.match(Sample, /BSDF_EVENT_DIFFUSE/);
    assert.match(Sample, /BSDF_EVENT_GLOSSY/);
    assert.match(Sample, /BSDF_EVENT_TRANSMISSION/);
    assert.match(Sample, /BSDF_EVENT_DELTA/);
    assert.match(Sample, /BSDFSample SampleDielectricBSDF/);
    assert.doesNotMatch(Sample, /SampleBRDFDirection/);
    assert.match(Brdf, /float BSDFPDF/);
    assert.match(Brdf, /vec3 BSDFEvaluate/);
});

test('every bounce spawns its ray on the side the new direction leaves through', () => {
    assert.match(Common, /vec3 spawnRayOrigin\(vec3 position, vec3 geometricNormal, vec3 direction\)/);
    assert.match(Common, /ray\.origin = spawnRayOrigin\(hit\.position, surfaceGeometricNormal, bsdfSample\.direction\);/);
    assert.doesNotMatch(Common, /\* RAY_OFFSET_EPSILON;/);
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

test('shader Fresnel matches the angle form, total internal reflection, and reciprocity', () => {
    const fresnel = loadShaderFresnel();
    const ior = 1.5;

    // Normal incidence reduces to ((n - 1) / (n + 1))^2 from either side.
    assert.ok(Math.abs(fresnel(1, 1 / ior) - 0.04) < 1e-12);
    assert.ok(Math.abs(fresnel(1, ior) - 0.04) < 1e-12);

    for (let degrees = 1; degrees < 90; degrees += 4) {
        const incident = degrees * PI / 180;
        const transmitted = Math.asin(Math.sin(incident) / ior);
        // Fresnel's equations in terms of the two angles (Born and Wolf 1.5.3).
        const perpendicular = -Math.sin(incident - transmitted) / Math.sin(incident + transmitted);
        const parallel = Math.tan(incident - transmitted) / Math.tan(incident + transmitted);
        const expected = 0.5 * (perpendicular * perpendicular + parallel * parallel);
        const entering = fresnel(Math.cos(incident), 1 / ior);
        assert.ok(Math.abs(entering - expected) < 1e-12, `Entering at ${degrees} degrees`);

        // Light leaving along the refracted angle sees the same reflectance.
        const leaving = fresnel(Math.cos(transmitted), ior);
        assert.ok(Math.abs(leaving - entering) < 1e-12, `Leaving at ${degrees} degrees`);
    }

    const criticalAngle = Math.asin(1 / ior);
    assert.equal(fresnel(Math.cos(criticalAngle + 1e-6), ior), 1);
    assert.ok(fresnel(Math.cos(criticalAngle - 1e-3), ior) < 1);
});

test('a smooth glass sphere under a white furnace returns every path with unit weight', () => {
    // Mirrors SampleDielectricBSDF: reflect with probability F at weight 1,
    // refract otherwise at weight relativeIor^2. Entering scales by 1 / n^2
    // and leaving by n^2, so any path that escapes must carry exactly 1, and
    // a sphere never traps light by total internal reflection.
    const fresnel = loadShaderFresnel();
    const random = createRandom(0xD1E1EC);
    const ior = 1.5;
    const maxEvents = 64;
    const sampleCount = 20_000;
    let escapedWeight = 0;
    let trappedPaths = 0;

    for (let i = 0; i < sampleCount; i++) {
        const radius = Math.sqrt(random());
        const phi = 2 * PI * random();
        let origin = [radius * Math.cos(phi), radius * Math.sin(phi), -3];
        let direction = [0, 0, 1];
        let weight = 1;
        let escaped = false;

        for (let event = 0; event < maxEvents; event++) {
            const halfB = dot(origin, direction);
            const discriminant = halfB * halfB - (dot(origin, origin) - 1);
            const inside = dot(origin, origin) < 1;
            if (!inside && (discriminant <= 0 || halfB >= 0)) {
                escaped = true;
                break;
            }
            const distance = inside ? -halfB + Math.sqrt(discriminant) : -halfB - Math.sqrt(discriminant);
            const position = origin.map((component, axis) => component + distance * direction[axis]);
            const normal = inside ? position.map((component) => -component) : position;
            const relativeIor = inside ? ior : 1 / ior;
            const reflectance = fresnel(Math.min(-dot(direction, normal), 1), relativeIor);

            if (random() < reflectance) {
                direction = normalize(reflect(direction, normal));
            } else {
                direction = normalize(refract(direction, normal, relativeIor));
                weight *= relativeIor * relativeIor;
            }
            const side = dot(direction, normal) < 0 ? -1 : 1;
            origin = position.map((component, axis) => component + side * 1e-9 * normal[axis]);
        }

        if (escaped) {
            assert.ok(Math.abs(weight - 1) < 1e-9, `Escaped path carried weight ${weight}`);
            escapedWeight += weight;
        } else {
            trappedPaths++;
        }
    }

    assert.ok(trappedPaths < sampleCount * 1e-3, `${trappedPaths} paths stayed inside the sphere`);
    assert.ok(Math.abs(escapedWeight / sampleCount - 1) < 1e-3);
});
