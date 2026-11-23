import { SceneGenerator } from '../SceneGenerator.js'

class GpuSceneEncoder {
    encode(scene, options = {}) {
        return new SceneGenerator(scene, options).generate();
    }
}

export { GpuSceneEncoder };
