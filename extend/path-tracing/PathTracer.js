import * as THREE from 'three';
import { CopyMaterial } from './materials/CopyMaterial'
import { OutputMaterial } from './materials/OutputMaterial'
import { PathTracingMaterial } from './materials/PathTracingMaterial'

import {
    texelsPerTriangle,
    texelsPerBVHNode,
} from './Constants'


function* renderTask() {

    const {
        renderer,
        scene,
        camera,
        quadCamera,
        pathTracingRenderTarget,
        copyRenderTarget,
        copyScene,
        outputScene
    } = this;

    const pathTracingMaterial = this.pathTracingQuad.material;


    while (true) {
        this.samples++;
        camera.updateMatrixWorld();
        camera.updateProjectionMatrix();

        // uniforms undate
        pathTracingMaterial.samples = this.samples;
        pathTracingMaterial.matrixWorld = camera.matrixWorld;
        pathTracingMaterial.projectionMatrixInverse = camera.projectionMatrixInverse;

        renderer.setRenderTarget(pathTracingRenderTarget);
        renderer.render(scene, camera);
        // pathTracingQuad.render(renderer);

        renderer.setRenderTarget(copyRenderTarget);
        renderer.render(copyScene, quadCamera);
        // copyQuad.render(renderer);

        renderer.setRenderTarget(null);
        renderer.render(outputScene, quadCamera);
        // outputQuad.render(renderer);

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

        this.copyRenderTarget = new THREE.WebGLRenderTarget(1, 1, {
            format: THREE.RGBAFormat,
            type: THREE.FloatType,
            magFilter: THREE.NearestFilter,
            minFilter: THREE.NearestFilter
        });

        this.pathTracingRenderTarget = new THREE.WebGLRenderTarget(1, 1, {
            format: THREE.RGBAFormat,
            type: THREE.FloatType,
            magFilter: THREE.NearestFilter,
            minFilter: THREE.NearestFilter
        });

        // this.pathTracingQuad = new FullScreenQuad(new PathTracingMaterial());
        // this.copyQuad = new FullScreenQuad(new CopyMaterial());
        // this.outputQuad = new FullScreenQuad(new OutputMaterial());

        this.quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        this.pathTracingQuad = new THREE.Mesh(
            new THREE.PlaneGeometry(2, 2),
            new PathTracingMaterial()
        );
        this.copyQuad = new THREE.Mesh(
            new THREE.PlaneGeometry(2, 2),
            new CopyMaterial()
        );
        this.outputQuad = new THREE.Mesh(
            new THREE.PlaneGeometry(2, 2),
            new OutputMaterial()
        );

        this.scene.add(this.pathTracingQuad);
        this.copyScene = new THREE.Scene().add(this.copyQuad);
        this.outputScene = new THREE.Scene().add(this.outputQuad);

        this.pathTracingMaterial = this.pathTracingQuad.material;
        this.copyMaterial = this.copyQuad.material;
        this.outputMaterial = this.outputQuad.material;

        this._setContants();
        this._setRenderTexture();
    }

    // set constants used inside shader
    _setContants() {
        this.pathTracingMaterial.texelsPerTriangle = texelsPerTriangle;
        this.pathTracingMaterial.texelsPerBVHNode = texelsPerBVHNode;
    }

    // set full screen textures during rendering
    _setRenderTexture() {
        this.pathTracingMaterial.copyTexture = this.copyRenderTarget.texture;
        this.copyMaterial.renderTexture = this.pathTracingRenderTarget.texture;
        this.outputMaterial.renderTexture = this.copyRenderTarget.texture;
    }

    // set bounces
    setBounce(maxBounce) {
        this.pathTracingMaterial.maxBounce = maxBounce;
    }

    // set hdr texture
    setHdrTexture(texture) {
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.generateMipmaps = false;
        this.pathTracingMaterial.hdrTexture = texture;
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

        if (this.pathTracingRenderTarget.width == width && this.pathTracingRenderTarget.height == height) {
            return;
        }

        this.renderer.setSize(width, height);
        this.pathTracingRenderTarget.setSize(width, height);
        this.copyRenderTarget.setSize(width, height);

        this.pathTracingMaterial.resolution = { x: width, y: height };
        this.copyMaterial.resolution = { x: width, y: height };
        this.outputMaterial.resolution = { x: width, y: height };
    }

    update() {

        if (!this.task) {

            this.task = renderTask.call(this);

        }

        this.task.next();
    }

    reset() {
        this.samples = 1;
    }

}