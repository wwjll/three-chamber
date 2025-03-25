export const Brdf =  /* glsl */`

    float SchlickFresnel(float u) {
        float m = clamp(1.0 - u, 0.0, 1.0);
        float m2 = m * m;
        return m2 * m2 * m; // pow(m,5)
    }
    
    float GTR1(float NdotH, float a) {
        if(a >= 1.0)
        return 1.0 / PI;
        float a2 = a * a;
        float t = 1.0 + (a2 - 1.0) * NdotH * NdotH;
        return (a2 - 1.0) / (PI * log(a2) * t);
    }
    
    float GTR2(float NdotH, float a) {
        float a2 = a * a;
        float t = 1.0 + (a2 - 1.0) * NdotH * NdotH;
        return a2 / (PI * t * t);
    }
    
    float GTR2_aniso(float NdotH, float HdotX, float HdotY, float ax, float ay) {
        return 1.0 / (PI * ax * ay * sqr(sqr(HdotX / ax) + sqr(HdotY / ay) + NdotH * NdotH));
    }

    float smithG_GGX(float NdotV, float alphaG) {
        float a = alphaG * alphaG;
        float b = NdotV * NdotV;
        return 1.0 / (NdotV + sqrt(a + b - a * b));
    }
    
    float smithG_GGX_aniso(float NdotV, float VdotX, float VdotY, float ax, float ay) {
        return 1.0 / (NdotV + sqrt(sqr(VdotX * ax) + sqr(VdotY * ay) + sqr(NdotV)));
    }

    vec3 BRDF_Evaluate(vec3 V, vec3 N, vec3 L, vec3 X, vec3 Y, in Material material) {

        float NdotL = dot(N, L);
        float NdotV = dot(N, V);
        if(NdotL < 0.0 || NdotV < 0.0)
        return vec3(0.0);
    
        vec3 H = normalize(L + V);
        float NdotH = dot(N, H);
        float LdotH = dot(L, H);
    
        // albedo
        vec3 Cdlin = material.baseColor;
        float Cdlum = 0.3 * Cdlin.r + 0.6 * Cdlin.g + 0.1 * Cdlin.b;
        vec3 Ctint = (Cdlum > 0.0) ? (Cdlin / Cdlum) : (vec3(1.0));
        vec3 Cspec = material.specular * mix(vec3(1.0), Ctint, material.specularTint);
        vec3 Cspec0 = mix(0.08 * Cspec, Cdlin, material.metallic); 
        vec3 Csheen = mix(vec3(1.0), Ctint, material.sheenTint);   
    
        // diffuse
        float Fd90 = 0.5 + 2.0 * LdotH * LdotH * material.roughness;
        float FL = SchlickFresnel(NdotL);
        float FV = SchlickFresnel(NdotV);
        float Fd = mix(1.0, Fd90, FL) * mix(1.0, Fd90, FV);
    
        // subsurface scattering
        float Fss90 = LdotH * LdotH * material.roughness;
        float Fss = mix(1.0, Fss90, FL) * mix(1.0, Fss90, FV);
        float ss = 1.25 * (Fss * (1.0 / (NdotL + NdotV) - 0.5) + 0.5);
    
        // specular -- uniso
        float alpha = material.roughness * material.roughness;
        float Ds = GTR2(NdotH, alpha);
        float FH = SchlickFresnel(LdotH);
        vec3 Fs = mix(Cspec0, vec3(1), FH);
        float Gs = smithG_GGX(NdotL, material.roughness);
        Gs *= smithG_GGX(NdotV, material.roughness);
    
        // specular -- aniso
        // float aspect = sqrt(1.0 - material.anisotropic * 0.9);
        // float ax = max(0.001, sqr(material.roughness) / aspect);
        // float ay = max(0.001, sqr(material.roughness) * aspect);
        // float Ds = GTR2_aniso(NdotH, dot(H, X), dot(H, Y), ax, ay);
        // float FH = SchlickFresnel(LdotH);
        // vec3 Fs = mix(Cspec0, vec3(1), FH);
        // float Gs;
        // Gs = smithG_GGX_aniso(NdotL, dot(L, X), dot(L, Y), ax, ay);
        // Gs *= smithG_GGX_aniso(NdotV, dot(V, X), dot(V, Y), ax, ay);
    
        float Dr = GTR1(NdotH, mix(0.1, 0.001, material.clearcoatGloss));
        float Fr = mix(0.04, 1.0, FH);
        float Gr = smithG_GGX(NdotL, 0.25) * smithG_GGX(NdotV, 0.25);
    
        // sheen
        vec3 Fsheen = FH * material.sheen * Csheen;
    
        vec3 diffuse = (1.0 / PI) * mix(Fd, ss, material.subsurface) * Cdlin + Fsheen;
        vec3 clearcoat = vec3(0.25 * Gr * Fr * Dr * material.clearcoat);
        vec3 specular = Gs * Fs * Ds;

        return diffuse * (1.0 - material.metallic) + specular + clearcoat;
    
    }
`