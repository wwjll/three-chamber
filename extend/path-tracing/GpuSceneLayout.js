const floatsPerTexel = 4;

const gpuSceneLayout = Object.freeze({
    version: 1,
    textureWidth: 512,
    triangle: Object.freeze({
        texels: 8,
        stride: 8 * floatsPerTexel,
    }),
    bvhNode: Object.freeze({
        texels: 4,
        stride: 4 * floatsPerTexel,
        leafSize: 8,
    }),
    material: Object.freeze({
        texels: 5,
        stride: 5 * floatsPerTexel,
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
