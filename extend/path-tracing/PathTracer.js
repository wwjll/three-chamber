import { ClampToEdgeWrapping, Color, DataArrayTexture, DataTexture, FloatType, LinearFilter, Mesh, NearestFilter, NoColorSpace, PlaneGeometry, RGBAFormat, RepeatWrapping, SRGBColorSpace, UnsignedByteType, Vector2, WebGLRenderTarget } from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { OutputMaterial } from './materials/OutputMaterial'
import { PathTracingMaterial } from './materials/PathTracingMaterial'

import {
    texelsPerTriangle,
    texelsPerBVHNode,
    texelsPerMaterial,
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

function buildHdrImportanceDistribution(texture) {
    const image = texture.image;
    const width = image?.width || 0;
    const height = image?.height || 0;
    const data = image?.data;

    if (!width || !height || !data) {
        return null;
    }

    const conditionalData = new Float32Array(width * height * 4);
    const marginalData = new Float32Array(height * 4);
    const rowWeights = new Float32Array(height);
    let totalWeight = 0;

    for (let y = 0; y < height; y++) {
        const theta = ((y + 0.5) / height) * Math.PI;
        const sinTheta = Math.max(Math.sin(theta), 1e-6);
        let rowSum = 0;

        for (let x = 0; x < width; x++) {
            const texelIndex = (y * width + x) * 4;
            const r = Math.min(data[texelIndex], 10);
            const g = Math.min(data[texelIndex + 1], 10);
            const b = Math.min(data[texelIndex + 2], 10);
            const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
            rowSum += luminance * sinTheta;
            conditionalData[(y * width + x) * 4] = rowSum;
        }

        rowWeights[y] = rowSum;
        totalWeight += rowSum;

        if (rowSum > 0) {
            for (let x = 0; x < width; x++) {
                conditionalData[(y * width + x) * 4] /= rowSum;
            }
        } else {
            for (let x = 0; x < width; x++) {
                conditionalData[(y * width + x) * 4] = (x + 1) / width;
            }
        }
    }

    let marginalCdf = 0;
    for (let y = 0; y < height; y++) {
        marginalCdf += rowWeights[y];
        marginalData[y * 4] = totalWeight > 0 ? marginalCdf / totalWeight : (y + 1) / height;
    }

    const conditionalTexture = new DataTexture(
        conditionalData,
        width,
        height,
        RGBAFormat,
        FloatType
    );
    conditionalTexture.colorSpace = NoColorSpace;
    conditionalTexture.minFilter = NearestFilter;
    conditionalTexture.magFilter = NearestFilter;
    conditionalTexture.wrapS = ClampToEdgeWrapping;
    conditionalTexture.wrapT = ClampToEdgeWrapping;
    conditionalTexture.generateMipmaps = false;
    conditionalTexture.needsUpdate = true;

    const marginalTexture = new DataTexture(
        marginalData,
        height,
        1,
        RGBAFormat,
        FloatType
    );
    marginalTexture.colorSpace = NoColorSpace;
    marginalTexture.minFilter = NearestFilter;
    marginalTexture.magFilter = NearestFilter;
    marginalTexture.wrapS = ClampToEdgeWrapping;
    marginalTexture.wrapT = ClampToEdgeWrapping;
    marginalTexture.generateMipmaps = false;
    marginalTexture.needsUpdate = true;

    return {
        conditionalTexture,
        marginalTexture,
        width,
        height,
        totalWeight,
    };
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
    texture.minFilter = LinearFilter;
    texture.magFilter = LinearFilter;
    texture.wrapS = RepeatWrapping;
    texture.wrapT = RepeatWrapping;
    texture.generateMipmaps = false;
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

        this.pathTracingQuad = new Mesh(
            new PlaneGeometry(2, 2),
            new PathTracingMaterial()
        );
        this.pathTracingQuad.frustumCulled = false;
        this.outputQuad = new FullScreenQuad(new OutputMaterial());

        this.scene.add(this.pathTracingQuad);

        this.pathTracingMaterial = this.pathTracingQuad.material;
        this.outputMaterial = this.outputQuad.material;

        this._setContants();
        this._setRenderTexture();
        this._setSceneTextureArrays();
        this.setOriginMaterialInfo(null);
    }

    // set constants used inside shader
    _setContants() {
        this.pathTracingMaterial.texelsPerTriangle = texelsPerTriangle;
        this.pathTracingMaterial.texelsPerBVHNode = texelsPerBVHNode;
        this.pathTracingMaterial.texelsPerMaterial = texelsPerMaterial;
    }

    // set full screen textures during rendering
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
        return this.renderer.capabilities.isWebGL2 === true;
    }

    // set bounces
    setBounce(maxBounce) {
        this.pathTracingMaterial.maxBounce = Math.max(1, Math.min(maxBounce, 8));
    }

    setTransparentSteps(maxTransparentSteps) {
        this.pathTracingMaterial.maxTransparentSteps = Math.max(1, Math.min(maxTransparentSteps, 8));
    }

    setEnvironmentMissMIS(enabled) {
        const material = this.pathTracingMaterial;
        const shouldEnable = enabled === true;
        const isEnabled = material.defines?.ENABLE_ENV_MISS_MIS === 1;
        if (shouldEnable === isEnabled) {
            return;
        }

        if (shouldEnable) {
            material.defines = {
                ...material.defines,
                ENABLE_ENV_MISS_MIS: 1,
            };
        } else if (material.defines) {
            delete material.defines.ENABLE_ENV_MISS_MIS;
        }

        material.needsUpdate = true;
    }

    setDirectEnvironmentMIS(enabled) {
        const material = this.pathTracingMaterial;
        const shouldEnable = enabled === true;
        const isEnabled = material.defines?.ENABLE_DIRECT_ENV_MIS === 1;
        if (shouldEnable === isEnabled) {
            return;
        }

        if (shouldEnable) {
            material.defines = {
                ...material.defines,
                ENABLE_DIRECT_ENV_MIS: 1,
            };
        } else if (material.defines) {
            delete material.defines.ENABLE_DIRECT_ENV_MIS;
        }

        material.needsUpdate = true;
    }

    // set hdr texture
    setHdrTexture(texture) {
        texture.minFilter = LinearFilter;
        texture.magFilter = LinearFilter;
        texture.generateMipmaps = false;
        this.pathTracingMaterial.hdrTexture = texture;

        if (this.hdrConditionalDistributionTexture) {
            this.hdrConditionalDistributionTexture.dispose();
            this.hdrConditionalDistributionTexture = null;
        }
        if (this.hdrMarginalDistributionTexture) {
            this.hdrMarginalDistributionTexture.dispose();
            this.hdrMarginalDistributionTexture = null;
        }

        const hdrDistribution = buildHdrImportanceDistribution(texture);
        if (!hdrDistribution) {
            this.pathTracingMaterial.hdrConditionalDistributionTexture = null;
            this.pathTracingMaterial.hdrMarginalDistributionTexture = null;
            this.pathTracingMaterial.hdrResolution = new Vector2(1, 1);
            this.pathTracingMaterial.hdrTotalWeight = 0;
            return;
        }

        this.hdrConditionalDistributionTexture = hdrDistribution.conditionalTexture;
        this.hdrMarginalDistributionTexture = hdrDistribution.marginalTexture;
        this.pathTracingMaterial.hdrConditionalDistributionTexture = this.hdrConditionalDistributionTexture;
        this.pathTracingMaterial.hdrMarginalDistributionTexture = this.hdrMarginalDistributionTexture;
        this.pathTracingMaterial.hdrResolution = new Vector2(hdrDistribution.width, hdrDistribution.height);
        this.pathTracingMaterial.hdrTotalWeight = hdrDistribution.totalWeight;
    }

    setOriginMaterialInfo(materialInfo) {
        return materialInfo;
    }

    setDebugMode(mode) {
        this.pathTracingMaterial.debugMode = mode;
    }

    setMaterialPreset(preset) {
        this.pathTracingMaterial.materialPreset = preset;
    }

    // set Data texture
    setDataTexture(triangle, bvh, material) {
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

        pathTracingMaterial.materialDataTexture = material.dataTexture;
        pathTracingMaterial.materialDataTextureSize = {
            x: material.textureWidth,
            y: material.textureHeight
        };

        if (!this._supportsTextureArrays()) {
            console.warn('[PathTracing] Texture arrays require WebGL2. Scene materials will fall back to factors only.');
            this._disposeSceneTextureArrays();
            return;
        }

        this._setSceneMaterialTextureArrays(material.textures);
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
        const clearColor = this.renderer.getClearColor(new Color());
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

export { PathTracer };
