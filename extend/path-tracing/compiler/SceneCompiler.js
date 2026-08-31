import { CompiledScene } from './CompiledScene.js'
import { GpuSceneEncoder } from './GpuSceneEncoder.js'

class SceneCompiler {
    constructor({ encoder = new GpuSceneEncoder(), encoderOptions = {} } = {}) {
        this.encoder = encoder;
        this.encoderOptions = encoderOptions;
    }

    compile(scene, options = {}) {
        if (!scene?.traverse) {
            throw new TypeError('[PathTracing] SceneCompiler.compile requires a Three.js Object3D.');
        }

        const encodedScene = this.encoder.encode(scene, {
            ...this.encoderOptions,
            ...options,
        });
        return new CompiledScene(encodedScene);
    }
}

export { SceneCompiler };
