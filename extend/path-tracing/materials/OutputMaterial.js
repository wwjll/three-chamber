import { MaterialBase } from '../materials/MaterialBase'

export class OutputMaterial extends MaterialBase {
    constructor(target, width, height) {
        super({

            transparent: false,

            depthWrite: false,

            depthTest: false,

            uniforms: {
                renderTexture: { type: "t", value: null },
                resolution: { type: "v2", value: null },
            },

            vertexShader: /* glsl */`
                void main() {
                    gl_Position = vec4(position, 1.0);
                }
            `,

            fragmentShader: /* glsl */`
                uniform sampler2D renderTexture;

                vec3 toneMapping(in vec3 c, float limit) {
                    float luminance = 0.3 * c.x + 0.6 * c.y + 0.1 * c.z;
                    return c * 1.0 / (1.0 + luminance / limit);
                }

                void main() {
                    vec3 outColor = texelFetch(renderTexture, ivec2(gl_FragCoord.xy), 0).rgb;
                    outColor = toneMapping(outColor, 1.5);
                    outColor = pow(outColor, vec3(1.0 / 2.2));
                    pc_fragColor = vec4(outColor, 1.0);
                }
                
            `
        })
    }
}