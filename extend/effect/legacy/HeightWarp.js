export const HEIGHT_WARP_VERTEX = /* glsl */ `
varying vec4 v_color;
varying vec2 v_uv;
uniform float u_factor;
uniform float u_radius;
uniform sampler2D u_bump;
void main() {
    v_color = texture2D(u_bump, uv);
    v_uv = uv;
    float height = v_color.r * u_factor;
    float scale = (u_radius + height) / u_radius;
    vec3 vposition = position * scale;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(vposition, 1.0);
}
`;

export const HEIGHT_WARP_FRAGMENT = /* glsl */ `
uniform vec3 u_color;
varying vec2 v_uv;
uniform sampler2D u_map;
void main() {
    gl_FragColor = vec4(u_color, 1.0) * texture2D(u_map, v_uv);
}
`;
