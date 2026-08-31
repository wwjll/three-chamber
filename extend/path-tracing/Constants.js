import { gpuSceneLayout } from './GpuSceneLayout.js'

const texelsPerTriangle = gpuSceneLayout.triangle.texels;
const texelsPerBVHNode = gpuSceneLayout.bvhNode.texels;
const texelsPerMaterial = gpuSceneLayout.material.texels;
const fixedDataTextureWidth = gpuSceneLayout.textureWidth;
const bvhLeafSize = gpuSceneLayout.bvhNode.leafSize;
const maxPathBounces = gpuSceneLayout.limits.maxBounces;
const maxTransparentSteps = gpuSceneLayout.limits.maxTransparentSteps;

export {
    bvhLeafSize,
    texelsPerTriangle,
    texelsPerBVHNode,
    texelsPerMaterial,
    fixedDataTextureWidth,
    maxPathBounces,
    maxTransparentSteps,
}
