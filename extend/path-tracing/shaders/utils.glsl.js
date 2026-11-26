import { BVH_LEAF_COUNT_MASK, BVH_LEAF_FLAG } from '../../partition/bvh/BVHLayout.js'

const Utils =  /* glsl */`
    // Reads one node of the extend/partition layout (see BVHLayout.js) from
    // two RGBA32UI texels. The texture width is even, so both texels of a
    // node are in the same row. Word 3 is the right child relative to the
    // node for internal nodes, and the first triangle slot for leaves.
    BVHNode getBVHNode(int i) {
        int width = int(bvhNodeDataTextureSize.x);
        int texel = int(texelsPerBVHNode) * i;
        ivec2 uv = ivec2(texel % width, texel / width);

        uvec4 texel0 = texelFetch(bvhNodeDataTexture, uv, 0);
        uvec4 texel1 = texelFetch(bvhNodeDataTexture, uv + ivec2(1, 0), 0);

        uint flags = texel1.w;
        bool isLeaf = (flags & 0x${BVH_LEAF_FLAG.toString(16)}u) != 0u;
        int offset = int(texel0.w);
        int size = int(flags & 0x${BVH_LEAF_COUNT_MASK.toString(16)}u);

        return BVHNode(uintBitsToFloat(texel0.xyz), uintBitsToFloat(texel1.xyz), isLeaf, i + offset, offset, size);
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
        ivec2 uv5 = ivec2(mod(texelsPerMaterial * i + 5.0, width), texelsPerMaterial * i / width);

        vec4 texel0 = texelFetch(materialDataTexture, uv0, 0);
        vec4 texel1 = texelFetch(materialDataTexture, uv1, 0);
        vec4 texel2 = texelFetch(materialDataTexture, uv2, 0);
        vec4 texel3 = texelFetch(materialDataTexture, uv3, 0);
        vec4 texel4 = texelFetch(materialDataTexture, uv4, 0);
        vec4 texel5 = texelFetch(materialDataTexture, uv5, 0);

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
        material.transmission = texel4.y;
        material.IOR = texel4.z;
        material.thickness = texel4.w;
        material.absorption = texel5.xyz;
        return material;
    }
`

export { Utils };
