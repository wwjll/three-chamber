import { MaterialBase } from '../materials/MaterialBase'
import * as THREE from 'three';

import { Struct } from '../shaders/struct.glsl'
import { Material } from '../shaders/material.glsl'
import { Math } from '../shaders/math.glsl'
import { Utils } from '../shaders/utils.glsl'
import { Rand } from '../shaders/rand.glsl'
import { Ray } from '../shaders/ray.glsl'
import { Hit } from '../shaders/hit.glsl'
import { Brdf } from '../shaders/brdf.glsl'
import { Sample } from '../shaders/sample.glsl'
import { Common } from '../shaders/common.glsl'

export class PathTracingMaterial extends MaterialBase {
    constructor() {
        super({

            glslVersion: THREE.GLSL3,

            defines: {
                ENABLE_ENV_MISS_MIS: 1,
            },

            transparent: false,

            depthWrite: false,

            depthTest: false,

            uniforms: {
                samples: { type: "f", value: null },
                maxBounce: { type: "i", value: null },
                resolution: { type: "v2", value: null },
                matrixWorld: { type: "m4", value: null },
                projectionMatrixInverse: { type: "m4", value: null },
                texelsPerTriangle: { type: "f", value: null },
                texelsPerBVHNode: { type: "f", value: null },
                texelsPerMaterial: { type: "f", value: null },
                triangleDataTexture: { type: "t", value: null },
                triangleDataTextureSize: { type: "v2", value: null },
                bvhNodeDataTexture: { type: "t", value: null },
                bvhNodeDataTextureSize: { type: "v2", value: null },
                materialDataTexture: { type: "t", value: null },
                materialDataTextureSize: { type: "v2", value: null },
                outTexture: { type: "t", value: null },
                sceneAlbedoTextureArray: { type: 't', value: null },
                sceneNormalTextureArray: { type: 't', value: null },
                sceneMetallicRoughnessTextureArray: { type: 't', value: null },
                sceneEmissiveTextureArray: { type: 't', value: null },
                materialPreset: { type: "i", value: 0 },
                debugMode: { type: "i", value: 0 },
                hdrTexture: { type: "t", value: null },
                hdrConditionalDistributionTexture: { type: "t", value: null },
                hdrMarginalDistributionTexture: { type: "t", value: null },
                hdrResolution: { type: "v2", value: null },
                hdrTotalWeight: { type: "f", value: 0.0 },
                maxTransparentSteps: { type: "i", value: 2 },
            },

            vertexShader: /* glsl */`
                out vec3 pos;
                void main() {
                    gl_Position = vec4(position, 1.0);
                    pos = position;
                }
            `,
            fragmentShader: /* glsl */`
                #ifdef GL_FRAGMENT_PRECISION_HIGH
                    precision highp float;
                #else
                    precision mediump float;
                #endif

                #define PI 3.1415926535897
                #define TWO_PI 6.283185307179
                #define ONE_OVER_PI      0.31830988618
                #define ONE_OVER_TWO_PI  0.15915494309
                #define INFINITY 1000000.0
                #define EPSILON 0.00001
                // Keep determinant tolerance much smaller than barycentric / distance tolerances:
                // small triangles like FlightHelmet's hoses produce small but still valid det values.
                #define TRIANGLE_DETERMINANT_EPSILON 0.0000001
                #define TRIANGLE_BARYCENTRIC_EPSILON 0.00001
                #define TRIANGLE_DISTANCE_EPSILON 0.00001
                #define AABB_EPSILON 0.00001
                #define RAY_OFFSET_EPSILON 0.0002

                in vec3 pos;
                out highp vec4 pc_fragColor;
                uniform float samples;
                uniform int maxBounce;
                uniform vec2 resolution;
                uniform mat4 matrixWorld;
                uniform mat4 projectionMatrixInverse;
                uniform sampler2D hdrTexture;
                uniform sampler2D triangleDataTexture;
                uniform sampler2D bvhNodeDataTexture;
                uniform sampler2D materialDataTexture;
                uniform sampler2D outTexture;
                uniform highp sampler2DArray sceneAlbedoTextureArray;
                uniform highp sampler2DArray sceneNormalTextureArray;
                uniform highp sampler2DArray sceneMetallicRoughnessTextureArray;
                uniform highp sampler2DArray sceneEmissiveTextureArray;
                uniform int materialPreset;
                uniform int debugMode;
                uniform sampler2D hdrConditionalDistributionTexture;
                uniform sampler2D hdrMarginalDistributionTexture;
                uniform vec2 hdrResolution;
                uniform float hdrTotalWeight;
                uniform int maxTransparentSteps;
                // Compatibility shim for stale bundles that still reference the old
                // runtime MIS uniform name. The actual feature toggle now uses
                // ENABLE_DIRECT_ENV_MIS as a compile-time define.
                #define enableDirectEnvironmentMIS 0

                uniform float texelsPerTriangle;
                uniform float texelsPerBVHNode;
                uniform float texelsPerMaterial;
                uniform vec2 triangleDataTextureSize;
                uniform vec2 bvhNodeDataTextureSize;
                uniform vec2 materialDataTextureSize;

                uint seed;

                ${Struct}
                ${Material}
                ${Math}
                ${Utils}
                ${Rand}
                ${Ray}
                ${Hit}
                ${Brdf}
                ${Sample}

                bool hasTextureIndex(float textureIndex) {
                    return textureIndex >= 0.0;
                }

                vec4 sampleSceneAlbedoTexture(float textureIndex, vec2 uv) {
                    return texture(sceneAlbedoTextureArray, vec3(uv, textureIndex));
                }

                vec4 sampleSceneNormalTexture(float textureIndex, vec2 uv) {
                    return texture(sceneNormalTextureArray, vec3(uv, textureIndex));
                }

                vec4 sampleSceneMetallicRoughnessTexture(float textureIndex, vec2 uv) {
                    return texture(sceneMetallicRoughnessTextureArray, vec3(uv, textureIndex));
                }

                vec4 sampleSceneEmissiveTexture(float textureIndex, vec2 uv) {
                    return texture(sceneEmissiveTextureArray, vec3(uv, textureIndex));
                }

                ${Common}
            `
        })

        this.uniforms.hdrResolution.value = new THREE.Vector2(1, 1);
        this.uniforms.materialDataTextureSize.value = new THREE.Vector2(1, 1);
    }
}
