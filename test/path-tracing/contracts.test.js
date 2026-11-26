import assert from 'node:assert/strict';
import test from 'node:test';
import { Mesh, MeshPhysicalMaterial, MeshStandardMaterial, PlaneGeometry, Scene } from 'three';

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
import { Utils } from '../../extend/path-tracing/shaders/utils.glsl.js';

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
    assert.equal(gpuSceneLayout.triangle.stride, gpuSceneLayout.triangle.texels * 4);
    assert.equal(gpuSceneLayout.bvhNode.stride, gpuSceneLayout.bvhNode.texels * 4);
    assert.equal(gpuSceneLayout.material.stride, gpuSceneLayout.material.texels * 4);

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

    compiledScene.dispose();
    compiledScene.dispose();
    assert.deepEqual(disposeCounts, {
        triangle: 1,
        bvh: 1,
        material: 1,
    });
});

test('SceneCompiler normalizes mixed mesh attributes into finite GPU buffers', () => {
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
    assert.match(Struct, /struct LightSample/);
    assert.match(Light, /LightSample EvaluateEnvironmentLight/);
    assert.match(Light, /vec3 EvaluateSurfaceEmission/);
});

test('dielectric parameters are encoded where the shader decodes them', () => {
    const scene = new Scene();
    const geometry = new PlaneGeometry(1, 1);
    const material = new MeshPhysicalMaterial({ transmission: 0.75, ior: 1.33, thickness: 2 });
    scene.add(new Mesh(geometry, material));

    const compiledScene = new SceneCompiler().compile(scene);
    const data = compiledScene.material.dataTexture.image.data;
    // Texel 4 holds doubleSided, transmission, IOR, and thickness in xyzw.
    const texel4 = Array.from(data.subarray(16, 20));

    assert.deepEqual(texel4.slice(1), [0.75, Math.fround(1.33), 2]);
    assert.match(Utils, /material\.transmission = texel4\.y;/);
    assert.match(Utils, /material\.IOR = texel4\.z;/);
    assert.match(Utils, /material\.thickness = texel4\.w;/);

    compiledScene.dispose();
    geometry.dispose();
    material.dispose();
});

test('absorption reproduces attenuationColor after attenuationDistance', () => {
    const scene = new Scene();
    const geometry = new PlaneGeometry(1, 1);
    const tinted = new MeshPhysicalMaterial({
        transmission: 1,
        thickness: 1,
        attenuationColor: 0x80ff10,
        attenuationDistance: 0.4,
    });
    const clear = new MeshPhysicalMaterial({ transmission: 1, thickness: 1 });
    const opaque = new MeshStandardMaterial();
    for (const [index, material] of [tinted, clear, opaque].entries()) {
        const mesh = new Mesh(geometry, material);
        mesh.position.x = 2 * index;
        scene.add(mesh);
    }

    const compiledScene = new SceneCompiler().compile(scene);
    const data = compiledScene.material.dataTexture.image.data;
    const stride = gpuSceneLayout.material.stride;
    // Texel 5 holds the absorption coefficient; materials keep scene order.
    const absorption = (index) => Array.from(data.subarray(stride * index + 20, stride * index + 23));

    // Beer-Lambert over the attenuation distance must give the color back.
    const transmitted = absorption(0).map((coefficient) => Math.exp(-coefficient * 0.4));
    const expected = tinted.attenuationColor.toArray();
    transmitted.forEach((value, channel) => {
        assert.ok(Math.abs(value - expected[channel]) < 1e-6, `Channel ${channel}: ${value}`);
    });
    assert.deepEqual(absorption(1).map(Math.abs), [0, 0, 0]);
    assert.deepEqual(absorption(2), [0, 0, 0]);
    assert.match(Utils, /material\.absorption = texel5\.xyz;/);
    assert.match(Common, /throughput \*= exp\(-hit\.material\.absorption \* hit\.distance\);/);

    compiledScene.dispose();
    geometry.dispose();
    for (const material of [tinted, clear, opaque]) {
        material.dispose();
    }
});
