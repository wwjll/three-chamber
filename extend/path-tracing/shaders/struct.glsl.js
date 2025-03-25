export const Struct =  /* glsl */`
    struct Triangle {
        vec3 p1, p2, p3;
        vec3 n1, n2, n3;
    };

    struct Material {
        vec3 emissive;
        vec3 baseColor;
        float subsurface;
        float metallic;
        float specular;
        float specularTint;
        float roughness;
        float anisotropic;
        float sheen;
        float sheenTint;
        float clearcoat;
        float clearcoatGloss;
        float IOR;
        float transmission;
    };
    
    struct Ray {
        vec3 origin;
        vec3 direction;
    };

    struct RayHit {
        bool isHit;
        bool isInside;
        float distance;
        vec3 position;
        vec3 normal;
        vec3 rayDirec;
        Material material;
    };

    struct BVHNode {
        vec3 aa;
        vec3 bb;
        int isLeaf;
        int left;
        int right;
        int index;
        int size;
    };
`