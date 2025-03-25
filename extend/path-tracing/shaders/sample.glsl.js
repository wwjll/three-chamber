export const Sample =  /* glsl */`
    vec3 SampleHemisphere() {
        float z = rand();
        float r = max(0.0, sqrt(1.0 - z * z));
        float phi = 2.0 * PI * rand();
        return vec3(r * cos(phi), r * sin(phi), z);
    }
    
    vec3 toNormalHemisphere(vec3 v, vec3 N) {
        vec3 helper = vec3(1, 0, 0);
        if (abs(N.x) > 0.999)
            helper = vec3(0, 0, 1);
        vec3 tangent = normalize(cross(N, helper));
        vec3 bitangent = normalize(cross(N, tangent));
        return v.x * tangent + v.y * bitangent + v.z * N;
    }
    
    vec3 sampleHdr(Ray ray) {
        float theta = asin(ray.direction.y) * ONE_OVER_PI + 0.5;
        float phi = atan(ray.direction.z, ray.direction.x) * ONE_OVER_TWO_PI + 0.5;
        vec3 color = texture(hdrTexture, vec2(phi, theta)).rgb;
        // clamp to prevent hdr firefly
        return min(color, vec3(10.0));
    }

`