const Sample =  /* glsl */`
    #define BSDF_EVENT_DIFFUSE uint(1)
    #define BSDF_EVENT_GLOSSY uint(2)
    #define BSDF_EVENT_REFLECTION uint(4)
    #define BSDF_EVENT_TRANSMISSION uint(8)
    #define BSDF_EVENT_DELTA uint(16)

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

    // Unpolarized Fresnel reflectance of a smooth dielectric interface.
    // relativeIor is eta_i / eta_t; past the critical angle it returns 1.
    float FresnelDielectric(float cosThetaI, float relativeIor) {
        float sinThetaTSquared = relativeIor * relativeIor * (1.0 - cosThetaI * cosThetaI);
        if(sinThetaTSquared >= 1.0) {
            return 1.0;
        }
        float cosThetaT = sqrt(1.0 - sinThetaTSquared);
        float perpendicular = (relativeIor * cosThetaI - cosThetaT) / (relativeIor * cosThetaI + cosThetaT);
        float parallel = (cosThetaI - relativeIor * cosThetaT) / (cosThetaI + relativeIor * cosThetaT);
        return 0.5 * (perpendicular * perpendicular + parallel * parallel);
    }

    // Smooth glass is a pair of delta lobes: reflect with the Fresnel
    // probability, refract otherwise, so each weight is the lobe value over
    // its own probability. A back-face hit leaves the medium. Zero thickness
    // means a thin wall, as in glTF without KHR_materials_volume: light
    // crosses both interfaces at once and keeps its direction.
    BSDFSample SampleDielectricBSDF(
        vec3 viewDirection,
        vec3 surfaceNormal,
        Material material,
        bool backFace
    ) {
        bool thinWalled = material.thickness <= 0.0;
        float relativeIor = backFace && !thinWalled ? material.IOR : 1.0 / material.IOR;
        float cosThetaI = clamp(dot(viewDirection, surfaceNormal), 0.0, 1.0);
        float reflectance = FresnelDielectric(cosThetaI, relativeIor);

        if(rand() < reflectance) {
            return BSDFSample(
                reflect(-viewDirection, surfaceNormal),
                vec3(1.0),
                reflectance,
                BSDF_EVENT_DELTA | BSDF_EVENT_REFLECTION,
                true
            );
        }

        uint transmissionFlags = BSDF_EVENT_DELTA | BSDF_EVENT_TRANSMISSION;
        if(thinWalled) {
            return BSDFSample(-viewDirection, material.baseColor, 1.0 - reflectance, transmissionFlags, true);
        }

        // Radiance changes by (eta_t / eta_i)^2 across the interface, so a
        // camera path carries the inverse factor. It cancels once the path
        // leaves the object again (Veach 1997, section 5.2).
        return BSDFSample(
            normalize(refract(-viewDirection, surfaceNormal, relativeIor)),
            material.baseColor * relativeIor * relativeIor,
            1.0 - reflectance,
            transmissionFlags,
            true
        );
    }

    BSDFSample SampleOpaqueBSDF(
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

    // Transmission blends the dielectric part of the material into glass,
    // as three.js does; metals stay opaque. The lobe is chosen with its blend
    // weight, so that weight cancels from the sample weight and only scales
    // the reported PDF.
    BSDFSample SampleBSDF(
        vec3 viewDirection,
        vec3 surfaceNormal,
        vec3 tangent,
        vec3 bitangent,
        Material material,
        bool backFace
    ) {
        beginRandomDomain(RNG_DOMAIN_TRANSMISSION);
        float transmissionWeight = material.transmission * (1.0 - material.metallic);
        if(rand() < transmissionWeight) {
            BSDFSample dielectricSample = SampleDielectricBSDF(viewDirection, surfaceNormal, material, backFace);
            dielectricSample.pdf *= transmissionWeight;
            return dielectricSample;
        }

        BSDFSample opaqueSample = SampleOpaqueBSDF(viewDirection, surfaceNormal, tangent, bitangent, material);
        opaqueSample.pdf *= 1.0 - transmissionWeight;
        return opaqueSample;
    }

`

export { Sample };
