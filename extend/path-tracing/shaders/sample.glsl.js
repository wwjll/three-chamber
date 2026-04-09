const Sample =  /* glsl */`
    #define MAX_ENV_CDF_BINARY_SEARCH_STEPS 12

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

    vec2 directionToEnvUV(vec3 direction) {
        float theta = asin(clamp(direction.y, -1.0, 1.0)) * ONE_OVER_PI + 0.5;
        float phi = atan(direction.z, direction.x) * ONE_OVER_TWO_PI + 0.5;
        return vec2(phi, theta);
    }

    vec3 envUVToDirection(vec2 uv) {
        float latitude = (uv.y - 0.5) * PI;
        float phi = (uv.x - 0.5) * TWO_PI;
        float cosLatitude = cos(latitude);
        return normalize(vec3(
            cos(phi) * cosLatitude,
            sin(latitude),
            sin(phi) * cosLatitude
        ));
    }

    int binarySearchMarginalCDF(float value) {
        int low = 0;
        int high = int(hdrResolution.y) - 1;
        for (int i = 0; i < MAX_ENV_CDF_BINARY_SEARCH_STEPS; i++) {
            if (low >= high) {
                break;
            }
            int mid = (low + high) / 2;
            float cdf = texelFetch(hdrMarginalDistributionTexture, ivec2(mid, 0), 0).r;
            if (value <= cdf) {
                high = mid;
            } else {
                low = mid + 1;
            }
        }
        return clamp(low, 0, int(hdrResolution.y) - 1);
    }

    int binarySearchConditionalCDF(int row, float value) {
        int low = 0;
        int high = int(hdrResolution.x) - 1;
        for (int i = 0; i < MAX_ENV_CDF_BINARY_SEARCH_STEPS; i++) {
            if (low >= high) {
                break;
            }
            int mid = (low + high) / 2;
            float cdf = texelFetch(hdrConditionalDistributionTexture, ivec2(mid, row), 0).r;
            if (value <= cdf) {
                high = mid;
            } else {
                low = mid + 1;
            }
        }
        return clamp(low, 0, int(hdrResolution.x) - 1);
    }

    float EnvironmentPDF(vec3 direction) {
        if (hdrTotalWeight <= EPSILON) {
            return 0.0;
        }

        vec2 uv = directionToEnvUV(direction);
        vec3 radiance = min(texture(hdrTexture, uv).rgb, vec3(10.0));
        float environmentLuminance = luminance(radiance);
        return max(environmentLuminance, 0.0) * hdrResolution.x * hdrResolution.y / max(2.0 * PI * PI * hdrTotalWeight, EPSILON);
    }

    vec3 SampleEnvironmentDirection(out float samplePdf) {
        if (hdrTotalWeight <= EPSILON) {
            samplePdf = 0.0;
            return vec3(0.0, 1.0, 0.0);
        }

        int row = binarySearchMarginalCDF(rand());
        int column = binarySearchConditionalCDF(row, rand());
        vec2 uv = (vec2(float(column), float(row)) + vec2(0.5)) / hdrResolution;
        vec3 direction = envUVToDirection(uv);
        samplePdf = EnvironmentPDF(direction);
        return direction;
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

        samplePdf = BRDFPDF(viewDirection, surfaceNormal, sampledDirection, material);
        return sampledDirection;
    }
    
    vec3 sampleHdr(Ray ray) {
        vec3 color = texture(hdrTexture, directionToEnvUV(ray.direction)).rgb;
        // clamp to prevent hdr firefly
        return min(color, vec3(10.0));
    }

`

export { Sample };
