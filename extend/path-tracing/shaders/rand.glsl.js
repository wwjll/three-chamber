export const Rand =  /* glsl */`
    uint updateSeed(float width, float height, float samples) {
        return uint(uint((pos.x * 0.5 + 0.5) * (width)) * uint(1973) +
        uint((pos.y * 0.5 + 0.5) * (height)) * uint(9277) +
        uint(samples) * uint(26699)) | uint(1);
    }
    
    void wang_hash(inout uint seed) {
        seed = uint(seed ^ uint(61)) ^ uint(seed >> uint(16));
        seed *= uint(9);
        seed = seed ^ (seed >> 4);
        seed *= uint(0x27d4eb2d);
        seed = seed ^ (seed >> 15);
    }
    
    float rand() {
        wang_hash(seed);
        return float(seed) / 4294967296.0;
    }
  
`