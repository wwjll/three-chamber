import { gpuSceneLayout } from '../GpuSceneLayout.js'

class CompiledScene {
    constructor(encodedScene) {
        const { triangle, bvh, material } = encodedScene || {};
        if (!triangle?.dataTexture || !bvh?.dataTexture || !material?.dataTexture) {
            throw new Error('[PathTracing] CompiledScene requires triangle, BVH, and material buffers.');
        }

        this.layoutVersion = gpuSceneLayout.version;
        this.triangle = triangle;
        this.bvh = bvh;
        this.material = material;
        this.disposed = false;
    }

    dispose() {
        if (this.disposed) {
            return;
        }

        this.disposed = true;
        this.triangle.dataTexture.dispose();
        this.bvh.dataTexture.dispose();
        this.material.dataTexture.dispose();
    }
}

export { CompiledScene };
