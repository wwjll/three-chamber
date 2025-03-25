export const Math =  /* glsl */`
    float sqr(float x) {
        return x * x;
    }

    void getTangent(vec3 N, inout vec3 tangent, inout vec3 bitangent) {
        vec3 helper = vec3(1, 0, 0);
        if(abs(N.x) > 0.999)
          helper = vec3(0, 0, 1);
        bitangent = normalize(cross(N, helper));
        tangent = normalize(cross(N, bitangent));
    }
`