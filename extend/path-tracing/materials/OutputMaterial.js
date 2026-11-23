import { MaterialBase } from '../materials/MaterialBase.js'

class OutputMaterial extends MaterialBase {
    constructor() {
        super({

            transparent: false,

            depthWrite: false,

            depthTest: false,

            uniforms: {
                renderTexture: { type: "t", value: null },
                diagnosticSummaryTexture: { type: "t", value: null },
                diagnosticMetricsTexture: { type: "t", value: null },
                diagnosticMode: { type: "i", value: 0 },
                diagnosticMaxBounce: { type: "f", value: 1.0 },
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
                uniform sampler2D diagnosticSummaryTexture;
                uniform sampler2D diagnosticMetricsTexture;
                uniform int diagnosticMode;
                uniform float diagnosticMaxBounce;
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

                vec3 heatMap(float value) {
                    value = clamp(value, 0.0, 1.0);
                    return clamp(
                        vec3(
                            1.5 - abs(4.0 * value - 3.0),
                            1.5 - abs(4.0 * value - 2.0),
                            1.5 - abs(4.0 * value - 1.0)
                        ),
                        0.0,
                        1.0
                    );
                }

                vec3 terminationColor(float reason) {
                    if(reason < 1.5) return vec3(0.12, 0.42, 0.95);
                    if(reason < 2.5) return vec3(0.92, 0.72, 0.12);
                    if(reason < 3.5) return vec3(0.95, 0.20, 0.12);
                    if(reason < 4.5) return vec3(0.24, 0.24, 0.27);
                    if(reason < 5.5) return vec3(0.68, 0.30, 0.88);
                    if(reason < 6.5) return vec3(1.0, 0.0, 0.65);
                    return vec3(0.0);
                }

                vec3 eventColor(float flags) {
                    float diffuse = mod(floor(flags / 1.0), 2.0);
                    float glossy = mod(floor(flags / 2.0), 2.0);
                    float reflection = mod(floor(flags / 4.0), 2.0);
                    return vec3(glossy, diffuse, reflection * 0.65 + glossy * 0.35);
                }

                vec3 failureColor(float flags) {
                    if(flags < 0.5) return vec3(0.03, 0.06, 0.04);
                    float extreme = mod(floor(flags / 128.0), 2.0);
                    float nonFinite = step(0.5, flags - extreme * 128.0);
                    return mix(vec3(1.0, 0.58, 0.0), vec3(1.0, 0.0, 0.55), nonFinite);
                }

                vec3 renderDiagnostic(ivec2 pixel) {
                    vec4 summary = texelFetch(diagnosticSummaryTexture, pixel, 0);
                    vec4 metrics = texelFetch(diagnosticMetricsTexture, pixel, 0);

                    if(diagnosticMode == 1) {
                        return heatMap(summary.r / max(diagnosticMaxBounce + 1.0, 1.0));
                    }
                    if(diagnosticMode == 2) {
                        return terminationColor(summary.g);
                    }
                    if(diagnosticMode == 3) {
                        return eventColor(summary.b);
                    }
                    if(diagnosticMode == 4) {
                        return heatMap((log2(max(metrics.r, 1e-12)) + 20.0) / 20.0);
                    }
                    if(diagnosticMode == 5) {
                        return heatMap(log2(1.0 + max(metrics.g, 0.0)) / 8.0);
                    }
                    if(diagnosticMode == 6) {
                        return heatMap(log2(1.0 + max(metrics.b, 0.0)) / 12.0);
                    }
                    return failureColor(metrics.a);
                }

                void main() {
                    ivec2 pixel = ivec2(gl_FragCoord.xy);
                    if(diagnosticMode != 0) {
                        pc_fragColor = vec4(renderDiagnostic(pixel), 1.0);
                        return;
                    }

                    vec3 outColor = texelFetch(renderTexture, pixel, 0).rgb;
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
