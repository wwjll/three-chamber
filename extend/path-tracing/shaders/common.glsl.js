import { maxPathBounces, maxTransparentSteps } from '../Constants.js'

const Common =  /* glsl */`
    #define MAX_BOUNCES ${maxPathBounces}
    #define RUSSIAN_ROULETTE_START_DEPTH 3
    #define MAX_TRANSPARENT_SURFACE_STEPS ${maxTransparentSteps}

    #define PATH_TERMINATION_NONE 0
    #define PATH_TERMINATION_ENVIRONMENT 1
    #define PATH_TERMINATION_MAX_DEPTH 2
    #define PATH_TERMINATION_INVALID_BSDF 3
    #define PATH_TERMINATION_ZERO_THROUGHPUT 4
    #define PATH_TERMINATION_RUSSIAN_ROULETTE 5
    #define PATH_TERMINATION_NON_FINITE 6

    #define PATH_FAILURE_RAY uint(1)
    #define PATH_FAILURE_SURFACE uint(2)
    #define PATH_FAILURE_BSDF uint(4)
    #define PATH_FAILURE_PDF uint(8)
    #define PATH_FAILURE_THROUGHPUT uint(16)
    #define PATH_FAILURE_CONTRIBUTION uint(32)
    #define PATH_FAILURE_RADIANCE uint(64)
    #define PATH_FAILURE_EXTREME uint(128)

    bool isFiniteFloat(float value) {
        return !isnan(value) && !isinf(value);
    }

    bool isFiniteVec2(vec2 value) {
        return all(not(isnan(value))) && all(not(isinf(value)));
    }

    bool isFiniteVec3(vec3 value) {
        return all(not(isnan(value))) && all(not(isinf(value)));
    }

    float maxComponent(vec3 value) {
        return max(value.r, max(value.g, value.b));
    }

    PathDiagnostic createPathDiagnostic() {
        return PathDiagnostic(0, PATH_TERMINATION_NONE, -1, uint(0), uint(0), 0.0, 1.0, 0.0);
    }

    void recordPathFailure(inout PathDiagnostic diagnostic, int bounce, uint flags) {
        if(diagnostic.firstFailureBounce < 0) {
            diagnostic.firstFailureBounce = bounce;
        }
        diagnostic.failureFlags |= flags;
    }

    void inspectPathValue(
        inout PathDiagnostic diagnostic,
        int bounce,
        vec3 value,
        uint nonFiniteFlag
    ) {
        if(!isFiniteVec3(value)) {
            recordPathFailure(diagnostic, bounce, nonFiniteFlag);
            diagnostic.terminationReason = PATH_TERMINATION_NON_FINITE;
            return;
        }
        if(maxComponent(abs(value)) > diagnosticExtremeThreshold) {
            recordPathFailure(diagnostic, bounce, PATH_FAILURE_EXTREME);
        }
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

    vec3 pathTrace(out PathDiagnostic diagnostic) {
        Ray ray = createCameraRay();
        vec3 radiance = vec3(0.0);
        vec3 throughput = vec3(1.0);
        diagnostic = createPathDiagnostic();

        if(!isFiniteVec3(ray.origin) || !isFiniteVec3(ray.direction)) {
            recordPathFailure(diagnostic, 0, PATH_FAILURE_RAY);
            diagnostic.terminationReason = PATH_TERMINATION_NON_FINITE;
            return radiance;
        }

        // maxBounce is the number of scattering events. The extra terminal
        // intersection records environment or emissive radiance after the last event.
        for(int depth = 0; depth <= MAX_BOUNCES; depth++) {
            if(depth > maxBounce) {
                break;
            }
            setRandomBounce(uint(depth));
            diagnostic.pathLength = depth + 1;

            vec3 surfaceFilter = vec3(1.0);
            RayHit hit = traceScene(ray, surfaceFilter);
            throughput *= surfaceFilter;
            inspectPathValue(diagnostic, depth, throughput, PATH_FAILURE_THROUGHPUT);
            if(diagnostic.terminationReason == PATH_TERMINATION_NON_FINITE) {
                break;
            }

            if(!hit.isHit) {
                LightSample environmentLight = EvaluateEnvironmentLight(ray);
                vec3 contribution = throughput * environmentLight.radiance;
                diagnostic.maxContribution = max(diagnostic.maxContribution, maxComponent(abs(contribution)));
                inspectPathValue(diagnostic, depth, contribution, PATH_FAILURE_CONTRIBUTION);
                if(diagnostic.terminationReason == PATH_TERMINATION_NON_FINITE) {
                    break;
                }
                radiance += contribution;
                inspectPathValue(diagnostic, depth, radiance, PATH_FAILURE_RADIANCE);
                diagnostic.terminationReason = diagnostic.terminationReason == PATH_TERMINATION_NONE
                    ? PATH_TERMINATION_ENVIRONMENT
                    : diagnostic.terminationReason;
                break;
            }

            if(
                !isFiniteFloat(hit.distance) ||
                !isFiniteVec3(hit.position) ||
                !isFiniteVec3(hit.normal) ||
                !isFiniteVec3(hit.geometricNormal) ||
                !isFiniteVec2(hit.uv)
            ) {
                recordPathFailure(diagnostic, depth, PATH_FAILURE_SURFACE);
                diagnostic.terminationReason = PATH_TERMINATION_NON_FINITE;
                break;
            }

            if(debugMode != 0) {
                return renderDebugHit(
                    hit,
                    hit.material.baseColor,
                    hit.material.roughness,
                    hit.material.metallic,
                    hit.material.emissive
                );
            }

            vec3 emissionContribution = throughput * EvaluateSurfaceEmission(hit);
            diagnostic.maxContribution = max(
                diagnostic.maxContribution,
                maxComponent(abs(emissionContribution))
            );
            inspectPathValue(diagnostic, depth, emissionContribution, PATH_FAILURE_CONTRIBUTION);
            if(diagnostic.terminationReason == PATH_TERMINATION_NON_FINITE) {
                break;
            }
            radiance += emissionContribution;
            inspectPathValue(diagnostic, depth, radiance, PATH_FAILURE_RADIANCE);
            if(diagnostic.terminationReason == PATH_TERMINATION_NON_FINITE) {
                break;
            }
            if(depth >= maxBounce) {
                diagnostic.terminationReason = PATH_TERMINATION_MAX_DEPTH;
                break;
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

            BSDFSample bsdfSample = SampleBSDF(
                viewDirection,
                surfaceNormal,
                tangent,
                bitangent,
                hit.material
            );
            diagnostic.lastBsdfEvent = bsdfSample.flags;
            diagnostic.lastSamplePdf = bsdfSample.pdf;
            if(
                !isFiniteVec3(bsdfSample.direction) ||
                !isFiniteVec3(bsdfSample.weight)
            ) {
                recordPathFailure(diagnostic, depth, PATH_FAILURE_BSDF);
                diagnostic.terminationReason = PATH_TERMINATION_NON_FINITE;
                break;
            }
            if(!isFiniteFloat(bsdfSample.pdf)) {
                recordPathFailure(diagnostic, depth, PATH_FAILURE_PDF);
                diagnostic.terminationReason = PATH_TERMINATION_NON_FINITE;
                break;
            }
            if(!bsdfSample.valid || dot(bsdfSample.direction, surfaceGeometricNormal) <= 0.0) {
                diagnostic.terminationReason = PATH_TERMINATION_INVALID_BSDF;
                break;
            }
            throughput *= bsdfSample.weight;
            inspectPathValue(diagnostic, depth, throughput, PATH_FAILURE_THROUGHPUT);
            if(diagnostic.terminationReason == PATH_TERMINATION_NON_FINITE) {
                break;
            }

            float maxThroughput = maxComponent(throughput);
            diagnostic.maxThroughput = max(diagnostic.maxThroughput, maxThroughput);
            if(maxThroughput <= 0.0) {
                diagnostic.terminationReason = PATH_TERMINATION_ZERO_THROUGHPUT;
                break;
            }

            if(depth >= RUSSIAN_ROULETTE_START_DEPTH) {
                beginRandomDomain(RNG_DOMAIN_RUSSIAN_ROULETTE);
                float survivalProb = min(maxThroughput, 0.95);
                if(rand() >= survivalProb) {
                    diagnostic.terminationReason = PATH_TERMINATION_RUSSIAN_ROULETTE;
                    break;
                }
                throughput /= survivalProb;
                diagnostic.maxThroughput = max(diagnostic.maxThroughput, maxComponent(throughput));
                inspectPathValue(diagnostic, depth, throughput, PATH_FAILURE_THROUGHPUT);
                if(diagnostic.terminationReason == PATH_TERMINATION_NON_FINITE) {
                    break;
                }
            }

            ray.origin = hit.position + surfaceGeometricNormal * RAY_OFFSET_EPSILON;
            ray.direction = bsdfSample.direction;
        }

        return radiance;
    }

    vec4 encodeDiagnosticSummary(PathDiagnostic diagnostic) {
        return vec4(
            float(diagnostic.pathLength),
            float(diagnostic.terminationReason),
            float(diagnostic.lastBsdfEvent),
            float(diagnostic.firstFailureBounce)
        );
    }

    vec4 encodeDiagnosticMetrics(PathDiagnostic diagnostic) {
        return vec4(
            diagnostic.lastSamplePdf,
            diagnostic.maxThroughput,
            diagnostic.maxContribution,
            float(diagnostic.failureFlags)
        );
    }
    
    void main(void) {
    
        seed = updateSeed(samples);
        
        PathDiagnostic diagnostic;
        vec3 sampleRadiance = pathTrace(diagnostic);
        if(diagnosticOutput == 1) {
            pc_fragColor = encodeDiagnosticSummary(diagnostic);
            return;
        }
        if(diagnosticOutput == 2) {
            pc_fragColor = encodeDiagnosticMetrics(diagnostic);
            return;
        }
        vec3 accumulatedRadiance = texelFetch(outTexture, ivec2(gl_FragCoord.xy), 0).rgb;
        float accumulationWeight = 1.0 / (1.0 + samples);
        pc_fragColor = vec4(mix(accumulatedRadiance, sampleRadiance, accumulationWeight), 1.0);
    }
`

export { Common };
