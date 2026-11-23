import { ClampToEdgeWrapping, Color, DataArrayTexture, FloatType, LinearFilter, LinearMipmapLinearFilter, Mesh, NearestFilter, NoColorSpace, OrthographicCamera, PlaneGeometry, RGBAFormat, RepeatWrapping, Scene, SRGBColorSpace, UnsignedByteType, Vector2, Vector3, WebGLRenderTarget } from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { OutputMaterial } from './materials/OutputMaterial.js'
import { PathTracingMaterial } from './materials/PathTracingMaterial.js'

import {
    texelsPerTriangle,
    texelsPerBVHNode,
    texelsPerMaterial,
    maxPathBounces,
    maxTransparentSteps,
} from './Constants.js'


function* renderTask() {
    while (true) {
        const { renderer, camera, traceScene, traceCamera, pathTracingMaterial, outputMaterial } = this;

        camera.updateMatrixWorld();
        camera.updateProjectionMatrix();
        pathTracingMaterial.samples = this.samples;
        camera.getWorldPosition(this.cameraOrigin);
        pathTracingMaterial.cameraOrigin = this.cameraOrigin;
        pathTracingMaterial.matrixWorld = camera.matrixWorld;
        pathTracingMaterial.projectionMatrixInverse = camera.projectionMatrixInverse;
        pathTracingMaterial.outTexture = this.outRenderTarget.texture;

        pathTracingMaterial.diagnosticOutput = 0;
        renderer.setRenderTarget(this.traceRenderTarget);
        renderer.render(traceScene, traceCamera);

        outputMaterial.renderTexture = this.traceRenderTarget.texture;

        if (this.diagnosticMode !== 0) {
            pathTracingMaterial.diagnosticOutput = 1;
            renderer.setRenderTarget(this.diagnosticSummaryRenderTarget);
            renderer.render(traceScene, traceCamera);

            pathTracingMaterial.diagnosticOutput = 2;
            renderer.setRenderTarget(this.diagnosticMetricsRenderTarget);
            renderer.render(traceScene, traceCamera);

            pathTracingMaterial.diagnosticOutput = 0;
        }

        renderer.setRenderTarget(null);
        this.outputQuad.render(renderer);

        [this.traceRenderTarget, this.outRenderTarget] = [this.outRenderTarget, this.traceRenderTarget];

        this.samples++;
        yield;
    }

}

function createFallbackLayer(rgba) {
    return new Uint8Array(rgba);
}

function getTextureImageSize(texture) {
    const image = texture?.image;
    if (!image) {
        return null;
    }

    if (Number.isFinite(image.width) && Number.isFinite(image.height)) {
        return { width: image.width, height: image.height };
    }

    return null;
}

function extractTextureLayer(texture, width, height) {
    const image = texture?.image;
    if (!image) {
        return null;
    }

    try {
        const canvas = typeof OffscreenCanvas !== 'undefined'
            ? new OffscreenCanvas(width, height)
            : document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        context.clearRect(0, 0, width, height);
        context.drawImage(image, 0, 0, width, height);

        const { data } = context.getImageData(0, 0, width, height);
        return new Uint8Array(data.buffer.slice(0));
    } catch (error) {
        console.warn('[PathTracing] Failed to extract texture layer.', texture, error);
        return null;
    }
}

function buildTextureArray(textures, colorSpace, fallbackRgba) {
    const validTextures = (textures || []).filter(Boolean);
    const layers = validTextures.length;

    if (layers === 0) {
        const texture = new DataArrayTexture(createFallbackLayer(fallbackRgba), 1, 1, 1);
        texture.format = RGBAFormat;
        texture.type = UnsignedByteType;
        texture.minFilter = LinearFilter;
        texture.magFilter = LinearFilter;
        texture.wrapS = ClampToEdgeWrapping;
        texture.wrapT = ClampToEdgeWrapping;
        texture.generateMipmaps = false;
        texture.colorSpace = colorSpace;
        texture.needsUpdate = true;
        return texture;
    }

    let width = 1;
    let height = 1;
    validTextures.forEach((texture) => {
        const size = getTextureImageSize(texture);
        if (!size) {
            return;
        }
        width = Math.max(width, size.width);
        height = Math.max(height, size.height);
    });

    const layerSize = width * height * 4;
    const data = new Uint8Array(layerSize * layers);

    validTextures.forEach((texture, layerIndex) => {
        const layerData = extractTextureLayer(texture, width, height);
        if (!layerData) {
            return;
        }
        data.set(layerData, layerIndex * layerSize);
    });

    const texture = new DataArrayTexture(data, width, height, layers);
    texture.format = RGBAFormat;
    texture.type = UnsignedByteType;
    texture.minFilter = LinearMipmapLinearFilter;
    texture.magFilter = LinearFilter;
    texture.wrapS = RepeatWrapping;
    texture.wrapT = RepeatWrapping;
    texture.generateMipmaps = true;
    texture.colorSpace = colorSpace;
    texture.needsUpdate = true;
    return texture;
}

class PathTracer {

    constructor(renderer, scene, camera) {

        this.renderer = renderer;
        this.scene = scene;
        this.camera = camera;
        this.task = null;
        this.samples = 0;
        this.ready = false;
        this.disposed = false;
        this.cameraOrigin = new Vector3();
        this.drawingBufferSize = new Vector2();
        this.displayWidth = 0;
        this.displayHeight = 0;
        this.pixelRatio = 0;
        this.rasterFallbackRenderer = null;
        this.diagnosticMode = 0;
        this.init();
    }

    init() {

        this.outRenderTarget = new WebGLRenderTarget(1, 1, {
            format: RGBAFormat,
            type: FloatType,
            magFilter: NearestFilter,
            minFilter: NearestFilter
        });

        this.traceRenderTarget = new WebGLRenderTarget(1, 1, {
            format: RGBAFormat,
            type: FloatType,
            magFilter: NearestFilter,
            minFilter: NearestFilter
        });

        this.diagnosticSummaryRenderTarget = new WebGLRenderTarget(1, 1, {
            format: RGBAFormat,
            type: FloatType,
            magFilter: NearestFilter,
            minFilter: NearestFilter
        });

        this.diagnosticMetricsRenderTarget = new WebGLRenderTarget(1, 1, {
            format: RGBAFormat,
            type: FloatType,
            magFilter: NearestFilter,
            minFilter: NearestFilter
        });

        this.pathTracingQuad = new Mesh(
            new PlaneGeometry(2, 2),
            new PathTracingMaterial()
        );
        this.pathTracingQuad.frustumCulled = false;
        this.traceScene = new Scene();
        this.traceCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
        this.outputQuad = new FullScreenQuad(new OutputMaterial());

        this.traceScene.add(this.pathTracingQuad);

        this.pathTracingMaterial = this.pathTracingQuad.material;
        this.outputMaterial = this.outputQuad.material;
        this.outputMaterial.diagnosticSummaryTexture = this.diagnosticSummaryRenderTarget.texture;
        this.outputMaterial.diagnosticMetricsTexture = this.diagnosticMetricsRenderTarget.texture;

        this._setConstants();
        this._setRenderTexture();
        this._setSceneTextureArrays();
    }

    _setConstants() {
        this.pathTracingMaterial.texelsPerTriangle = texelsPerTriangle;
        this.pathTracingMaterial.texelsPerBVHNode = texelsPerBVHNode;
        this.pathTracingMaterial.texelsPerMaterial = texelsPerMaterial;
    }

    _setRenderTexture() {
        this.pathTracingMaterial.outTexture = this.outRenderTarget.texture;
        this.outputMaterial.renderTexture = this.traceRenderTarget.texture;
    }

    _setSceneTextureArrays() {
        this.sceneTextureArrays = {
            albedo: null,
            normal: null,
            metallicRoughness: null,
            emissive: null,
        };
    }

    _disposeSceneTextureArrays() {
        Object.values(this.sceneTextureArrays).forEach((texture) => {
            if (texture) {
                texture.dispose();
            }
        });

        this._setSceneTextureArrays();
        this.pathTracingMaterial.sceneAlbedoTextureArray = null;
        this.pathTracingMaterial.sceneNormalTextureArray = null;
        this.pathTracingMaterial.sceneMetallicRoughnessTextureArray = null;
        this.pathTracingMaterial.sceneEmissiveTextureArray = null;
    }

    _assignSceneTextureArray(key, textures, colorSpace, fallbackRgba) {
        const textureArray = buildTextureArray(textures, colorSpace, fallbackRgba);
        this.sceneTextureArrays[key] = textureArray;
        return textureArray;
    }

    _setSceneMaterialTextureArrays(textures) {
        this._disposeSceneTextureArrays();

        this.pathTracingMaterial.sceneAlbedoTextureArray = this._assignSceneTextureArray(
            'albedo',
            textures?.albedo,
            SRGBColorSpace,
            [255, 255, 255, 255]
        );
        this.pathTracingMaterial.sceneNormalTextureArray = this._assignSceneTextureArray(
            'normal',
            textures?.normal,
            NoColorSpace,
            [128, 128, 255, 255]
        );
        this.pathTracingMaterial.sceneMetallicRoughnessTextureArray = this._assignSceneTextureArray(
            'metallicRoughness',
            textures?.metallicRoughness,
            NoColorSpace,
            [255, 255, 255, 255]
        );
        this.pathTracingMaterial.sceneEmissiveTextureArray = this._assignSceneTextureArray(
            'emissive',
            textures?.emissive,
            SRGBColorSpace,
            [255, 255, 255, 255]
        );
    }

    _supportsTextureArrays() {
        return this.renderer.capabilities.isWebGL2;
    }

    setBounce(maxBounce) {
        const bounceCount = Math.max(1, Math.min(maxBounce, maxPathBounces));
        this.pathTracingMaterial.maxBounce = bounceCount;
        this.outputMaterial.diagnosticMaxBounce = bounceCount;
    }

    setTransparentSteps(stepCount) {
        this.pathTracingMaterial.maxTransparentSteps = Math.max(1, Math.min(stepCount, maxTransparentSteps));
    }

    setHdrTexture(texture) {
        texture.minFilter = LinearFilter;
        texture.magFilter = LinearFilter;
        texture.generateMipmaps = false;
        this.pathTracingMaterial.hdrTexture = texture;
    }

    setDebugMode(mode) {
        this.pathTracingMaterial.debugMode = mode;
    }

    setDiagnosticMode(mode) {
        this.diagnosticMode = mode;
        this.outputMaterial.diagnosticMode = mode;
    }

    setDiagnosticExtremeThreshold(threshold) {
        this.pathTracingMaterial.diagnosticExtremeThreshold = threshold;
    }

    readDiagnosticPixel(x, y) {
        const width = this.diagnosticSummaryRenderTarget.width;
        const height = this.diagnosticSummaryRenderTarget.height;
        const pixelX = Math.max(0, Math.min(Math.floor(x), width - 1));
        const pixelY = Math.max(0, Math.min(Math.floor(y), height - 1));
        const summary = new Float32Array(4);
        const metrics = new Float32Array(4);

        this.renderer.readRenderTargetPixels(
            this.diagnosticSummaryRenderTarget,
            pixelX,
            pixelY,
            1,
            1,
            summary
        );
        this.renderer.readRenderTargetPixels(
            this.diagnosticMetricsRenderTarget,
            pixelX,
            pixelY,
            1,
            1,
            metrics
        );

        return {
            pixel: { x: pixelX, y: pixelY },
            pathLength: Math.round(summary[0]),
            terminationReason: Math.round(summary[1]),
            bsdfEventFlags: Math.round(summary[2]),
            firstFailureBounce: Math.round(summary[3]),
            samplePdf: metrics[0],
            maxThroughput: metrics[1],
            maxContribution: metrics[2],
            failureFlags: Math.round(metrics[3]),
        };
    }

    setMaterialPreset(preset) {
        this.pathTracingMaterial.materialPreset = preset;
    }

    setOutputToneMapping(mode) {
        this.outputMaterial.toneMappingMode = mode;
    }

    setOutputExposure(exposure) {
        this.outputMaterial.exposure = exposure;
    }

    setScene(compiledScene) {
        if (!compiledScene || compiledScene.disposed) {
            throw new Error('[PathTracing] setScene requires a live CompiledScene.');
        }

        this.setDataTexture(
            compiledScene.triangle,
            compiledScene.bvh,
            compiledScene.material
        );
    }

    setDataTexture(triangle, bvh, material) {
        const pathTracingMaterial = this.pathTracingMaterial;
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

        pathTracingMaterial.materialDataTexture = material.dataTexture;
        pathTracingMaterial.materialDataTextureSize = {
            x: material.textureWidth,
            y: material.textureHeight
        };

        if (!this._supportsTextureArrays()) {
            console.warn('[PathTracing] Texture arrays require WebGL2. Scene materials will fall back to factors only.');
            this._disposeSceneTextureArrays();
            this.ready = true;
            return;
        }

        this._setSceneMaterialTextureArrays(material.textures);
        this.ready = true;
    }

    setSize(width, height, pixelRatio = this.renderer.getPixelRatio()) {
        const displayWidth = Math.max(1, Math.floor(width));
        const displayHeight = Math.max(1, Math.floor(height));

        if (
            this.displayWidth === displayWidth
            && this.displayHeight === displayHeight
            && this.pixelRatio === pixelRatio
        ) {
            return;
        }

        this.displayWidth = displayWidth;
        this.displayHeight = displayHeight;
        this.pixelRatio = pixelRatio;
        this.renderer.setPixelRatio(pixelRatio);
        this.renderer.setSize(displayWidth, displayHeight);
        this.renderer.getDrawingBufferSize(this.drawingBufferSize);

        const renderWidth = Math.floor(this.drawingBufferSize.x);
        const renderHeight = Math.floor(this.drawingBufferSize.y);
        this.traceRenderTarget.setSize(renderWidth, renderHeight);
        this.outRenderTarget.setSize(renderWidth, renderHeight);
        this.diagnosticSummaryRenderTarget.setSize(renderWidth, renderHeight);
        this.diagnosticMetricsRenderTarget.setSize(renderWidth, renderHeight);

        this.pathTracingMaterial.resolution = { x: renderWidth, y: renderHeight };
        this.outputMaterial.diagnosticMaxBounce = this.pathTracingMaterial.maxBounce;
    }

    update() {
        if (this.disposed) {
            return;
        }

        if (!this.task) {

            this.task = renderTask.call(this);

        }

        this.task.next();
    }

    setRasterFallbackRenderer(callback) {
        this.rasterFallbackRenderer = callback ?? null;
    }

    renderRasterFallback() {
        if (!this.rasterFallbackRenderer) {
            return false;
        }

        this.rasterFallbackRenderer({
            renderer: this.renderer,
            scene: this.scene,
            camera: this.camera,
            pathTracer: this,
        });
        return true;
    }

    setReady(ready) {
        this.ready = ready;
    }

    isReady() {
        return this.ready;
    }

    reset() {
        const currentRenderTarget = this.renderer.getRenderTarget();
        const clearColor = this.renderer.getClearColor(new Color());
        const clearAlpha = this.renderer.getClearAlpha();

        this.samples = 0;

        this.renderer.setClearColor(0x000000, 0);

        this.renderer.setRenderTarget(this.traceRenderTarget);
        this.renderer.clear();

        this.renderer.setRenderTarget(this.outRenderTarget);
        this.renderer.clear();

        this.renderer.setRenderTarget(this.diagnosticSummaryRenderTarget);
        this.renderer.clear();

        this.renderer.setRenderTarget(this.diagnosticMetricsRenderTarget);
        this.renderer.clear();

        this.renderer.setClearColor(clearColor, clearAlpha);
        this.renderer.setRenderTarget(currentRenderTarget);
    }

    dispose() {
        if (this.disposed) {
            return;
        }

        this.disposed = true;
        this.task = null;
        this.ready = false;
        this.rasterFallbackRenderer = null;

        this._disposeSceneTextureArrays();
        this.traceScene.remove(this.pathTracingQuad);
        this.pathTracingQuad.geometry.dispose();
        this.pathTracingMaterial.dispose();
        this.outputMaterial.dispose();
        this.outputQuad.dispose();
        this.traceRenderTarget.dispose();
        this.outRenderTarget.dispose();
        this.diagnosticSummaryRenderTarget.dispose();
        this.diagnosticMetricsRenderTarget.dispose();
    }

}

export { PathTracer };
