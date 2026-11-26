import { BVH_NODE_WORDS } from '../partition/bvh/BVHLayout.js'

const floatsPerTexel = 4;

const gpuSceneLayout = Object.freeze({
    version: 4,
    textureWidth: 512,
    triangle: Object.freeze({
        texels: 8,
        stride: 8 * floatsPerTexel,
    }),
    // RGBA32UI texels holding the extend/partition node words unchanged.
    bvhNode: Object.freeze({
        texels: BVH_NODE_WORDS / floatsPerTexel,
        stride: BVH_NODE_WORDS,
        leafSize: 8,
    }),
    material: Object.freeze({
        texels: 6,
        stride: 6 * floatsPerTexel,
    }),
    limits: Object.freeze({
        maxBounces: 8,
        maxTransparentSteps: 8,
    }),
});

export {
    floatsPerTexel,
    gpuSceneLayout,
};
