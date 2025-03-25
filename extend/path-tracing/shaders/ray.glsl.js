export const Ray =  /* glsl */`
    Ray createCameraRay() {
        vec2 pixelOffset = vec2((rand() - 0.5), (rand() - 0.5));
        vec2 uv = ((gl_FragCoord.xy + pixelOffset) / resolution) * 2.0 - 1.0;
        vec3 direction = (matrixWorld * projectionMatrixInverse * vec4(uv, 1.0, 1.0)).xyz;
        direction = normalize(direction);
        return Ray(cameraPosition, direction);
    }
    
    RayHit createHit() {
        RayHit hit;
        hit.isHit = false;
        hit.isInside = false;
        hit.distance = INFINITY;
        hit.position = vec3(INFINITY);
        hit.normal = vec3(0.0);
        hit.rayDirec = vec3(0.0);
        hit.material = Gold();
        return hit;
    }

`