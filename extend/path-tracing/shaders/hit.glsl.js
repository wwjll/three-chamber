export const Hit =  /* glsl */`
    bool hitTriangle_MT97(Ray ray, vec3 vert0, vec3 vert1, vec3 vert2, inout float t, inout float u, inout float v) {
        // find vectors for two edges sharing vert0
        vec3 edge1 = vert1 - vert0;
        vec3 edge2 = vert2 - vert0;
        // begin calculating determinant - also used to calculate U parameter
        vec3 pvec = cross(ray.direction, edge2);
        // if determinant is near zero, ray lies in plane of triangle
        float det = dot(edge1, pvec);
        // use backface culling
        // if (det < EPSILON)
        // 	return false;
        float inv_det = 1.0 / det;
        // calculate distance from vert0 to ray origin
        vec3 tvec = ray.origin - vert0;
        // calculate U parameter and test bounds
        u = dot(tvec, pvec) * inv_det;
        if(u < 0.0 || u > 1.0)
        return false;
        // prepare to test V parameter
        vec3 qvec = cross(tvec, edge1);
        // calculate V parameter and test bounds
        v = dot(ray.direction, qvec) * inv_det;
        if(v < 0.0 || u + v > 1.0)
        return false;
        // calculate t, ray intersects triangle
        t = dot(edge2, qvec) * inv_det;
        return true;
    }

    void hitTriangle(Triangle tri, in Ray ray, inout RayHit hit) {
        float t, u, v;
        if(hitTriangle_MT97(ray, tri.p1, tri.p2, tri.p3, t, u, v)) {
        if(t > 0.0 && t < hit.distance) {
            hit.isHit = true;
            hit.distance = t;
            hit.position = ray.origin + t * ray.direction;
            // caculate the normal for each indivial triangle
            // hit.normal = normalize(cross(tri.p2 - tri.p1, tri.p3 - tri.p2));
            // use the origin normal of vertex to get a somooth transition
            hit.normal = ((tri.n1 + tri.n2 + tri.n3) / 3.0);
            hit.rayDirec = ray.direction;
            if(dot(hit.normal, hit.rayDirec) > 0.0) {
            hit.isInside = true;
            }
        }
        }
    }
    
    void hitTriangles(int begin, int end, inout Ray ray, inout RayHit hit) {
        for(int i = begin; i <= end; ++i) {
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
        float tx_min, ty_min, tz_min;
        float tx_max, ty_max, tz_max;
        float x0 = aa.x;
        float y0 = aa.y;
        float z0 = aa.z;
        float x1 = bb.x;
        float y1 = bb.y;
        float z1 = bb.z;
        // when ray in left or right plane and ray origin not inside box
        if(abs(dx) < EPSILON) {
            if(ox > x1 || ox < x0)
                return -1.0;
            } else {
            if(dx >= 0.0) {
                tx_min = (x0 - ox) / dx;
                tx_max = (x1 - ox) / dx;
            } else {
                tx_min = (x1 - ox) / dx;
                tx_max = (x0 - ox) / dx;
            }
        }
    
        if(abs(dy) < EPSILON) {
            if(oy > y1 || oy < y0)
                return -1.0;
            } else {
            if(dy >= 0.0) {
                ty_min = (y0 - oy) / dy;
                ty_max = (y1 - oy) / dy;
            } else {
                ty_min = (y1 - oy) / dy;
                ty_max = (y0 - oy) / dy;
            }
        
            }
        
            if(abs(dz) < EPSILON) {
            if(oz > z1 || oz < z0)
                return -1.0;
            } else {
            if(dz >= 0.0) {
                tz_min = (z0 - oz) / dz;
                tz_max = (z1 - oz) / dz;
            } else {
                tz_min = (z1 - oz) / dz;
                tz_max = (z0 - oz) / dz;
            }
    
        }
    
        float t0 = max(tz_min, max(tx_min, ty_min));
        float t1 = min(tz_max, min(tx_max, ty_max));
    
        return (t1 >= t0) ? ((t0 > 0.0) ? (t0) : (t1)) : (-1.0);
    }

    void hitBVH(Ray ray, inout RayHit hit) {
        int stack[64];
        int sp = 0;
        stack[sp++] = 0;
        while(sp > 0 && sp < 64) {
            
            int index = stack[--sp];
            BVHNode node = getBVHNode(float(index));
            float d = hitAABB(ray, node.aa, node.bb);
        
            if(d > 0.0) {
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
                if(left > 0) {
                    BVHNode leftNode = getBVHNode(float(left));
                    dLeft = hitAABB(ray, leftNode.aa, leftNode.bb);
                }
        
                if(right > 0) {
                    BVHNode rightNode = getBVHNode(float(right));
                    dRight = hitAABB(ray, rightNode.aa, rightNode.bb);
                }
        
                if(dLeft < INFINITY && dRight < INFINITY) {
                    if(dLeft > 0.0 && dRight > 0.0) {
                        if(dLeft < dRight) {
                            stack[sp++] = right;
                            stack[sp++] = left;
                        } else {
                            stack[sp++] = left;
                            stack[sp++] = right;
                        }
                    } else if(dLeft > 0.0) {
                        stack[sp++] = left;
                    } else if(dRight > 0.0) {
                        stack[sp++] = right;
                    }
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