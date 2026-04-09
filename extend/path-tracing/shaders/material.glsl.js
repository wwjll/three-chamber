const Material =  /* glsl */`

    Material Gold() {
        Material material;
        material.emissive = vec3(0.0);
        material.baseColor = vec3(1.0, 0.766, 0.336);
        material.subsurface = 0.0;
        material.metallic = 1.0;
        material.specular = 0.1;
        material.specularTint = 1.0;
        material.roughness = 0.35;
        material.anisotropic = 0.0;
        material.sheen = 0.0;
        material.sheenTint = 0.0;
        material.clearcoat = 0.0;
        material.clearcoatGloss = 0.0;
        material.IOR = 0.0;
        material.transmission = 0.0;
        material.albedoTextureIndex = -1.0;
        material.normalTextureIndex = -1.0;
        material.metallicRoughnessTextureIndex = -1.0;
        material.aoTextureIndex = -1.0;
        material.emissiveTextureIndex = -1.0;
        material.normalScale = vec2(1.0);
        material.aoIntensity = 1.0;
        material.alpha = 1.0;
        material.alphaMode = 0.0;
        material.doubleSided = 0.0;
        return material;
    }

    Material Mirror() {
        Material material;
        material.emissive = vec3(0.0);
        material.baseColor = vec3(0.0);
        material.subsurface = 0.0;
        material.metallic = 0.0;
        material.specular = 1.0;
        material.specularTint = 1.0;
        material.roughness = 0.1;
        material.anisotropic = 0.0;
        material.sheen = 0.0;
        material.sheenTint = 0.0;
        material.clearcoat = 0.0;
        material.clearcoatGloss = 0.0;
        material.IOR = 0.0;
        material.transmission = 0.0;
        material.albedoTextureIndex = -1.0;
        material.normalTextureIndex = -1.0;
        material.metallicRoughnessTextureIndex = -1.0;
        material.aoTextureIndex = -1.0;
        material.emissiveTextureIndex = -1.0;
        material.normalScale = vec2(1.0);
        material.aoIntensity = 1.0;
        material.alpha = 1.0;
        material.alphaMode = 0.0;
        material.doubleSided = 0.0;
        return material;
    }

    Material DebugAlbedo() {
        Material material;
        material.emissive = vec3(0.0);
        material.baseColor = vec3(1.0);
        material.subsurface = 0.0;
        material.metallic = 0.0;
        material.specular = 0.5;
        material.specularTint = 0.0;
        material.roughness = 0.7;
        material.anisotropic = 0.0;
        material.sheen = 0.0;
        material.sheenTint = 0.0;
        material.clearcoat = 0.0;
        material.clearcoatGloss = 0.0;
        material.IOR = 1.5;
        material.transmission = 0.0;
        material.albedoTextureIndex = -1.0;
        material.normalTextureIndex = -1.0;
        material.metallicRoughnessTextureIndex = -1.0;
        material.aoTextureIndex = -1.0;
        material.emissiveTextureIndex = -1.0;
        material.normalScale = vec2(1.0);
        material.aoIntensity = 1.0;
        material.alpha = 1.0;
        material.alphaMode = 0.0;
        material.doubleSided = 0.0;
        return material;
    }
`

export { Material };
