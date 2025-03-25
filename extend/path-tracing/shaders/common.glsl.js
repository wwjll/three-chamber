export const Common =  /* glsl */`

    vec3 pathTrace() {
        Ray ray = createCameraRay();
    
        vec3 Le = vec3(0.0);
        vec3 Li = vec3(0.0);
        vec3 history = vec3(1.0);
    
        for(int bounce = 0; bounce < maxBounce; bounce++) {
            // Russia Roulette
            float survivalProb = min(1.0, max(history.r, max(history.g, history.b)));
            if(rand() > survivalProb) break;
            history /= survivalProb;

            RayHit hit = hitScene(ray);
            if(hit.isHit) {
        
                if(bounce == 0) {
                    Le = hit.material.emissive;
                }
        
                vec3 V = -hit.rayDirec;
                vec3 N = hit.normal;
                // random out direction
                vec3 L = toNormalHemisphere(SampleHemisphere(), hit.normal);
        
                // pdf of hemi sphere
                float pdf = ONE_OVER_TWO_PI;
        
                // float cosine_o = max(0.0, dot(V, N));
                float cosine_i = max(0.0, dot(L, N));
        
                vec3 tangent, bitangent;
                getTangent(N, tangent, bitangent);
        
                vec3 f_r = BRDF_Evaluate(V, N, L, tangent, bitangent, hit.material);
        
                // ray reflection
                ray.origin = hit.position + hit.normal * EPSILON;
                ray.direction = L;
                RayHit bounceHit = hitScene(ray);
        
                // miss
                if(!bounceHit.isHit) {
                    vec3 skyColor = sampleHdr(ray);
                    Li += history * skyColor * f_r * cosine_i / pdf;
                    break;
                }
        
                // accumulate energy
                vec3 emi = bounceHit.material.emissive;
                Li += history * emi * f_r * cosine_i / pdf;
        
                // next recursion
                hit = bounceHit;
                history *= f_r * cosine_i / pdf;
        
            } else {
                return sampleHdr(ray);
            }
        }
        return Le + Li;
    }
    
    void main(void) {
    
        seed = updateSeed(resolution.x, resolution.y, samples);
        
        vec3 pixelColor = pathTrace();
        vec3 previousColor = texelFetch(copyTexture, ivec2(gl_FragCoord.xy), 0).rgb;
        float alpha = 1.0 / (1.0 + samples);
        pc_fragColor = vec4(mix(previousColor, pixelColor, alpha), 1.0);
    }
`