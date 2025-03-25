import { MaterialBase } from '../materials/MaterialBase'

export class CopyMaterial extends MaterialBase {
    constructor() {
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

                void main() {
                    pc_fragColor = texelFetch(renderTexture, ivec2(gl_FragCoord.xy), 0);
                }
                
            `
        })
    }
}