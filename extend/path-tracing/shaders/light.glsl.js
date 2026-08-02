const Light = /* glsl */`
    #define LIGHT_EVENT_ENVIRONMENT uint(1)
    #define LIGHT_EVENT_SURFACE uint(2)

    LightSample EvaluateEnvironmentLight(Ray ray) {
        vec3 radiance = texture(hdrTexture, directionToEnvUV(ray.direction)).rgb;
        return LightSample(
            ray.direction,
            radiance,
            INFINITY,
            0.0,
            LIGHT_EVENT_ENVIRONMENT,
            true
        );
    }

    vec3 EvaluateSurfaceEmission(RayHit hit) {
        return hit.material.emissive;
    }
`

export { Light };
