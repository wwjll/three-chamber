import { SceneGenerator } from '../SceneGenerator.js'

/**
 * Transitional WebGL scene encoder.
 *
 * SceneGenerator still owns the legacy collection, BVH, and packing implementation.
 * Keeping it behind this boundary lets those stages be extracted independently
 * without changing PathTracer or application code again.
 */
class GpuSceneEncoder {
    encode(scene, options = {}) {
        return new SceneGenerator(scene, options).generate();
    }
}

export { GpuSceneEncoder };
