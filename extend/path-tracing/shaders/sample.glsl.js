const Sample =  /* glsl */`
    #define BSDF_EVENT_DIFFUSE uint(1)
    #define BSDF_EVENT_GLOSSY uint(2)
    #define BSDF_EVENT_REFLECTION uint(4)

    vec3 SampleCosineHemisphere() {
        beginRandomDomain(RNG_DOMAIN_COSINE_HEMISPHERE);
        float u1 = rand();
        float u2 = rand();
        float r = sqrt(u1);
        float phi = TWO_PI * u2;
        float x = r * cos(phi);
        float y = r * sin(phi);
        float z = sqrt(max(0.0, 1.0 - u1));
        return vec3(x, y, z);
    }

    vec3 toTangentFrame(vec3 v, vec3 tangent, vec3 bitangent, vec3 normal) {
        return normalize(v.x * tangent + v.y * bitangent + v.z * normal);
    }

    vec2 directionToEnvUV(vec3 direction) {
        float theta = asin(clamp(direction.y, -1.0, 1.0)) * ONE_OVER_PI + 0.5;
        float phi = atan(direction.z, direction.x) * ONE_OVER_TWO_PI + 0.5;
        return vec2(phi, theta);
    }

    vec3 SampleGGXHalfVector(float alpha, vec3 tangent, vec3 bitangent, vec3 normal) {
        beginRandomDomain(RNG_DOMAIN_GGX);
        float u1 = rand();
        float u2 = rand();
        float alphaSquared = alpha * alpha;
        float phi = TWO_PI * u1;
        float cosTheta = sqrt((1.0 - u2) / (1.0 + (alphaSquared - 1.0) * u2));
        float sinTheta = sqrt(max(0.0, 1.0 - cosTheta * cosTheta));
        vec3 localHalfVector = vec3(
            sinTheta * cos(phi),
            sinTheta * sin(phi),
            cosTheta
        );
        return toTangentFrame(localHalfVector, tangent, bitangent, normal);
    }

    BSDFSample SampleBSDF(
        vec3 viewDirection,
        vec3 surfaceNormal,
        vec3 tangent,
        vec3 bitangent,
        Material material
    ) {
        beginRandomDomain(RNG_DOMAIN_BRDF);
        float specularWeight = BSDFSpecularSampleWeight(material);
        bool sampleSpecular = rand() < specularWeight;
        vec3 sampledDirection;
        uint sampledFlags;

        if(sampleSpecular) {
            sampledFlags = BSDF_EVENT_GLOSSY | BSDF_EVENT_REFLECTION;
            float alpha = max(material.roughness * material.roughness, 0.001);
            vec3 halfVector = SampleGGXHalfVector(alpha, tangent, bitangent, surfaceNormal);
            sampledDirection = reflect(-viewDirection, halfVector);
            if(dot(sampledDirection, surfaceNormal) <= 0.0) {
                return BSDFSample(sampledDirection, vec3(0.0), 0.0, sampledFlags, false);
            }
        } else {
            sampledFlags = BSDF_EVENT_DIFFUSE | BSDF_EVENT_REFLECTION;
            sampledDirection = toTangentFrame(SampleCosineHemisphere(), tangent, bitangent, surfaceNormal);
        }

        float samplePdf = BSDFPDF(viewDirection, surfaceNormal, sampledDirection, material);
        float incomingCosine = max(dot(sampledDirection, surfaceNormal), 0.0);
        if(samplePdf <= EPSILON || incomingCosine <= 0.0) {
            return BSDFSample(sampledDirection, vec3(0.0), samplePdf, sampledFlags, false);
        }

        vec3 bsdf = BSDFEvaluate(
            viewDirection,
            surfaceNormal,
            sampledDirection,
            tangent,
            bitangent,
            material
        );
        vec3 sampleWeight = bsdf * incomingCosine / samplePdf;
        return BSDFSample(sampledDirection, sampleWeight, samplePdf, sampledFlags, true);
    }

`

export { Sample };
