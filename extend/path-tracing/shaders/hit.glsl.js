import { bvhLeafSize } from '../Constants.js'

const Hit =  /* glsl */`
    #define STACK_SIZE 128
    #define MAX_BVH_STEPS 512
    #define MAX_TRIANGLES_PER_LEAF ${bvhLeafSize}

    bool hitTriangle_MT97(Ray ray, vec3 vert0, vec3 vert1, vec3 vert2, inout float t, inout float u, inout float v) {
        vec3 edge1 = vert1 - vert0;
        vec3 edge2 = vert2 - vert0;
        vec3 pvec = cross(ray.direction, edge2);
        float det = dot(edge1, pvec);
        if(abs(det) < TRIANGLE_DETERMINANT_EPSILON) {
            return false;
        }

        float invDet = 1.0 / det;
        vec3 tvec = ray.origin - vert0;
        u = dot(tvec, pvec) * invDet;
        if(u < -TRIANGLE_BARYCENTRIC_EPSILON || u > 1.0 + TRIANGLE_BARYCENTRIC_EPSILON) {
            return false;
        }

        vec3 qvec = cross(tvec, edge1);
        v = dot(ray.direction, qvec) * invDet;
        if(v < -TRIANGLE_BARYCENTRIC_EPSILON || u + v > 1.0 + TRIANGLE_BARYCENTRIC_EPSILON) {
            return false;
        }

        t = dot(edge2, qvec) * invDet;
        return true;
    }

    void hitTriangle(Triangle tri, in Ray ray, inout RayHit hit) {
        float t, u, v;
        if(hitTriangle_MT97(ray, tri.p1, tri.p2, tri.p3, t, u, v)) {
        if(t > TRIANGLE_DISTANCE_EPSILON && t < hit.distance) {
            float w = 1.0 - u - v;
            vec3 edge1 = tri.p2 - tri.p1;
            vec3 edge2 = tri.p3 - tri.p1;
            vec3 geometricNormal = normalize(cross(edge1, edge2));
            vec2 deltaUV1 = tri.uv2 - tri.uv1;
            vec2 deltaUV2 = tri.uv3 - tri.uv1;
            float uvDeterminant = deltaUV1.x * deltaUV2.y - deltaUV1.y * deltaUV2.x;

            hit.isHit = true;
            hit.distance = t;
            hit.position = ray.origin + t * ray.direction;
            hit.normal = normalize(tri.n1 * w + tri.n2 * u + tri.n3 * v);
            hit.geometricNormal = geometricNormal;
            hit.uv = tri.uv1 * w + tri.uv2 * u + tri.uv3 * v;
            hit.materialIndex = tri.materialIndex;
            hit.rayDirec = ray.direction;

            if(abs(uvDeterminant) > EPSILON) {
                float inverseDeterminant = 1.0 / uvDeterminant;
                vec3 tangent = (edge1 * deltaUV2.y - edge2 * deltaUV1.y) * inverseDeterminant;
                tangent = normalize(tangent - hit.normal * dot(hit.normal, tangent));
                hit.tangent = tangent;
                hit.bitangent = normalize(cross(hit.normal, tangent)) * sign(uvDeterminant);
            } else {
                getTangent(hit.normal, hit.tangent, hit.bitangent);
            }

            if(dot(hit.geometricNormal, hit.rayDirec) > 0.0) {
                hit.isInside = true;
                hit.geometricNormal = -hit.geometricNormal;
                hit.normal = -hit.normal;
                hit.tangent = -hit.tangent;
                hit.bitangent = -hit.bitangent;
            }

            if(dot(hit.normal, hit.geometricNormal) < 0.0) {
                hit.normal = -hit.normal;
            }
        }
        }
    }
    
    void hitTriangles(int begin, int end, inout Ray ray, inout RayHit hit) {
        // leaf size is 8, keep loop bound compile-time constant for driver compatibility.
        for(int offset = 0; offset < MAX_TRIANGLES_PER_LEAF; ++offset) {
        int i = begin + offset;
        if(i > end) break;
        Triangle tri = getTriangle(float(i));
        hitTriangle(tri, ray, hit);
        }
    }
  
    float hitAABB(Ray ray, vec3 aa, vec3 bb) {
        vec3 origin = ray.origin;
        vec3 direction = ray.direction;
        float ox = origin.x;
        float oy = origin.y;
        float oz = origin.z;
        float dx = direction.x;
        float dy = direction.y;
        float dz = direction.z;
        float tx_min = -INFINITY;
        float ty_min = -INFINITY;
        float tz_min = -INFINITY;
        float tx_max = INFINITY;
        float ty_max = INFINITY;
        float tz_max = INFINITY;

        if(abs(dx) < EPSILON) {
            if(ox > bb.x || ox < aa.x) {
                return -1.0;
            }
        } else {
            float invDx = 1.0 / dx;
            float tx0 = (aa.x - ox) * invDx;
            float tx1 = (bb.x - ox) * invDx;
            tx_min = min(tx0, tx1);
            tx_max = max(tx0, tx1);
        }

        if(abs(dy) < EPSILON) {
            if(oy > bb.y || oy < aa.y) {
                return -1.0;
            }
        } else {
            float invDy = 1.0 / dy;
            float ty0 = (aa.y - oy) * invDy;
            float ty1 = (bb.y - oy) * invDy;
            ty_min = min(ty0, ty1);
            ty_max = max(ty0, ty1);
        }

        if(abs(dz) < EPSILON) {
            if(oz > bb.z || oz < aa.z) {
                return -1.0;
            }
        } else {
            float invDz = 1.0 / dz;
            float tz0 = (aa.z - oz) * invDz;
            float tz1 = (bb.z - oz) * invDz;
            tz_min = min(tz0, tz1);
            tz_max = max(tz0, tz1);
        }

        float t0 = max(tz_min, max(tx_min, ty_min));
        float t1 = min(tz_max, min(tx_max, ty_max));

        return (t1 >= t0) ? ((t0 > 0.0) ? (t0) : (t1)) : (-1.0);
    }

    void hitBVH(Ray ray, inout RayHit hit) {
        int stack[STACK_SIZE];
        int sp = 0;
        stack[sp++] = 0;
        // Use bounded iterations to avoid problematic unbounded while loops on some ANGLE backends.
        for(int iter = 0; iter < MAX_BVH_STEPS; ++iter) {
            if(sp <= 0) break;

            int index = stack[--sp];
            BVHNode node = getBVHNode(float(index));
            float d = hitAABB(ray, node.aa, node.bb);
        
            if(d >= 0.0 && d <= hit.distance) {
                if(node.isLeaf == 1) {
                    int start = node.index;
                    int end = node.index + node.size - 1;
                    hitTriangles(start, end, ray, hit);
                    continue;
                }
        
                int left = node.left;
                int right = node.right;
                float dLeft = INFINITY;
                float dRight = INFINITY;
                float maxDistance = hit.distance;
                if(left > 0) {
                    BVHNode leftNode = getBVHNode(float(left));
                    dLeft = hitAABB(ray, leftNode.aa, leftNode.bb);
                }
        
                if(right > 0) {
                    BVHNode rightNode = getBVHNode(float(right));
                    dRight = hitAABB(ray, rightNode.aa, rightNode.bb);
                }

                bool leftHit = dLeft >= 0.0 && dLeft <= maxDistance;
                bool rightHit = dRight >= 0.0 && dRight <= maxDistance;

                if(leftHit) {
                    if(sp < STACK_SIZE) stack[sp++] = left;
                }
                if(rightHit) {
                    if(sp < STACK_SIZE) stack[sp++] = right;
                }
            }
        }
    }

    RayHit hitScene(Ray ray) {
        RayHit bvhHit = createHit();
        hitBVH(ray, bvhHit);
        return bvhHit;
    }
`

export { Hit };
