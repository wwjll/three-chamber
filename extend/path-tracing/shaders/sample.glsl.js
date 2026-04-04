export const Sample =  /* glsl */`
    vec3 SampleHemisphere() {
        float z = rand();
        float r = max(0.0, sqrt(1.0 - z * z));
        float phi = 2.0 * PI * rand();
        return vec3(r * cos(phi), r * sin(phi), z);
    }

    vec3 SampleCosineHemisphere() {
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
    
    vec3 toNormalHemisphere(vec3 v, vec3 N) {
        vec3 helper = vec3(1, 0, 0);
        if (abs(N.x) > 0.999)
            helper = vec3(0, 0, 1);
        vec3 tangent = normalize(cross(N, helper));
        vec3 bitangent = normalize(cross(N, tangent));
        return v.x * tangent + v.y * bitangent + v.z * N;
    }

    vec3 SampleGGXHalfVector(float alpha, vec3 tangent, vec3 bitangent, vec3 normal) {
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

    vec3 SampleBRDFDirection(
        vec3 viewDirection,
        vec3 surfaceNormal,
        vec3 tangent,
        vec3 bitangent,
        Material material,
        out float samplePdf
    ) {
        float specularWeight = BRDFSpecularSampleWeight(material);
        bool sampleSpecular = rand() < specularWeight;
        vec3 sampledDirection;

        if(sampleSpecular) {
            float alpha = max(material.roughness * material.roughness, 0.001);
            vec3 halfVector = SampleGGXHalfVector(alpha, tangent, bitangent, surfaceNormal);
            sampledDirection = reflect(-viewDirection, halfVector);
            if(dot(sampledDirection, surfaceNormal) <= 0.0) {
                sampleSpecular = false;
            }
        }

        if(!sampleSpecular) {
            sampledDirection = toTangentFrame(SampleCosineHemisphere(), tangent, bitangent, surfaceNormal);
        }

        float diffusePdf = DiffusePDF(surfaceNormal, sampledDirection);
        float specularPdf = SpecularPDF(viewDirection, surfaceNormal, sampledDirection, material);
        samplePdf = (1.0 - specularWeight) * diffusePdf + specularWeight * specularPdf;
        return sampledDirection;
    }
    
    vec3 sampleHdr(Ray ray) {
        float theta = asin(ray.direction.y) * ONE_OVER_PI + 0.5;
        float phi = atan(ray.direction.z, ray.direction.x) * ONE_OVER_TWO_PI + 0.5;
        vec3 color = texture(hdrTexture, vec2(phi, theta)).rgb;
        // clamp to prevent hdr firefly
        return min(color, vec3(10.0));
    }

`
