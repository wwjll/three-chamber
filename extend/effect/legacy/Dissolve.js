export const DISSOLVE_VERTEX_COMMON = /* glsl */ `
varying vec2 xUv;
#include <common>
`;

export const DISSOLVE_VERTEX_UV = /* glsl */ `
xUv = uv;
#include <uv_vertex>
`;

export const DISSOLVE_FRAGMENT_COMMON = /* glsl */ `
#include <common>
uniform float dissolveProgress;
uniform float edgeWidth;
uniform vec3 edgeColor;
uniform sampler2D noiseTexture;
uniform sampler2D edgeColorTexture;
varying vec2 xUv;
`;

export const DISSOLVE_FRAGMENT_TYPE0 = /* glsl */ `
#include <dithering_fragment>
float noiseValue = texture2D(noiseTexture, xUv).r;
vec4 finalColor = linearToOutputTexel(vec4(edgeColor, gl_FragColor.a));
if (noiseValue > dissolveProgress) {
    discard;
}
if (noiseValue + edgeWidth > dissolveProgress) {
    gl_FragColor = vec4(finalColor.rgb, 1.0);
}
`;

export const DISSOLVE_FRAGMENT_TYPE1 = /* glsl */ `
#include <dithering_fragment>
float noiseValue = texture2D(noiseTexture, xUv).r;
vec4 finalColor = texture2D(edgeColorTexture, xUv);
float alpha = step(noiseValue - edgeWidth, dissolveProgress);
gl_FragColor.a = alpha;
float useOrigin = step(noiseValue, dissolveProgress);
gl_FragColor.rgb = mix(finalColor.rgb, gl_FragColor.rgb, useOrigin);
`;
