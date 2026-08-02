import assert from 'node:assert/strict';
import test from 'node:test';
import { Mesh, MeshStandardMaterial, PlaneGeometry, Scene } from 'three';

import {
    bvhLeafSize,
    maxPathBounces,
    maxTransparentSteps,
    texelsPerBVHNode,
    texelsPerMaterial,
    texelsPerTriangle,
} from '../../extend/path-tracing/Constants.js';
import { gpuSceneLayout } from '../../extend/path-tracing/GpuSceneLayout.js';
import { SceneCompiler } from '../../extend/path-tracing/compiler/SceneCompiler.js';
import { Common } from '../../extend/path-tracing/shaders/common.glsl.js';
import { Hit } from '../../extend/path-tracing/shaders/hit.glsl.js';
import { Light } from '../../extend/path-tracing/shaders/light.glsl.js';
import { Struct } from '../../extend/path-tracing/shaders/struct.glsl.js';

/**
 * Build the smallest encoded scene needed to test SceneCompiler dependency
 * injection and CompiledScene ownership without real Three.js GPU resources.
 */
function createEncodedScene(disposeCounts) {
    function createBuffer(key) {
        return {
            dataTexture: {
                dispose() {
                    disposeCounts[key]++;
                },
            },
            textureWidth: 1,
            textureHeight: 1,
        };
    }

    return {
        triangle: createBuffer('triangle'),
        bvh: createBuffer('bvh'),
        material: {
            ...createBuffer('material'),
            textures: {},
        },
    };
}

test('GPU layout is internally consistent and generates shader limits', () => {
    // Each DataTexture texel stores four floats, so the CPU stride must equal
    // the texel count multiplied by four. A mismatch shifts all shader reads.
    assert.equal(gpuSceneLayout.triangle.stride, gpuSceneLayout.triangle.texels * 4);
    assert.equal(gpuSceneLayout.bvhNode.stride, gpuSceneLayout.bvhNode.texels * 4);
    assert.equal(gpuSceneLayout.material.stride, gpuSceneLayout.material.texels * 4);

    // Constants.js, the encoder, and GLSL limits must derive from one layout so
    // a CPU-side change cannot leave stale shader constants behind.
    assert.equal(texelsPerTriangle, gpuSceneLayout.triangle.texels);
    assert.equal(texelsPerBVHNode, gpuSceneLayout.bvhNode.texels);
    assert.equal(texelsPerMaterial, gpuSceneLayout.material.texels);
    assert.equal(bvhLeafSize, gpuSceneLayout.bvhNode.leafSize);

    assert.match(Hit, new RegExp(`#define MAX_TRIANGLES_PER_LEAF ${bvhLeafSize}`));
    assert.match(Common, new RegExp(`#define MAX_BOUNCES ${maxPathBounces}`));
    assert.match(
        Common,
        new RegExp(`#define MAX_TRANSPARENT_SURFACE_STEPS ${maxTransparentSteps}`)
    );
});

test('SceneCompiler accepts an injected encoder and returns an owned CompiledScene', () => {
    // The fake encoder records calls so option merging can be verified without
    // running a real BVH build.
    const disposeCounts = {
        triangle: 0,
        bvh: 0,
        material: 0,
    };
    const encodedScene = createEncodedScene(disposeCounts);
    const calls = [];
    const encoder = {
        encode(scene, options) {
            calls.push({ scene, options });
            return encodedScene;
        },
    };
    const compiler = new SceneCompiler({
        encoder,
        encoderOptions: { baseOption: true },
    });
    const scene = { traverse() {} };
    const compiledScene = compiler.compile(scene, { requestOption: true });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].scene, scene);
    assert.deepEqual(calls[0].options, {
        baseOption: true,
        requestOption: true,
    });
    assert.equal(compiledScene.layoutVersion, gpuSceneLayout.version);
    assert.equal(compiledScene.disposed, false);

    // dispose() must be idempotent because scene switching and shutdown can
    // reach cleanup more than once, while each GPU texture has one owner.
    compiledScene.dispose();
    compiledScene.dispose();
    assert.deepEqual(disposeCounts, {
        triangle: 1,
        bvh: 1,
        material: 1,
    });
});

test('SceneCompiler normalizes mixed mesh attributes into finite GPU buffers', () => {
    // Keep UVs on one mesh and remove them from another to reproduce mixed
    // attribute sets. The compiler must add defaults and normalize to Float32.
    const scene = new Scene();
    const material = new MeshStandardMaterial();
    const geometryWithUv = new PlaneGeometry(1, 1);
    const geometryWithoutUv = new PlaneGeometry(1, 1);
    geometryWithoutUv.deleteAttribute('uv');

    const meshWithUv = new Mesh(geometryWithUv, material);
    const meshWithoutUv = new Mesh(geometryWithoutUv, material);
    meshWithoutUv.position.x = 2;
    scene.add(meshWithUv, meshWithoutUv);

    const compiledScene = new SceneCompiler().compile(scene);

    // NaN or Infinity in a DataTexture propagates through normals, BSDFs, and
    // throughput, eventually appearing as black regions, flicker, or fireflies.
    for (const buffer of [
        compiledScene.triangle,
        compiledScene.bvh,
        compiledScene.material,
    ]) {
        assert.ok(
            buffer.dataTexture.image.data.every(Number.isFinite),
            'Expected the encoded GPU buffer to contain only finite values'
        );
    }

    compiledScene.dispose();
    geometryWithUv.dispose();
    geometryWithoutUv.dispose();
    material.dispose();
});

test('light evaluation is behind a stable shader contract', () => {
    // The pure-BSDF integrator currently evaluates environment and emissive
    // light. This boundary lets future NEE/MIS work extend the light module
    // without rewriting the path loop.
    assert.match(Struct, /struct LightSample/);
    assert.match(Light, /LightSample EvaluateEnvironmentLight/);
    assert.match(Light, /vec3 EvaluateSurfaceEmission/);
});
