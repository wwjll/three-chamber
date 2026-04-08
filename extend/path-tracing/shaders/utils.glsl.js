export const Utils =  /* glsl */`
    BVHNode getBVHNode(float i) {
        float width = bvhNodeDataTextureSize.x;
        // 3 slots
        ivec2 uv0 = ivec2(mod(texelsPerBVHNode * i + 0.0, width), texelsPerBVHNode * i / width);
        ivec2 uv1 = ivec2(mod(texelsPerBVHNode * i + 1.0, width), texelsPerBVHNode * i / width);
        ivec2 uv2 = ivec2(mod(texelsPerBVHNode * i + 2.0, width), texelsPerBVHNode * i / width);

        vec4 texel0 = texelFetch(bvhNodeDataTexture, uv0, 0);
        vec4 texel1 = texelFetch(bvhNodeDataTexture, uv1, 0);
        vec4 texel2 = texelFetch(bvhNodeDataTexture, uv2, 0);

        vec3 aa = texel0.xyz;
        vec3 bb = vec3(texel0.w, texel1.xy);
        // int id = int(texel1.z);
        int isLeaf = int(texel1.w);

        int left = int(texel2.x);
        int right = int(texel2.y);
        int index = int(texel2.z);
        int size = int(texel2.w);

        return BVHNode(aa, bb, isLeaf, left, right, index, size);
    }

    Triangle getTriangle(float i) {
        float width = triangleDataTextureSize.x;
      
        ivec2 uv0 = ivec2(mod(texelsPerTriangle * i + 0.0, width), texelsPerTriangle * i / width);
        ivec2 uv1 = ivec2(mod(texelsPerTriangle * i + 1.0, width), texelsPerTriangle * i / width);
        ivec2 uv2 = ivec2(mod(texelsPerTriangle * i + 2.0, width), texelsPerTriangle * i / width);
        ivec2 uv3 = ivec2(mod(texelsPerTriangle * i + 3.0, width), texelsPerTriangle * i / width);
        ivec2 uv4 = ivec2(mod(texelsPerTriangle * i + 4.0, width), texelsPerTriangle * i / width);
        ivec2 uv5 = ivec2(mod(texelsPerTriangle * i + 5.0, width), texelsPerTriangle * i / width);
      
        vec4 texel0 = texelFetch(triangleDataTexture, uv0, 0);
        vec4 texel1 = texelFetch(triangleDataTexture, uv1, 0);
        vec4 texel2 = texelFetch(triangleDataTexture, uv2, 0);
        vec4 texel3 = texelFetch(triangleDataTexture, uv3, 0);
        vec4 texel4 = texelFetch(triangleDataTexture, uv4, 0);
        vec4 texel5 = texelFetch(triangleDataTexture, uv5, 0);
      
        vec3 p1 = texel0.xyz;
        vec3 p2 = vec3(texel0.w, texel1.xy);
        vec3 p3 = vec3(texel1.zw, texel2.x);
        vec3 n1 = texel2.yzw;
        vec3 n2 = texel3.xyz;
        vec3 n3 = vec3(texel3.w, texel4.xy);
        vec2 t1 = texel4.zw;
        vec2 t2 = texel5.xy;
        vec2 t3 = texel5.zw;
        float materialIndex = texelFetch(triangleDataTexture, ivec2(mod(texelsPerTriangle * i + 6.0, width), texelsPerTriangle * i / width), 0).x;
        return Triangle(p1, p2, p3, n1, n2, n3, t1, t2, t3, materialIndex);
    }

    Material getSceneMaterial(float i) {
        float width = materialDataTextureSize.x;
        ivec2 uv0 = ivec2(mod(texelsPerMaterial * i + 0.0, width), texelsPerMaterial * i / width);
        ivec2 uv1 = ivec2(mod(texelsPerMaterial * i + 1.0, width), texelsPerMaterial * i / width);
        ivec2 uv2 = ivec2(mod(texelsPerMaterial * i + 2.0, width), texelsPerMaterial * i / width);
        ivec2 uv3 = ivec2(mod(texelsPerMaterial * i + 3.0, width), texelsPerMaterial * i / width);
        ivec2 uv4 = ivec2(mod(texelsPerMaterial * i + 4.0, width), texelsPerMaterial * i / width);

        vec4 texel0 = texelFetch(materialDataTexture, uv0, 0);
        vec4 texel1 = texelFetch(materialDataTexture, uv1, 0);
        vec4 texel2 = texelFetch(materialDataTexture, uv2, 0);
        vec4 texel3 = texelFetch(materialDataTexture, uv3, 0);
        vec4 texel4 = texelFetch(materialDataTexture, uv4, 0);

        Material material = DebugAlbedo();
        material.baseColor = texel0.rgb;
        material.roughness = texel0.w;
        material.metallic = texel1.x;
        material.emissive = texel1.yzw;
        material.albedoTextureIndex = texel2.x;
        material.normalTextureIndex = texel2.y;
        material.metallicRoughnessTextureIndex = texel2.z;
        material.emissiveTextureIndex = texel2.w;
        material.alpha = texel3.x;
        material.normalScale = texel3.yz;
        material.alphaMode = texel3.w;
        material.doubleSided = texel4.x;
        return material;
    }
`
