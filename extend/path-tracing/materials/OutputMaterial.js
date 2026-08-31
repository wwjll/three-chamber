import { MaterialBase } from '../materials/MaterialBase.js'

class OutputMaterial extends MaterialBase {
    constructor() {
        super({

            transparent: false,

            depthWrite: false,

            depthTest: false,

            uniforms: {
                renderTexture: { type: "t", value: null },
                toneMappingMode: { type: "i", value: 2 },
                exposure: { type: "f", value: 1.0 },
            },

            vertexShader: /* glsl */`
                void main() {
                    gl_Position = vec4(position, 1.0);
                }
            `,

            fragmentShader: /* glsl */`
                uniform sampler2D renderTexture;
                uniform int toneMappingMode;
                uniform float exposure;

                vec3 reinhardToneMapping(vec3 color) {
                    return color / (1.0 + color);
                }

                vec3 acesToneMapping(vec3 color) {
                    const float a = 2.51;
                    const float b = 0.03;
                    const float c = 2.43;
                    const float d = 0.59;
                    const float e = 0.14;
                    return clamp((color * (a * color + b)) / (color * (c * color + d) + e), 0.0, 1.0);
                }

                vec3 applyToneMapping(vec3 color) {
                    if(toneMappingMode == 1) {
                        return reinhardToneMapping(color);
                    }
                    if(toneMappingMode == 2) {
                        return acesToneMapping(color);
                    }
                    return color;
                }

                void main() {
                    vec3 outColor = texelFetch(renderTexture, ivec2(gl_FragCoord.xy), 0).rgb;
                    outColor *= exposure;
                    outColor = applyToneMapping(outColor);
                    outColor = pow(outColor, vec3(1.0 / 2.2));
                    pc_fragColor = vec4(outColor, 1.0);
                }
                
            `
        })
    }
}

export { OutputMaterial };
