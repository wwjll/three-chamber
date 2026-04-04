import { MaterialBase } from '../materials/MaterialBase'

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
                triangleDataTexture: { type: "t", value: null },
                triangleDataTextureSize: { type: "v2", value: null },
                bvhNodeDataTexture: { type: "t", value: null },
                bvhNodeDataTextureSize: { type: "v2", value: null },
                outTexture: { type: "t", value: null },
                albedoTexture: { type: "t", value: null },
                normalTexture: { type: "t", value: null },
                roughnessTexture: { type: "t", value: null },
                metalnessTexture: { type: "t", value: null },
                aoTexture: { type: "t", value: null },
                emissiveTexture: { type: "t", value: null },
                useAlbedoTexture: { type: "i", value: 0 },
                useNormalTexture: { type: "i", value: 0 },
                useRoughnessTexture: { type: "i", value: 0 },
                useMetalnessTexture: { type: "i", value: 0 },
                useAoTexture: { type: "i", value: 0 },
                useEmissiveTexture: { type: "i", value: 0 },
                baseColorFactor: { type: "v3", value: null },
                roughnessFactor: { type: "f", value: 1.0 },
                metalnessFactor: { type: "f", value: 0.0 },
                emissiveFactor: { type: "v3", value: null },
                normalScale: { type: "v2", value: null },
                aoIntensity: { type: "f", value: 1.0 },
                materialPreset: { type: "i", value: 0 },
                debugMode: { type: "i", value: 0 },
                hdrTexture: { type: "t", value: null },
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

                in vec3 pos;
                uniform float samples;
                uniform int maxBounce;
                uniform vec2 resolution;
                uniform mat4 matrixWorld;
                uniform mat4 projectionMatrixInverse;
                uniform sampler2D hdrTexture;
                uniform sampler2D triangleDataTexture;
                uniform sampler2D bvhNodeDataTexture;
                uniform sampler2D outTexture;
                uniform sampler2D albedoTexture;
                uniform sampler2D normalTexture;
                uniform sampler2D roughnessTexture;
                uniform sampler2D metalnessTexture;
                uniform sampler2D aoTexture;
                uniform sampler2D emissiveTexture;
                uniform int useAlbedoTexture;
                uniform int useNormalTexture;
                uniform int useRoughnessTexture;
                uniform int useMetalnessTexture;
                uniform int useAoTexture;
                uniform int useEmissiveTexture;
                uniform vec3 baseColorFactor;
                uniform float roughnessFactor;
                uniform float metalnessFactor;
                uniform vec3 emissiveFactor;
                uniform vec2 normalScale;
                uniform float aoIntensity;
                uniform int materialPreset;
                uniform int debugMode;

                uniform float texelsPerTriangle;
                uniform float texelsPerBVHNode;
                uniform vec2 triangleDataTextureSize;
                uniform vec2 bvhNodeDataTextureSize;

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
                ${Common}
            `
        })
    }
}
