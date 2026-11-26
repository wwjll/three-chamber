import {
    ClampToEdgeWrapping,
    Color,
    DataTexture,
    DoubleSide,
    FloatType,
    Matrix3,
    NearestFilter,
    NoColorSpace,
    RGBAFormat,
    RGBAIntegerFormat,
    Texture,
    UnsignedIntType,
    Vector3,
    Vector4,
} from 'three';

import { buildBVH } from '../partition/bvh/buildBVH.js'
import { getBVHStats } from '../partition/bvh/queryBVH.js'
import { computeTriangleBounds } from '../partition/triangles.js'
import {
    texelsPerTriangle,
    texelsPerBVHNode,
    texelsPerMaterial,
    fixedDataTextureWidth,
    bvhLeafSize,
} from './Constants.js'
import { gpuSceneLayout } from './GpuSceneLayout.js'

const vertexPosition = new Vector3();
const vertexNormal = new Vector3();
const edge = new Vector3();
const skinnedNormal = new Vector4();
const normalMatrix = new Matrix3();
// Keeps a black attenuation channel finite; it still absorbs everything
// within a tiny fraction of its attenuation distance.
const minAttenuationColor = 1e-6;

function getTriangleCount(geometry) {
    return (geometry.index ?? geometry.getAttribute('position')).count / 3;
}

// three.js and KHR_materials_volume define attenuationColor as the color white
// light turns after attenuationDistance in the medium. Beer-Lambert then gives
// the absorption coefficient -ln(color) / distance per channel. Materials
// without a volume, or with the default infinite distance, absorb nothing.
function writeAbsorptionCoefficient(material, target, offset) {
    const color = material?.attenuationColor;
    const distance = material?.attenuationDistance ?? Infinity;
    for (const [channel, component] of ['r', 'g', 'b'].entries()) {
        target[offset + channel] = color
            ? -Math.log(Math.max(color[component], minAttenuationColor)) / distance
            : 0.0;
    }
}

function getTextureHeight(texelCount) {
    return Math.max(1, Math.ceil(texelCount / fixedDataTextureWidth));
}

function createDataTexture(data, textureHeight, format, type, unpackAlignment) {
    const texture = new DataTexture(
        data,
        fixedDataTextureWidth,
        textureHeight,
        format,
        type,
        Texture.DEFAULT_MAPPING,
        ClampToEdgeWrapping,
        ClampToEdgeWrapping,
        NearestFilter,
        NearestFilter,
        1
    );
    texture.colorSpace = NoColorSpace;
    texture.flipY = false;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    texture.unpackAlignment = unpackAlignment;
    return texture;
}

// Writes world-space positions and normals for every vertex of the mesh.
// getVertexPosition applies morph targets and skinning from the bones'
// matrixWorld and returns local space, so call it after updateMatrixWorld.
// Skinned normals go through the same bone matrices with w = 0, as in the
// three.js skinnormal_vertex chunk. Morph normals are not applied.
function writeWorldVertices(mesh, positions, normals) {
    const { geometry, matrixWorld } = mesh;
    const normal = geometry.getAttribute('normal');
    const vertexCount = geometry.getAttribute('position').count;
    normalMatrix.getNormalMatrix(matrixWorld);

    for (let vertex = 0; vertex < vertexCount; vertex++) {
        mesh.getVertexPosition(vertex, vertexPosition).applyMatrix4(matrixWorld).toArray(positions, 3 * vertex);
        if (normal) {
            vertexNormal.fromBufferAttribute(normal, vertex);
            if (mesh.isSkinnedMesh) {
                skinnedNormal.set(vertexNormal.x, vertexNormal.y, vertexNormal.z, 0);
                mesh.applyBoneTransform(vertex, skinnedNormal);
                vertexNormal.set(skinnedNormal.x, skinnedNormal.y, skinnedNormal.z);
            }
            vertexNormal.applyNormalMatrix(normalMatrix).toArray(normals, 3 * vertex);
        }
    }
}

// Gives every corner of the triangles the face normal, for meshes without
// a normal attribute.
function writeFaceNormals(positions, normals, firstTriangle, triangleCount) {
    for (let triangle = firstTriangle; triangle < firstTriangle + triangleCount; triangle++) {
        const offset = 9 * triangle;
        vertexPosition.fromArray(positions, offset);
        vertexNormal.fromArray(positions, offset + 3).sub(vertexPosition);
        edge.fromArray(positions, offset + 6).sub(vertexPosition);
        vertexNormal.cross(edge).normalize();
        for (let corner = 0; corner < 3; corner++) {
            vertexNormal.toArray(normals, offset + 3 * corner);
        }
    }
}

// Triangle slot k of the texture holds triangle primitiveIndices[k], so a
// leaf's primitive offset is also its first triangle slot.
function encodeTriangles({ positions, normals, uvs, materialIndices }, primitiveIndices) {
    const triangleCount = primitiveIndices.length;
    const textureHeight = getTextureHeight(texelsPerTriangle * triangleCount);
    const data = new Float32Array(fixedDataTextureWidth * textureHeight * 4);
    const stride = gpuSceneLayout.triangle.stride;

    for (let slot = 0; slot < triangleCount; slot++) {
        const triangle = primitiveIndices[slot];
        const offset = stride * slot;
        data.set(positions.subarray(9 * triangle, 9 * triangle + 9), offset);
        data.set(normals.subarray(9 * triangle, 9 * triangle + 9), offset + 9);
        data.set(uvs.subarray(6 * triangle, 6 * triangle + 6), offset + 18);
        data[offset + 24] = materialIndices[triangle];
    }

    return {
        dataTexture: createDataTexture(data, textureHeight, RGBAFormat, FloatType, 8),
        textureWidth: fixedDataTextureWidth,
        textureHeight,
    };
}

// The 32-byte nodes are uploaded unchanged as two RGBA32UI texels.
function encodeBVH(bvh) {
    const textureHeight = getTextureHeight(texelsPerBVHNode * bvh.nodeCount);
    const data = new Uint32Array(fixedDataTextureWidth * textureHeight * 4);
    data.set(bvh.uint32);

    return {
        dataTexture: createDataTexture(data, textureHeight, RGBAIntegerFormat, UnsignedIntType, 4),
        textureWidth: fixedDataTextureWidth,
        textureHeight,
    };
}

class SceneGenerator {

    constructor(model, options = {}) {
        this.model = model;
        this.meshFilter = options.meshFilter || null;
        this.materials = [];
        this.materialIndexMap = new Map();
        this.textureSlotMaps = {
            albedo: new Map(),
            normal: new Map(),
            metallicRoughness: new Map(),
            emissive: new Map(),
        };
        this.textureSlots = {
            albedo: [],
            normal: [],
            metallicRoughness: [],
            emissive: [],
        };
    }

    registerTexture(type, texture) {
        if (!texture) {
            return -1;
        }

        const textureSlotMap = this.textureSlotMaps[type];
        const textureSlots = this.textureSlots[type];
        const key = texture.uuid;

        if (textureSlotMap.has(key)) {
            return textureSlotMap.get(key);
        }

        const slotIndex = textureSlots.length;
        textureSlotMap.set(key, slotIndex);
        textureSlots.push(texture);
        return slotIndex;
    }

    registerMaterial(material) {
        const key = material?.uuid || '__default_material__';
        if (!this.materialIndexMap.has(key)) {
            this.materialIndexMap.set(key, this.materials.length);
            this.materials.push(material || null);
        }
        return this.materialIndexMap.get(key);
    }

    collectMeshes() {
        const meshes = [];
        this.model.traverse(child => {
            if (child.isMesh && (!this.meshFilter || this.meshFilter(child))) {
                meshes.push(child);
            }
        });

        if (meshes.length === 0) {
            throw new Error('[PathTracing] No meshes matched the SceneGenerator filter.');
        }
        return meshes;
    }

    writeMaterialIndices(mesh, materialIndices, firstTriangle, triangleCount) {
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        const { groups } = mesh.geometry;
        const end = firstTriangle + triangleCount;

        if (materials.length > 1 && groups.length > 0) {
            groups.forEach(group => {
                const groupStart = firstTriangle + Math.floor(group.start / 3);
                const groupEnd = Math.min(end, groupStart + Math.floor(group.count / 3));
                const materialIndex = this.registerMaterial(materials[group.materialIndex] || materials[0] || null);
                materialIndices.fill(materialIndex, groupStart, groupEnd);
            });
        } else {
            materialIndices.fill(this.registerMaterial(materials[0] || null), firstTriangle, end);
        }
    }

    // Returns world-space triangles as flat arrays: nine position and nine
    // normal floats, six UV floats, and one material index per triangle.
    collectTriangles(meshes) {
        let triangleCount = 0;
        meshes.forEach(mesh => {
            triangleCount += getTriangleCount(mesh.geometry);
        });

        const positions = new Float32Array(9 * triangleCount);
        const normals = new Float32Array(9 * triangleCount);
        const uvs = new Float32Array(6 * triangleCount);
        const materialIndices = new Uint32Array(triangleCount);

        let firstTriangle = 0;
        meshes.forEach(mesh => {
            const { geometry } = mesh;
            const { index } = geometry;
            const uv = geometry.getAttribute('uv');
            const vertexCount = geometry.getAttribute('position').count;
            const vertexPositions = new Float32Array(3 * vertexCount);
            const vertexNormals = new Float32Array(3 * vertexCount);
            const meshTriangleCount = getTriangleCount(geometry);

            writeWorldVertices(mesh, vertexPositions, vertexNormals);
            this.writeMaterialIndices(mesh, materialIndices, firstTriangle, meshTriangleCount);

            for (let corner = 0; corner < 3 * meshTriangleCount; corner++) {
                const vertex = index ? index.getX(corner) : corner;
                const target = 3 * firstTriangle + corner;
                for (let axis = 0; axis < 3; axis++) {
                    positions[3 * target + axis] = vertexPositions[3 * vertex + axis];
                    normals[3 * target + axis] = vertexNormals[3 * vertex + axis];
                }
                if (uv) {
                    uvs[2 * target] = uv.getX(vertex);
                    uvs[2 * target + 1] = uv.getY(vertex);
                }
            }

            if (!geometry.getAttribute('normal')) {
                writeFaceNormals(positions, normals, firstTriangle, meshTriangleCount);
            }
            firstTriangle += meshTriangleCount;
        });

        return { positions, normals, uvs, materialIndices };
    }

    encodeMaterials() {
        const textureHeight = getTextureHeight(texelsPerMaterial * this.materials.length);
        const materialArray = new Float32Array(fixedDataTextureWidth * textureHeight * 4);
        const stride = gpuSceneLayout.material.stride;

        for (let i = 0; i < this.materials.length; ++i) {
            const material = this.materials[i];
            const color = material?.color || new Color(1, 1, 1);
            const emissive = material?.emissive || new Color(0, 0, 0);
            const emissiveIntensity = material?.emissiveIntensity ?? 1.0;
            const alphaMode = material?.transparent ? 2.0 : ((material?.alphaTest ?? 0.0) > 0.0 ? 1.0 : 0.0);
            if (
                material?.roughnessMap &&
                material?.metalnessMap &&
                material.roughnessMap.uuid !== material.metalnessMap.uuid
            ) {
                console.warn('[PathTracing] roughnessMap and metalnessMap differ; using metalnessMap as metallic-roughness texture.', material);
            }
            const metallicRoughnessTexture = material?.metalnessMap || material?.roughnessMap || null;

            materialArray[stride * i + 0] = color.r;
            materialArray[stride * i + 1] = color.g;
            materialArray[stride * i + 2] = color.b;
            materialArray[stride * i + 3] = material?.roughness ?? 1.0;

            materialArray[stride * i + 4] = material?.metalness ?? 0.0;
            materialArray[stride * i + 5] = emissive.r * emissiveIntensity;
            materialArray[stride * i + 6] = emissive.g * emissiveIntensity;
            materialArray[stride * i + 7] = emissive.b * emissiveIntensity;

            materialArray[stride * i + 8] = this.registerTexture('albedo', material?.map || null);
            materialArray[stride * i + 9] = this.registerTexture('normal', material?.normalMap || null);
            materialArray[stride * i + 10] = this.registerTexture('metallicRoughness', metallicRoughnessTexture);
            materialArray[stride * i + 11] = this.registerTexture('emissive', material?.emissiveMap || null);

            materialArray[stride * i + 12] = material?.opacity ?? 1.0;
            materialArray[stride * i + 13] = material?.normalScale?.x ?? 1.0;
            materialArray[stride * i + 14] = material?.normalScale?.y ?? 1.0;
            materialArray[stride * i + 15] = alphaMode;
            materialArray[stride * i + 16] = material?.side === DoubleSide ? 1.0 : 0.0;
            materialArray[stride * i + 17] = material?.transmission ?? 0.0;
            materialArray[stride * i + 18] = material?.ior ?? 1.5;
            materialArray[stride * i + 19] = material?.thickness ?? 0.0;

            writeAbsorptionCoefficient(material, materialArray, stride * i + 20);
        }

        return {
            dataTexture: createDataTexture(materialArray, textureHeight, RGBAFormat, FloatType, 8),
            textureWidth: fixedDataTextureWidth,
            textureHeight,
            count: this.materials.length,
            textures: this.textureSlots,
        };
    }

    generate() {
        this.model.updateWorldMatrix(true, true);

        const startTime = performance.now();
        const meshes = this.collectMeshes();
        const triangles = this.collectTriangles(meshes);
        const collectTime = performance.now();
        const bvh = buildBVH(computeTriangleBounds(triangles.positions), { leafThreshold: bvhLeafSize });
        const buildTime = performance.now();
        const triangle = encodeTriangles(triangles, bvh.primitiveIndices);
        const encodedBVH = encodeBVH(bvh);
        const material = this.encodeMaterials();
        const encodeTime = performance.now();

        return {
            triangle,
            bvh: encodedBVH,
            material,
            stats: {
                meshCount: meshes.length,
                triangleCount: bvh.primitiveCount,
                materialCount: material.count,
                collectMs: collectTime - startTime,
                bvhBuildMs: buildTime - collectTime,
                encodeMs: encodeTime - buildTime,
                ...getBVHStats(bvh),
            },
        };
    }

}

export { SceneGenerator };
