import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { OutputMaterial } from './materials/OutputMaterial'
import { PathTracingMaterial } from './materials/PathTracingMaterial'

import {
    texelsPerTriangle,
    texelsPerBVHNode,
} from './Constants'


function* renderTask() {
    while (true) {
        const { renderer, scene, camera, pathTracingMaterial, outputMaterial } = this;

        camera.updateMatrixWorld();
        camera.updateProjectionMatrix();
        pathTracingMaterial.samples = this.samples;
        pathTracingMaterial.matrixWorld = camera.matrixWorld;
        pathTracingMaterial.projectionMatrixInverse = camera.projectionMatrixInverse;
        pathTracingMaterial.outTexture = this.outRenderTarget.texture;

        renderer.setRenderTarget(this.traceRenderTarget);
        renderer.render(scene, camera);

        outputMaterial.renderTexture = this.traceRenderTarget.texture;

        renderer.setRenderTarget(null);
        this.outputQuad.render(renderer);

        [this.traceRenderTarget, this.outRenderTarget] = [this.outRenderTarget, this.traceRenderTarget];

        this.samples++;
        yield;
    }

}

export class PathTracer {

    constructor(renderer, scene, camera) {

        this.renderer = renderer;
        this.scene = scene;
        this.camera = camera;
        this.task = null;
        this.samples = 0;
        this.init();
    }

    init() {

        this.outRenderTarget = new THREE.WebGLRenderTarget(1, 1, {
            format: THREE.RGBAFormat,
            type: THREE.FloatType,
            magFilter: THREE.NearestFilter,
            minFilter: THREE.NearestFilter
        });

        this.traceRenderTarget = new THREE.WebGLRenderTarget(1, 1, {
            format: THREE.RGBAFormat,
            type: THREE.FloatType,
            magFilter: THREE.NearestFilter,
            minFilter: THREE.NearestFilter
        });

        this.pathTracingQuad = new THREE.Mesh(
            new THREE.PlaneGeometry(2, 2),
            new PathTracingMaterial()
        );
        this.outputQuad = new FullScreenQuad(new OutputMaterial());

        this.scene.add(this.pathTracingQuad);

        this.pathTracingMaterial = this.pathTracingQuad.material;
        this.outputMaterial = this.outputQuad.material;

        this._setContants();
        this._setRenderTexture();
        this.setOriginMaterialInfo(null);
    }

    // set constants used inside shader
    _setContants() {
        this.pathTracingMaterial.texelsPerTriangle = texelsPerTriangle;
        this.pathTracingMaterial.texelsPerBVHNode = texelsPerBVHNode;
    }

    // set full screen textures during rendering
    _setRenderTexture() {
        this.pathTracingMaterial.outTexture = this.outRenderTarget.texture;
        this.outputMaterial.renderTexture = this.traceRenderTarget.texture;
    }

    // set bounces
    setBounce(maxBounce) {
        this.pathTracingMaterial.maxBounce = Math.min(maxBounce, 8);
    }

    // set hdr texture
    setHdrTexture(texture) {
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.generateMipmaps = false;
        this.pathTracingMaterial.hdrTexture = texture;
    }

    setAlbedoTexture(texture) {
        if (!texture) {
            this.pathTracingMaterial.albedoTexture = null;
            this.pathTracingMaterial.useAlbedoTexture = 0;
            return;
        }
        texture.colorSpace = THREE.SRGBColorSpace;
        this.pathTracingMaterial.albedoTexture = texture;
        this.pathTracingMaterial.useAlbedoTexture = 1;
    }

    setOriginMaterialInfo(materialInfo) {
        const pathTracingMaterial = this.pathTracingMaterial;
        const configureTexture = (texture, colorSpace) => {
            if (!texture) {
                return null;
            }
            texture.colorSpace = colorSpace;
            return texture;
        };

        const albedoTexture = configureTexture(materialInfo?.albedo || null, THREE.SRGBColorSpace);
        const normalTexture = configureTexture(materialInfo?.normal || null, THREE.NoColorSpace);
        const roughnessTexture = configureTexture(materialInfo?.roughness || null, THREE.NoColorSpace);
        const metalnessTexture = configureTexture(materialInfo?.metalness || null, THREE.NoColorSpace);
        const aoTexture = configureTexture(materialInfo?.ao || null, THREE.NoColorSpace);
        const emissiveTexture = configureTexture(materialInfo?.emissive || null, THREE.SRGBColorSpace);

        pathTracingMaterial.albedoTexture = albedoTexture;
        pathTracingMaterial.useAlbedoTexture = albedoTexture ? 1 : 0;
        pathTracingMaterial.normalTexture = normalTexture;
        pathTracingMaterial.useNormalTexture = normalTexture ? 1 : 0;
        pathTracingMaterial.roughnessTexture = roughnessTexture;
        pathTracingMaterial.useRoughnessTexture = roughnessTexture ? 1 : 0;
        pathTracingMaterial.metalnessTexture = metalnessTexture;
        pathTracingMaterial.useMetalnessTexture = metalnessTexture ? 1 : 0;
        pathTracingMaterial.aoTexture = aoTexture;
        pathTracingMaterial.useAoTexture = aoTexture ? 1 : 0;
        pathTracingMaterial.emissiveTexture = emissiveTexture;
        pathTracingMaterial.useEmissiveTexture = emissiveTexture ? 1 : 0;

        pathTracingMaterial.baseColorFactor = materialInfo?.baseColorFactor || new THREE.Vector3(1, 1, 1);
        pathTracingMaterial.roughnessFactor = materialInfo?.roughnessFactor ?? 1.0;
        pathTracingMaterial.metalnessFactor = materialInfo?.metalnessFactor ?? 0.0;
        pathTracingMaterial.emissiveFactor = materialInfo?.emissiveFactor || new THREE.Vector3(0, 0, 0);
        pathTracingMaterial.normalScale = materialInfo?.normalScale || new THREE.Vector2(1, 1);
        pathTracingMaterial.aoIntensity = materialInfo?.aoIntensity ?? 1.0;
    }

    setDebugMode(mode) {
        this.pathTracingMaterial.debugMode = mode;
    }

    setMaterialPreset(preset) {
        this.pathTracingMaterial.materialPreset = preset;
    }

    // set Data texture
    setDataTexture(triangle, bvh) {
        const pathTracingMaterial = this.pathTracingQuad.material;
        pathTracingMaterial.triangleDataTexture = triangle.dataTexture;
        pathTracingMaterial.triangleDataTextureSize = {
            x: triangle.textureWidth,
            y: triangle.textureHeight
        };

        pathTracingMaterial.bvhNodeDataTexture = bvh.dataTexture;
        pathTracingMaterial.bvhNodeDataTextureSize = {
            x: bvh.textureWidth,
            y: bvh.textureHeight
        };
    }

    setSize(width, height) {
        width = ~~width;
        height = ~~height;

        if (this.traceRenderTarget.width == width && this.traceRenderTarget.height == height) {
            return;
        }

        this.renderer.setSize(width, height);
        this.traceRenderTarget.setSize(width, height);
        this.outRenderTarget.setSize(width, height);

        this.pathTracingMaterial.resolution = { x: width, y: height };
        this.outputMaterial.resolution = { x: width, y: height };
    }

    update() {

        if (!this.task) {

            this.task = renderTask.call(this);

        }

        this.task.next();
    }

    reset() {
        const currentRenderTarget = this.renderer.getRenderTarget();
        const clearColor = this.renderer.getClearColor(new THREE.Color());
        const clearAlpha = this.renderer.getClearAlpha();

        this.samples = 0;

        this.renderer.setClearColor(0x000000, 0);

        this.renderer.setRenderTarget(this.traceRenderTarget);
        this.renderer.clear();

        this.renderer.setRenderTarget(this.outRenderTarget);
        this.renderer.clear();

        this.renderer.setClearColor(clearColor, clearAlpha);
        this.renderer.setRenderTarget(currentRenderTarget);
    }

}
