import { MaterialBase } from '../materials/MaterialBase.js'
import { GLSL3, Vector2, Vector3 } from 'three';

import { Struct } from '../shaders/struct.glsl.js'
import { Material } from '../shaders/material.glsl.js'
import { Math } from '../shaders/math.glsl.js'
import { Utils } from '../shaders/utils.glsl.js'
import { Rand } from '../shaders/rand.glsl.js'
import { Ray } from '../shaders/ray.glsl.js'
import { Hit } from '../shaders/hit.glsl.js'
import { Brdf } from '../shaders/brdf.glsl.js'
import { Sample } from '../shaders/sample.glsl.js'
import { Light } from '../shaders/light.glsl.js'
import { Common } from '../shaders/common.glsl.js'

class PathTracingMaterial extends MaterialBase {
    constructor() {
        super({

            glslVersion: GLSL3,

            transparent: false,

            depthWrite: false,

            depthTest: false,

            uniforms: {
                samples: { type: "f", value: null },
                maxBounce: { type: "i", value: null },
                resolution: { type: "v2", value: null },
                cameraOrigin: { type: "v3", value: null },
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
                maxTransparentSteps: { type: "i", value: 2 },
            },

            vertexShader: /* glsl */`
                void main() {
                    gl_Position = vec4(position, 1.0);
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

                out highp vec4 pc_fragColor;
                uniform float samples;
                uniform int maxBounce;
                uniform vec2 resolution;
                uniform vec3 cameraOrigin;
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
                uniform int maxTransparentSteps;

                uniform float texelsPerTriangle;
                uniform float texelsPerBVHNode;
                uniform float texelsPerMaterial;
                uniform vec2 triangleDataTextureSize;
                uniform vec2 bvhNodeDataTextureSize;
                uniform vec2 materialDataTextureSize;

                uint seed;
                uint rngDomain;
                uint rngDimensionCounter;
                uint rngBounce;

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

                ${Light}
                ${Common}
            `
        })

        this.uniforms.cameraOrigin.value = new Vector3();
        this.uniforms.materialDataTextureSize.value = new Vector2(1, 1);
    }
}

export { PathTracingMaterial };
