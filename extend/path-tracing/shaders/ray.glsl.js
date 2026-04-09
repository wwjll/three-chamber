const Ray =  /* glsl */`
    Ray createCameraRay() {
        vec2 pixelOffset = vec2((rand() - 0.5), (rand() - 0.5));
        vec2 uv = ((gl_FragCoord.xy + pixelOffset) / resolution) * 2.0 - 1.0;
        vec4 clipPosition = vec4(uv, 1.0, 1.0);
        vec4 viewPosition = projectionMatrixInverse * clipPosition;
        viewPosition /= max(viewPosition.w, EPSILON);
        vec3 worldPosition = (matrixWorld * viewPosition).xyz;
        vec3 direction = normalize(worldPosition - cameraPosition);
        return Ray(cameraPosition, direction);
    }
    
    RayHit createHit() {
        RayHit hit;
        hit.isHit = false;
        hit.isInside = false;
        hit.distance = INFINITY;
        hit.position = vec3(INFINITY);
        hit.normal = vec3(0.0);
        hit.geometricNormal = vec3(0.0);
        hit.tangent = vec3(1.0, 0.0, 0.0);
        hit.bitangent = vec3(0.0, 1.0, 0.0);
        hit.uv = vec2(0.0);
        hit.materialIndex = 0.0;
        hit.rayDirec = vec3(0.0);
        if (materialPreset == 1) {
            hit.material = Gold();
        } else if (materialPreset == 2) {
            hit.material = Mirror();
        } else {
            hit.material = DebugAlbedo();
        }
        return hit;
    }

`

export { Ray };
