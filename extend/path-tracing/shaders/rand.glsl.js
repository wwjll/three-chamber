const Rand =  /* glsl */`
    #define RNG_DOMAIN_PIXEL uint(1)
    #define RNG_DOMAIN_HEMISPHERE uint(2)
    #define RNG_DOMAIN_COSINE_HEMISPHERE uint(3)
    #define RNG_DOMAIN_ENVIRONMENT uint(4)
    #define RNG_DOMAIN_GGX uint(5)
    #define RNG_DOMAIN_BRDF uint(6)
    #define RNG_DOMAIN_RUSSIAN_ROULETTE uint(7)

    uint updateSeed(float sampleCount) {
        uvec2 pixel = uvec2(ivec2(gl_FragCoord.xy));
        return (
            pixel.x * uint(1973) +
            pixel.y * uint(9277) +
            uint(sampleCount) * uint(26699) +
            uint(911)
        ) | uint(1);
    }

    void setRandomBounce(uint bounce) {
        rngBounce = bounce;
    }

    void beginRandomDomain(uint domain) {
        rngDomain = domain;
        rngDimensionCounter = uint(0);
    }
    
    void wang_hash(inout uint seed) {
        seed = uint(seed ^ uint(61)) ^ uint(seed >> uint(16));
        seed *= uint(9);
        seed = seed ^ (seed >> 4);
        seed *= uint(0x27d4eb2d);
        seed = seed ^ (seed >> 15);
    }
    
    float rand() {
        // Hash a stable per-pixel/per-sample seed with explicit bounce, domain,
        // and dimension indices so mirror-like BRDFs do not expose the structure
        // of one long correlated RNG stream as reflection-space rings.
        uint value = seed;
        value ^= (rngBounce + uint(1)) * uint(1597334677);
        value ^= (rngDomain + uint(1)) * uint(3812015801);
        value ^= (rngDimensionCounter + uint(1)) * uint(2798796415);
        wang_hash(value);
        rngDimensionCounter += uint(1);
        return float(value) / 4294967296.0;
    }
  
`

export { Rand };
