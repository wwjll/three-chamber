const Common =  /* glsl */`
    #define MAX_BOUNCE_LOOP 8
    #define MAX_SAMPLE_CONTRIBUTION 10.0
    #define MAX_THROUGHPUT_LUMINANCE 8.0
    #define MAX_TRANSPARENT_SURFACE_STEPS 8

    vec3 clampContribution(vec3 contribution, float maxLuminance) {
        float contributionLuminance = luminance(contribution);
        if(contributionLuminance <= maxLuminance) {
            return contribution;
        }
        return contribution * (maxLuminance / max(contributionLuminance, EPSILON));
    }

    vec3 materialIdDebugColor(float materialIndex) {
        float id = materialIndex + 1.0;
        return fract(vec3(id * 0.37, id * 0.61, id * 0.83));
    }

    Material getSceneSurfaceMaterial(float materialIndex, vec2 uv, out vec3 baseColor, out float alpha) {
        Material sceneMaterial = getSceneMaterial(materialIndex);
        baseColor = sceneMaterial.baseColor;
        alpha = sceneMaterial.alpha;

        if(hasTextureIndex(sceneMaterial.albedoTextureIndex)) {
            vec4 albedoSample = sampleSceneAlbedoTexture(sceneMaterial.albedoTextureIndex, uv);
            baseColor *= albedoSample.rgb;
            alpha *= albedoSample.a;
        }

        return sceneMaterial;
    }

    void applyResolvedSceneMaterial(inout RayHit hit, Material sceneMaterial, vec3 resolvedBaseColor, float resolvedAlpha) {
        hit.material.alpha = resolvedAlpha;
        hit.material.alphaMode = sceneMaterial.alphaMode;
        hit.material.doubleSided = sceneMaterial.doubleSided;
        hit.material.baseColor = resolvedBaseColor;

        hit.material.roughness = clamp(sceneMaterial.roughness, 0.02, 1.0);
        if(hasTextureIndex(sceneMaterial.metallicRoughnessTextureIndex)) {
            hit.material.roughness *= sampleSceneMetallicRoughnessTexture(sceneMaterial.metallicRoughnessTextureIndex, hit.uv).g;
        }
        hit.material.roughness = clamp(hit.material.roughness, 0.02, 1.0);

        hit.material.metallic = clamp(sceneMaterial.metallic, 0.0, 1.0);
        if(hasTextureIndex(sceneMaterial.metallicRoughnessTextureIndex)) {
            hit.material.metallic *= sampleSceneMetallicRoughnessTexture(sceneMaterial.metallicRoughnessTextureIndex, hit.uv).b;
        }
        hit.material.metallic = clamp(hit.material.metallic, 0.0, 1.0);

        hit.material.emissive = sceneMaterial.emissive;
        if(hasTextureIndex(sceneMaterial.emissiveTextureIndex)) {
            hit.material.emissive *= sampleSceneEmissiveTexture(sceneMaterial.emissiveTextureIndex, hit.uv).rgb;
        }

        if(hasTextureIndex(sceneMaterial.normalTextureIndex)) {
            vec3 tangentSpaceNormal = sampleSceneNormalTexture(sceneMaterial.normalTextureIndex, hit.uv).xyz * 2.0 - 1.0;
            tangentSpaceNormal.xy *= sceneMaterial.normalScale;
            tangentSpaceNormal = normalize(tangentSpaceNormal);
            hit.normal = normalize(
                hit.tangent * tangentSpaceNormal.x +
                hit.bitangent * tangentSpaceNormal.y +
                hit.normal * tangentSpaceNormal.z
            );
            if(dot(hit.normal, hit.geometricNormal) < 0.0) {
                hit.normal = -hit.normal;
            }
        }

        if(dot(hit.normal, -hit.rayDirec) < 0.0) {
            hit.normal = -hit.normal;
        }
    }

    RayHit traceScene(Ray ray, inout vec3 transmissionFilter) {
        Ray currentRay;
        currentRay.origin = ray.origin;
        currentRay.direction = ray.direction;

        if(materialPreset != 0) {
            return hitScene(currentRay);
        }

        for(int surfaceStep = 0; surfaceStep < MAX_TRANSPARENT_SURFACE_STEPS; ++surfaceStep) {
            if(surfaceStep >= maxTransparentSteps) {
                break;
            }

            RayHit hit = hitScene(currentRay);
            if(!hit.isHit) {
                return hit;
            }

            vec3 surfaceBaseColor = vec3(1.0);
            float surfaceAlpha = 1.0;
            Material sceneMaterial = getSceneSurfaceMaterial(hit.materialIndex, hit.uv, surfaceBaseColor, surfaceAlpha);

            if(sceneMaterial.alphaMode >= 0.5 && sceneMaterial.alphaMode < 1.5 && surfaceAlpha < 0.5) {
                currentRay.origin = hit.position + currentRay.direction * RAY_OFFSET_EPSILON * 2.0;
            } else if(sceneMaterial.alphaMode >= 1.5 && surfaceAlpha < 1.0 - EPSILON) {
                transmissionFilter *= mix(vec3(1.0), surfaceBaseColor, clamp(surfaceAlpha, 0.0, 1.0));
                currentRay.origin = hit.position + currentRay.direction * RAY_OFFSET_EPSILON * 2.0;
            } else {
                applyResolvedSceneMaterial(hit, sceneMaterial, surfaceBaseColor, surfaceAlpha);
                return hit;
            }
        }

        return createHit();
    }

    vec3 renderDebugHit(
        RayHit hit,
        vec3 materialBase,
        float materialRoughness,
        float materialMetallic,
        vec3 materialEmissive
    ) {
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
        if(debugMode == 5) {
            return materialIdDebugColor(hit.materialIndex);
        }
        if(debugMode == 6) {
            return materialBase;
        }
        if(debugMode == 7) {
            return vec3(materialRoughness);
        }
        if(debugMode == 8) {
            return vec3(materialMetallic);
        }
        if(debugMode == 9) {
            return materialEmissive;
        }

        vec3 viewDirection = -hit.rayDirec;
        vec3 surfaceGeometricNormal = hit.geometricNormal;

        if(debugMode == 10) {
            float facing = abs(dot(surfaceGeometricNormal, viewDirection));
            return materialBase * max(facing, 0.15);
        }
        if(debugMode == 11) {
            return surfaceGeometricNormal * 0.5 + 0.5;
        }
        if(debugMode == 12) {
            // FlightHelmet's HoseMat is material 0 in the source glTF and
            // remains first under the current SceneGenerator traversal order.
            return hit.materialIndex < 0.5 ? vec3(1.0, 0.1, 0.1) : vec3(0.02);
        }
        if(debugMode == 13) {
            float normalizedDistance = clamp(hit.distance / 2.0, 0.0, 1.0);
            return vec3(normalizedDistance);
        }

        return materialBase;
    }

    #ifdef ENABLE_DIRECT_ENV_MIS
    vec3 sampleDirectEnvironmentMIS(
        RayHit hit,
        vec3 viewDirection,
        vec3 surfaceNormal,
        vec3 tangent,
        vec3 bitangent,
        vec3 throughput
    ) {
        float environmentPdf = 0.0;
        vec3 lightDirection = SampleEnvironmentDirection(environmentPdf);
        float incomingCosine = max(dot(surfaceNormal, lightDirection), 0.0);
        if(environmentPdf <= EPSILON || incomingCosine <= 0.0) {
            return vec3(0.0);
        }

        Ray shadowRay;
        shadowRay.origin = hit.position + hit.geometricNormal * (RAY_OFFSET_EPSILON * (dot(lightDirection, hit.geometricNormal) >= 0.0 ? 1.0 : -1.0));
        shadowRay.direction = lightDirection;

        vec3 transmissionFilter = vec3(1.0);
        RayHit shadowHit = traceScene(shadowRay, transmissionFilter);
        if(shadowHit.isHit) {
            return vec3(0.0);
        }

        vec3 environmentRadiance = sampleHdr(shadowRay);
        vec3 brdf = BRDF_Evaluate(viewDirection, surfaceNormal, lightDirection, tangent, bitangent, hit.material);
        float brdfPdf = BRDFPDF(viewDirection, surfaceNormal, lightDirection, hit.material);
        float environmentWeight = MISPowerWeight(environmentPdf, brdfPdf);
        return clampContribution(
            throughput * transmissionFilter * environmentRadiance * brdf * incomingCosine * environmentWeight / environmentPdf,
            MAX_SAMPLE_CONTRIBUTION
        );
    }
    #endif

    vec3 pathTrace() {
        Ray cameraRay = createCameraRay();
        Ray ray;
        ray.origin = cameraRay.origin;
        ray.direction = cameraRay.direction;
    
        vec3 emittedRadiance = vec3(0.0);
        vec3 indirectRadiance = vec3(0.0);
        vec3 throughput = vec3(1.0);
    
        // Use a compile-time bounded loop for better ANGLE backend compatibility.
        for(int bounce = 0; bounce < MAX_BOUNCE_LOOP; bounce++) {
            if(bounce >= maxBounce) break;
            setRandomBounce(uint(bounce));
            // Russia Roulette
            beginRandomDomain(RNG_DOMAIN_RUSSIAN_ROULETTE);
            float survivalProb = min(1.0, max(throughput.r, max(throughput.g, throughput.b)));
            if(rand() > survivalProb) break;
            throughput /= survivalProb;

            vec3 surfaceFilter = vec3(1.0);
            RayHit hit = traceScene(ray, surfaceFilter);
            if(hit.isHit) {
                throughput *= surfaceFilter;

                if(debugMode != 0) {
                    return renderDebugHit(
                        hit,
                        hit.material.baseColor,
                        hit.material.roughness,
                        hit.material.metallic,
                        hit.material.emissive
                    );
                }
                if(bounce == 0) {
                    emittedRadiance = hit.material.emissive;
                }
        
                vec3 viewDirection = -hit.rayDirec;
                vec3 surfaceGeometricNormal = hit.geometricNormal;
                vec3 surfaceNormal = hit.normal;
                vec3 tangent = hit.tangent;
                vec3 bitangent = hit.bitangent;

                // Thin double-sided geometry is more stable when the sampling hemisphere
                // is anchored to the geometric normal instead of the perturbed normal map.
                if(hit.material.doubleSided > 0.5) {
                    surfaceNormal = surfaceGeometricNormal;
                    getTangent(surfaceNormal, tangent, bitangent);
                }

                #ifdef ENABLE_DIRECT_ENV_MIS
                if(bounce == 0 && hit.material.roughness >= 0.25) {
                    float specularSampleWeight = BRDFSpecularSampleWeight(hit.material);
                    if(specularSampleWeight < 0.75) {
                        indirectRadiance += sampleDirectEnvironmentMIS(
                            hit,
                            viewDirection,
                            surfaceNormal,
                            tangent,
                            bitangent,
                            throughput
                        );
                    }
                }
                #endif

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
                float offsetDirection = dot(sampledDirection, surfaceGeometricNormal) >= 0.0 ? 1.0 : -1.0;
                ray.origin = hit.position + surfaceGeometricNormal * (RAY_OFFSET_EPSILON * offsetDirection);
                ray.direction = sampledDirection;
                vec3 bounceFilter = vec3(1.0);
                RayHit bounceHit = traceScene(ray, bounceFilter);
        
                // miss
                if(!bounceHit.isHit) {
                    vec3 skyColor = sampleHdr(ray);
                    #ifdef ENABLE_ENV_MISS_MIS
                    float environmentPdf = EnvironmentPDF(sampledDirection);
                    float brdfWeight = MISPowerWeight(samplePdf, environmentPdf);
                    vec3 skyContribution = throughput * bounceFilter * skyColor * brdf * incomingCosine * brdfWeight / samplePdf;
                    #else
                    vec3 skyContribution = throughput * bounceFilter * skyColor * brdf * incomingCosine / samplePdf;
                    #endif
                    indirectRadiance += clampContribution(skyContribution, MAX_SAMPLE_CONTRIBUTION);
                    break;
                }
        
                // accumulate energy
                vec3 emissiveRadiance = bounceHit.material.emissive;
                vec3 emissiveContribution = throughput * bounceFilter * emissiveRadiance * brdf * incomingCosine / samplePdf;
                indirectRadiance += clampContribution(emissiveContribution, MAX_SAMPLE_CONTRIBUTION);
        
                // next recursion
                throughput *= bounceFilter;
                throughput *= brdf * incomingCosine / samplePdf;
                throughput = clampContribution(throughput, MAX_THROUGHPUT_LUMINANCE);
        
            } else {
                return throughput * surfaceFilter * sampleHdr(ray);
            }
        }
        return emittedRadiance + indirectRadiance;
    }
    
    void main(void) {
    
        seed = updateSeed(samples);
        
        vec3 sampleRadiance = pathTrace();
        vec3 accumulatedRadiance = texelFetch(outTexture, ivec2(gl_FragCoord.xy), 0).rgb;
        float accumulationWeight = 1.0 / (1.0 + samples);
        pc_fragColor = vec4(mix(accumulatedRadiance, sampleRadiance, accumulationWeight), 1.0);
    }
`

export { Common };
