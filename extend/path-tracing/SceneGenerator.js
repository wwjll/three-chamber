import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

import {
    texelsPerTriangle,
    texelsPerBVHNode,
    fixedDataTextureWidth
} from './Constants'

class Triangle {
    constructor(v1, v2, v3, n1, n2, n3, uv1, uv2, uv3) {
        // positions normals and uvs
        this.p1 = v1;
        this.p2 = v2;
        this.p3 = v3;
        this.n1 = n1;
        this.n2 = n2;
        this.n3 = n3;
        this.uv1 = uv1;
        this.uv2 = uv2;
        this.uv3 = uv3;

        this.aa = new THREE.Vector3(Infinity, Infinity, Infinity);
        this.bb = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
        this.center = new THREE.Vector3(0, 0, 0);

        this.computeBoundingBox();
        this.computeCenteic();
    }

    computeBoundingBox() {
        this.aa.x = Math.min(this.p1.x, Math.min(this.p2.x, this.p3.x));
        this.aa.y = Math.min(this.p1.y, Math.min(this.p2.y, this.p3.y));
        this.aa.z = Math.min(this.p1.z, Math.min(this.p2.z, this.p3.z));
        this.bb.x = Math.max(this.p1.x, Math.max(this.p2.x, this.p3.x));
        this.bb.y = Math.max(this.p1.y, Math.max(this.p2.y, this.p3.y));
        this.bb.z = Math.max(this.p1.z, Math.max(this.p2.z, this.p3.z));
    }

    computeCenteic() {
        this.center = new THREE.Vector3(
            (this.p1.x + this.p2.x + this.p3.x) / 3,
            (this.p1.y + this.p2.y + this.p3.y) / 3,
            (this.p1.z + this.p2.z + this.p3.z) / 3
        );
    }
}

class BVHNode {
    constructor() {
        this.aa = new THREE.Vector3(Infinity, Infinity, Infinity);
        this.bb = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
        this.id = null;
        this.isLeaf = null;
        this.left = null;
        this.right = null;
        this.index = null;
        this.size = null;
    }
}

class BVHBuilder {

    constructor(geometry, leafSize = 8) {
        this.position = geometry.attributes.position.array;
        if (!geometry.attributes.normal) {
            geometry.computeVertexNormals();
        }
        this.normal = geometry.attributes.normal.array;
        if (geometry.attributes.uv) {
            this.uv = geometry.attributes.uv.array;
        }
        else {
            this.uv = [];
        }
        this.totalTriangles = this.position.length / 9;
        this.triangles = [];
        this.nodes = [];
        this.leafSize = leafSize;

        this.prepare();

    }

    prepare() {
        this.nodes = [];
        this.triangles = [];
        for (let i = 0; i < this.totalTriangles; ++i) {
            this.triangles.push(new Triangle(
                new THREE.Vector3(
                    this.position[9 * i],
                    this.position[9 * i + 1],
                    this.position[9 * i + 2]
                ),
                new THREE.Vector3(
                    this.position[9 * i + 3],
                    this.position[9 * i + 4],
                    this.position[9 * i + 5]
                ),
                new THREE.Vector3(
                    this.position[9 * i + 6],
                    this.position[9 * i + 7],
                    this.position[9 * i + 8]
                ),
                new THREE.Vector3(
                    this.normal[9 * i],
                    this.normal[9 * i + 1],
                    this.normal[9 * i + 2]
                ),
                new THREE.Vector3(
                    this.normal[9 * i + 3],
                    this.normal[9 * i + 4],
                    this.normal[9 * i + 5]
                ),
                new THREE.Vector3(
                    this.normal[9 * i + 6],
                    this.normal[9 * i + 7],
                    this.normal[9 * i + 8]
                ),
                new THREE.Vector2(
                    this.uv[6 * i],
                    this.uv[6 * i + 1],
                ),
                new THREE.Vector2(
                    this.uv[6 * i + 2],
                    this.uv[6 * i + 3],
                ),
                new THREE.Vector2(
                    this.uv[6 * i + 4],
                    this.uv[6 * i + 5],
                )
            ));
        }
    }

    setGeometry(geometry) {
        this.position = geometry.attributes.position.array;
        if (!geometry.attributes.normal) {
            geometry.computeVertexNormals();
        }
        this.normal = geometry.attributes.normal.array;
        if (geometry.attributes.uv) {
            this.uv = geometry.attributes.uv.array;
            this.hasUv = true;
        }
        else {
            this.uv = [];
            this.hasUv = false;
        }
        this.init();
    }

    rangeSort(arr, left, right, compareFn) {
        let leftArr = arr.slice(0, left);
        let rangeArr = arr.slice(left, right);
        let rightArr = arr.slice(right, this.totalTriangles);
        rangeArr.sort(compareFn);
        return leftArr.concat(rangeArr).concat(rightArr);
    }

    sortTrianglesByLongestAxis(node, left, right) {
        let lenX = node.bb.x - node.aa.x;
        let lenY = node.bb.y - node.aa.y;
        let lenZ = node.bb.z - node.aa.z;
        if (lenX >= lenY && lenX >= lenZ) {
            this.triangles = this.rangeSort(this.triangles, left, right + 1, (a, b) => { return a.center.x - b.center.x; });
        }

        if (lenY >= lenX && lenY >= lenZ) {
            this.triangles = this.rangeSort(this.triangles, left, right + 1, (a, b) => { return a.center.y - b.center.y; });
        }

        if (lenZ >= lenY && lenZ >= lenX) {
            this.triangles = this.rangeSort(this.triangles, left, right + 1, (a, b) => { return a.center.z - b.center.z; });
        }
    }

    createNode(left, right) {
        let node = new BVHNode();
        let triangles = this.triangles;
        for (let i = left; i <= right; ++i) {
            let minX = Math.min(triangles[i].p1.x, Math.min(triangles[i].p2.x, triangles[i].p3.x));
            let minY = Math.min(triangles[i].p1.y, Math.min(triangles[i].p2.y, triangles[i].p3.y));
            let minZ = Math.min(triangles[i].p1.z, Math.min(triangles[i].p2.z, triangles[i].p3.z));
            node.aa.x = Math.min(node.aa.x, minX);
            node.aa.y = Math.min(node.aa.y, minY);
            node.aa.z = Math.min(node.aa.z, minZ);

            let maxX = Math.max(triangles[i].p1.x, Math.max(triangles[i].p2.x, triangles[i].p3.x));
            let maxY = Math.max(triangles[i].p1.y, Math.max(triangles[i].p2.y, triangles[i].p3.y));
            let maxZ = Math.max(triangles[i].p1.z, Math.max(triangles[i].p2.z, triangles[i].p3.z));
            node.bb.x = Math.max(node.bb.x, maxX);
            node.bb.y = Math.max(node.bb.y, maxY);
            node.bb.z = Math.max(node.bb.z, maxZ);
        }
        this.nodes.push(node);
        node.id = this.nodes.length - 1;
        node.isLeaf = false;
        node.left = node.right = node.index = 0;
        return node;
    }

    createSahNode(left, right) {
        let Node = this.createNode(left, right);
        let Split = this.calculateSah(left, right);
        return { Split, Node };
    }

    calculateSah(left, right) {
        let Cost = Infinity;
        let Split = 0;
        let Axis = 0;
        // let Split = Math.floor((left + right) / 2);
        for (let axis = 0; axis < 3; ++axis) {
            this.sortTrianglesByAxis(axis, left, right);
            let leftMin = [];
            let leftMax = [];
            let rightMin = [];
            let rightMax = [];
            // initialize left and right aabb box pairs
            for (let i = 0; i < right - left + 1; ++i) {
                leftMin.push(new THREE.Vector3(Infinity, Infinity, Infinity));
                rightMin.push(new THREE.Vector3(Infinity, Infinity, Infinity));
                leftMax.push(new THREE.Vector3(-Infinity, -Infinity, -Infinity));
                rightMax.push(new THREE.Vector3(-Infinity, -Infinity, -Infinity));
            }
            // calculate the all possible pair of leftAABB and rightAABB
            for (let i = left; i <= right; ++i) {
                let t = this.triangles[i];
                let bias = (i == left) ? 0 : 1;
                leftMax[i - left].x = Math.max(leftMax[i - left - bias].x, Math.max(t.p1.x, Math.max(t.p2.x, t.p3.x)));
                leftMax[i - left].y = Math.max(leftMax[i - left - bias].y, Math.max(t.p1.y, Math.max(t.p2.y, t.p3.y)));
                leftMax[i - left].z = Math.max(leftMax[i - left - bias].z, Math.max(t.p1.z, Math.max(t.p2.z, t.p3.z)));
                leftMin[i - left].x = Math.min(leftMin[i - left - bias].x, Math.min(t.p1.x, Math.min(t.p2.x, t.p3.x)));
                leftMin[i - left].y = Math.min(leftMin[i - left - bias].y, Math.min(t.p1.y, Math.min(t.p2.y, t.p3.y)));
                leftMin[i - left].z = Math.min(leftMin[i - left - bias].z, Math.min(t.p1.z, Math.min(t.p2.z, t.p3.z)));

                t = this.triangles[left + right - i];
                rightMax[right - i].x = Math.max(rightMax[right - i + bias].x, Math.max(t.p1.x, Math.max(t.p2.x, t.p3.x)));
                rightMax[right - i].y = Math.max(rightMax[right - i + bias].y, Math.max(t.p1.y, Math.max(t.p2.y, t.p3.y)));
                rightMax[right - i].z = Math.max(rightMax[right - i + bias].z, Math.max(t.p1.z, Math.max(t.p2.z, t.p3.z)));

                rightMin[right - i].x = Math.min(rightMin[right - i + bias].x, Math.min(t.p1.x, Math.min(t.p2.x, t.p3.x)));
                rightMin[right - i].y = Math.min(rightMin[right - i + bias].y, Math.min(t.p1.y, Math.min(t.p2.y, t.p3.y)));
                rightMin[right - i].z = Math.min(rightMin[right - i + bias].z, Math.min(t.p1.z, Math.min(t.p2.z, t.p3.z)));

            }

            // calculate the cost by pre computed pair of left and right part
            let cost = Infinity;
            let split = left;
            for (let i = left; i <= right - 1; ++i) {
                let leftAA = leftMin[i - left];
                let leftBB = leftMax[i - left];
                let lenX = leftBB.x - leftAA.x;
                let lenY = leftBB.y - leftAA.y;
                let lenZ = leftBB.z - leftAA.z;
                let leftS = (lenX * lenY) + (lenX * lenZ) + (lenY * lenZ);

                let rightAA = rightMin[i - left];
                let rightBB = rightMax[i - left];
                lenX = rightBB.x - rightAA.x;
                lenY = rightBB.y - rightAA.y;
                lenZ = rightBB.z - rightAA.z;
                let rightS = (lenX * lenY) + (lenX * lenZ) + (lenY * lenZ);
                let S = leftS * (i - left + 1) + rightS * (right - i);

                if (S < cost) {
                    cost = S;
                    split = i;
                }
            }
            if (cost < Cost) {
                Cost = cost;
                Axis = axis;
                Split = split;
            }
        }
        this.sortTrianglesByAxis(Axis, left, right);
        return Split;
    }

    buildRecursiveMedian(left, right) {
        if (left > right) return;

        let node = this.createNode(left, right);

        if (right - left + 1 <= this.leafSize) {
            node.isLeaf = true;
            node.index = left;
            node.size = right - left + 1;
            return node.id;
        }
        this.sortTrianglesByLongestAxis(node, left, right);
        let mid = Math.floor((left + right) / 2);
        let l = this.buildRecursiveMedian(left, mid);
        let r = this.buildRecursiveMedian(mid + 1, right);

        node.left = l;
        node.right = r;

        return node.id;
    }

    buildRecursiveSAH(left, right) {

        if (left > right) return;
        let node = this.createNode(left, right);

        node.isLeaf = false;
        if (right - left + 1 <= this.leafSize) {
            node.isLeaf = true;
            node.index = left;
            node.size = right - left + 1;
            return node.id;
        }

        let Split = this.calculateSah(left, right);

        node.left = this.buildRecursiveSAH(left, Split);
        node.right = this.buildRecursiveSAH(Split + 1, right);

        // console.log(left, Split, right);
        return node.id;
    }

    buildIterativeMedian() {
        let $stacks = [];
        function push(l, r, lastNode, flag) {
            $stacks.push([
                l,
                r,
                lastNode,
                flag
            ]);
        };
        function pop() {
            return $stacks.pop();
        }

        push(0, this.totalTriangles - 1, null, null);
        while ($stacks.length > 0) {
            let stack = pop();
            let left = stack[0];
            let right = stack[1];
            let lastNode = stack[2];
            let flag = stack[3];

            if (left > right) {
                return;
            }

            let node = this.createNode(left, right);
            if (lastNode) {
                if (flag == "left") {
                    lastNode.left = node.id;
                }
                else if (flag == "right") {
                    lastNode.right = node.id;
                }
            }
            if (right - left < this.leafSize) {
                node.isLeaf = true;
                node.index = left;
                node.size = right - left + 1;
                continue;
            }

            this.sortTrianglesByLongestAxis(node, left, right);
            let mid = Math.floor((left + right) / 2);
            if (mid < left || mid > right) {
                continue;
            }

            push(left, mid, node, "left");
            push(mid + 1, right, node, "right");
        }

    }

    buildIterativeSAH() {
        let $stacks = [];
        function $call(l, r, split, node) {
            $stacks.push({
                ok: false,
                left: l,
                right: r,
                split: split,
                node: node
            });
        };

        let { Split, Node } = this.createSahNode(0, this.totalTriangles - 1);
        $call(0, this.totalTriangles - 1, Split, Node);

        while ($stacks.length > 0) {

            $stacks.forEach((stack, index) => {
                if (stack.ok) {
                    $stacks.splice(index, 1);
                    return;
                }

                let { left, right, node } = stack;

                if (left > right) {
                    stack.ok = true;
                    $stacks.splice(index, 1);
                    return;
                }

                node.isLeaf = false;
                if (right - left + 1 <= this.leafSize) {
                    node.index = left;
                    node.size = right - left + 1;
                    node.isLeaf = true;
                    stack.ok = true;
                    $stacks.splice(index, 1);
                    return;
                }

                let split = stack.split;

                let obj = this.createSahNode(left, split);
                node.left = obj.Node.id;
                $call(left, split, obj.Split, obj.Node);

                obj = this.createSahNode(split + 1, right);
                node.right = obj.Node.id;
                $call(split + 1, right, obj.Split, obj.Node);

                stack.node = node;
                stack.ok = true;
                $stacks.splice(index, 1);
            });

        }

    }

    build(type = 1, method = 0) {
        switch ((type << 1) || method) {
            case 0:
                this.buildRecursiveMedian(0, this.totalTriangles - 1);
                break;
            case 1:
                this.buildRecursiveMedian(0, this.totalTriangles - 1);
                break;
            case 2:
                this.buildIterativeMedian();
                break;
            case 3:
                this.buildIterativeSAH();
                break;
        }
    }
}

export class SceneGenerator {

    constructor(model) {
        this.model = model;
        this.geometries = [];
    }

    generate() {

        this.model.traverse(child => {
            if (child.isMesh) {
                child.geometry.applyMatrix4(child.matrix);
                this.geometries.push(child.geometry);
            }
        });

        const mergedGeometry = mergeGeometries(this.geometries).toNonIndexed();
        const builder = new BVHBuilder(mergedGeometry);

        const start = performance.now();
        builder.build();
        const end = performance.now();
        console.log(`BVH construct time: ${(end - start).toFixed(2)} ms.`)

        const { totalTriangles, triangles, nodes } = builder;

        const texelWidth = fixedDataTextureWidth;
        let totalTexels = texelsPerTriangle * totalTriangles;
        let texelHeight = ~~Math.pow(2, Math.log2(totalTexels / texelWidth)) + 1;
        const th = texelHeight;

        let triangleArray = new Float32Array(texelWidth * texelHeight * 4);
        let stride = 32;

        // Triangles Data Texture
        for (let i = 0; i < totalTriangles; ++i) {
            let triangle = triangles[i];
            let vp1 = triangle.p1;
            let vp2 = triangle.p2;
            let vp3 = triangle.p3;
            let vn1 = triangle.n1;
            let vn2 = triangle.n2;
            let vn3 = triangle.n3;
            let vt1 = triangle.uv1;
            let vt2 = triangle.uv2;
            let vt3 = triangle.uv3;

            //slot 0
            triangleArray[stride * i + 0] = vp1.x;
            triangleArray[stride * i + 1] = vp1.y;
            triangleArray[stride * i + 2] = vp1.z;
            triangleArray[stride * i + 3] = vp2.x;

            //slot 1
            triangleArray[stride * i + 4] = vp2.y;
            triangleArray[stride * i + 5] = vp2.z;
            triangleArray[stride * i + 6] = vp3.x;
            triangleArray[stride * i + 7] = vp3.y;

            //slot 2
            triangleArray[stride * i + 8] = vp3.z;
            triangleArray[stride * i + 9] = vn1.x;
            triangleArray[stride * i + 10] = vn1.y;
            triangleArray[stride * i + 11] = vn1.z;

            //slot 3
            triangleArray[stride * i + 12] = vn2.x;
            triangleArray[stride * i + 13] = vn2.y;
            triangleArray[stride * i + 14] = vn2.z;
            triangleArray[stride * i + 15] = vn3.x;

            //slot 4
            triangleArray[stride * i + 16] = vn3.y;
            triangleArray[stride * i + 17] = vn3.z;
            triangleArray[stride * i + 18] = vt1.x;
            triangleArray[stride * i + 19] = vt1.y;

            //slot 5
            triangleArray[stride * i + 20] = vt2.x;
            triangleArray[stride * i + 21] = vt2.y;
            triangleArray[stride * i + 22] = vt3.x;
            triangleArray[stride * i + 23] = vt3.y;

            //slot 6
            triangleArray[stride * i + 24] = 0;
            triangleArray[stride * i + 25] = 0;
            triangleArray[stride * i + 26] = 0;
            triangleArray[stride * i + 27] = 0;

            //slot 7
            triangleArray[stride * i + 28] = 0;
            triangleArray[stride * i + 29] = 0;
            triangleArray[stride * i + 30] = 0;
            triangleArray[stride * i + 31] = 0;

        }

        const triangleDataTexture = new THREE.DataTexture(
            triangleArray,
            texelWidth,
            texelHeight,
            THREE.RGBAFormat,
            THREE.FloatType,
            THREE.Texture.DEFAULT_MAPPING,
            THREE.ClampToEdgeWrapping,
            THREE.ClampToEdgeWrapping,
            THREE.NearestFilter,
            THREE.NearestFilter,
            1,
            THREE.LinearEncoding
            // THREE.LinearSRGBColorSpace
        );
        triangleDataTexture.flipY = false;
        triangleDataTexture.generateMipmaps = false;
        triangleDataTexture.needsUpdate = true;
        triangleDataTexture.unpackAlignment = 8;

        // BVH Datatexture
        const totalNodes = nodes.length;
        totalTexels = texelsPerBVHNode * totalNodes;
        texelHeight = ~~Math.pow(2, Math.log2(totalTexels / texelWidth)) + 1;
        const bh = texelHeight;

        stride = 16;
        const nodesArray = new Float32Array(texelWidth * texelHeight * 4);

        for (let i = 0; i < totalNodes; ++i) {
            let node = nodes[i];
            // slot 0
            nodesArray[i * stride] = node.aa.x;
            nodesArray[i * stride + 1] = node.aa.y;
            nodesArray[i * stride + 2] = node.aa.z;
            nodesArray[i * stride + 3] = node.bb.x;

            // slot 1
            nodesArray[i * stride + 4] = node.bb.y;
            nodesArray[i * stride + 5] = node.bb.z;
            nodesArray[i * stride + 6] = node.id;
            nodesArray[i * stride + 7] = nodes[i].isLeaf ? 1 : 0;

            // slot 2
            nodesArray[i * stride + 8] = node.left;
            nodesArray[i * stride + 9] = node.right;
            nodesArray[i * stride + 10] = node.index;
            nodesArray[i * stride + 11] = node.size;

            // slot 3
            nodesArray[i * stride + 12] = 0;
            nodesArray[i * stride + 13] = 0;
            nodesArray[i * stride + 14] = 0;
            nodesArray[i * stride + 15] = 0;

        }

        // write nodes data into texture
        const bvhDataTexture = new THREE.DataTexture(
            nodesArray,
            texelWidth,
            texelHeight,
            THREE.RGBAFormat,
            THREE.FloatType,
            THREE.Texture.DEFAULT_MAPPING,
            THREE.ClampToEdgeWrapping,
            THREE.ClampToEdgeWrapping,
            THREE.NearestFilter,
            THREE.NearestFilter,
            1,
            THREE.LinearEncoding
        );
        bvhDataTexture.flipY = false;
        bvhDataTexture.generateMipmaps = false;
        bvhDataTexture.needsUpdate = true;
        bvhDataTexture.unpackAlignment = 4;

        return {
            triangle: {
                dataTexture: triangleDataTexture,
                textureWidth: fixedDataTextureWidth,
                textureHeight: th
            },
            bvh: {
                dataTexture: bvhDataTexture,
                textureWidth: fixedDataTextureWidth,
                textureHeight: bh
            }

        }
    }

}