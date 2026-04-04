export const Common =  /* glsl */`
    #define MAX_BOUNCE_LOOP 8

    void applyOriginMaterial(inout RayHit hit) {
        if(materialPreset != 0) {
            return;
        }

        hit.material.baseColor = baseColorFactor;
        if(useAlbedoTexture == 1) {
            hit.material.baseColor *= texture(albedoTexture, hit.uv).rgb;
        }

        hit.material.roughness = clamp(roughnessFactor, 0.02, 1.0);
        if(useRoughnessTexture == 1) {
            hit.material.roughness *= texture(roughnessTexture, hit.uv).g;
        }
        hit.material.roughness = clamp(hit.material.roughness, 0.02, 1.0);

        hit.material.metallic = clamp(metalnessFactor, 0.0, 1.0);
        if(useMetalnessTexture == 1) {
            hit.material.metallic *= texture(metalnessTexture, hit.uv).b;
        }
        hit.material.metallic = clamp(hit.material.metallic, 0.0, 1.0);

        hit.material.emissive = emissiveFactor;
        if(useEmissiveTexture == 1) {
            hit.material.emissive *= texture(emissiveTexture, hit.uv).rgb;
        }

        if(useAoTexture == 1) {
            float ao = mix(1.0, texture(aoTexture, hit.uv).r, clamp(aoIntensity, 0.0, 1.0));
            hit.material.baseColor *= ao;
        }

        if(useNormalTexture == 1) {
            vec3 tangentSpaceNormal = texture(normalTexture, hit.uv).xyz * 2.0 - 1.0;
            tangentSpaceNormal.xy *= normalScale;
            tangentSpaceNormal = normalize(tangentSpaceNormal);
            hit.normal = normalize(
                hit.tangent * tangentSpaceNormal.x +
                hit.bitangent * tangentSpaceNormal.y +
                hit.normal * tangentSpaceNormal.z
            );
        }
    }

    vec3 pathTrace() {
        Ray ray = createCameraRay();
    
        vec3 emittedRadiance = vec3(0.0);
        vec3 indirectRadiance = vec3(0.0);
        vec3 throughput = vec3(1.0);
    
        // Use a compile-time bounded loop for better ANGLE backend compatibility.
        for(int bounce = 0; bounce < MAX_BOUNCE_LOOP; bounce++) {
            if(bounce >= maxBounce) break;
            // Russia Roulette
            float survivalProb = min(1.0, max(throughput.r, max(throughput.g, throughput.b)));
            if(rand() > survivalProb) break;
            throughput /= survivalProb;

            RayHit hit = hitScene(ray);
            if(hit.isHit) {
                applyOriginMaterial(hit);

                if(debugMode == 1) {
                    return hit.material.baseColor;
                }
                if(debugMode == 2) {
                    return vec3(hit.uv, 0.0);
                }
                if(debugMode == 3) {
                    return vec3(fract(hit.uv), 0.0);
                }
                if(debugMode == 4) {
                    float checker = mod(floor(hit.uv.x * 20.0) + floor(hit.uv.y * 20.0), 2.0);
                    return vec3(checker);
                }
        
                if(bounce == 0) {
                    emittedRadiance = hit.material.emissive;
                }
        
                vec3 viewDirection = -hit.rayDirec;
                vec3 surfaceNormal = hit.normal;
                vec3 tangent, bitangent;
                getTangent(surfaceNormal, tangent, bitangent);

                float samplePdf = 0.0;
                vec3 sampledDirection = SampleBRDFDirection(
                    viewDirection,
                    surfaceNormal,
                    tangent,
                    bitangent,
                    hit.material,
                    samplePdf
                );
                float incomingCosine = max(0.0, dot(sampledDirection, surfaceNormal));
                if(samplePdf <= EPSILON || incomingCosine <= 0.0) {
                    break;
                }
        
                vec3 brdf = BRDF_Evaluate(viewDirection, surfaceNormal, sampledDirection, tangent, bitangent, hit.material);
        
                // ray reflection
                ray.origin = hit.position + hit.normal * EPSILON;
                ray.direction = sampledDirection;
                RayHit bounceHit = hitScene(ray);
                if(bounceHit.isHit) {
                    applyOriginMaterial(bounceHit);
                }
        
                // miss
                if(!bounceHit.isHit) {
                    vec3 skyColor = sampleHdr(ray);
                    indirectRadiance += throughput * skyColor * brdf * incomingCosine / samplePdf;
                    break;
                }
        
                // accumulate energy
                vec3 emissiveRadiance = bounceHit.material.emissive;
                indirectRadiance += throughput * emissiveRadiance * brdf * incomingCosine / samplePdf;
        
                // next recursion
                hit = bounceHit;
                throughput *= brdf * incomingCosine / samplePdf;
        
            } else {
                return sampleHdr(ray);
            }
        }
        return emittedRadiance + indirectRadiance;
    }
    
    void main(void) {
    
        seed = updateSeed(resolution.x, resolution.y, samples);
        
        vec3 sampleRadiance = pathTrace();
        vec3 accumulatedRadiance = texelFetch(outTexture, ivec2(gl_FragCoord.xy), 0).rgb;
        float accumulationWeight = 1.0 / (1.0 + samples);
        pc_fragColor = vec4(mix(accumulatedRadiance, sampleRadiance, accumulationWeight), 1.0);
    }
`
