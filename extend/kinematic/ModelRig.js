import { Group } from 'three';
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js';
import { alignBaseMatrix } from './ChainGenerator.js';

const sharedColladaLoader = new ColladaLoader();

function applyTransform(object, {
    position = [0, 0, 0],
    rpy = [0, 0, 0],
    scale = 1,
    rotationOrder = 'ZYX',
} = {}) {
    object.position.fromArray(position);
    object.rotation.set(...rpy, rotationOrder);
    if (Array.isArray(scale)) {
        object.scale.fromArray(scale);
    } else {
        object.scale.setScalar(scale);
    }
}

class ModelRig {
    constructor({
        parent = null,
        name = 'modelRig',
        assetUrl = '',
        rootTransform = {},
        materialResolver = null,
        jointValueMapper = null,
        loader = sharedColladaLoader,
    } = {}) {
        this.assetUrl = assetUrl;
        this.materialResolver = materialResolver;
        this.jointValueMapper = jointValueMapper ?? null;
        this.loader = loader;
        this.nodes = new Map();
        this.joints = new Map();
        this.visualSpecs = [];
        this.loadPromise = null;
        this.ready = false;

        this.root = new Group();
        this.root.name = name;
        applyTransform(this.root, rootTransform);
        this.nodes.set('root', this.root);
        parent?.add(this.root);
    }

    resolveNode(nodeOrKey = 'root') {
        if (typeof nodeOrKey === 'string') {
            const node = this.nodes.get(nodeOrKey);
            if (!node) {
                throw new Error(`ModelRig node "${nodeOrKey}" does not exist.`);
            }
            return node;
        }
        if (!nodeOrKey?.isObject3D) {
            throw new Error('ModelRig parent must be a registered key or Object3D.');
        }
        return nodeOrKey;
    }

    addFrame(key, {
        parent = 'root',
        name = key,
        position = [0, 0, 0],
        rpy = [0, 0, 0],
        scale = 1,
        rotationOrder = 'ZYX',
    } = {}) {
        const frame = new Group();
        frame.name = name;
        applyTransform(frame, { position, rpy, scale, rotationOrder });
        this.resolveNode(parent).add(frame);
        this.nodes.set(key, frame);
        return frame;
    }

    addJoint(key, {
        parent = 'root',
        name = key,
        position = [0, 0, 0],
        rpy = [0, 0, 0],
        axis = 'z',
        rotationOrder = 'ZYX',
    } = {}) {
        const fixedFrame = this.addFrame(`${key}:fixed`, {
            parent,
            name: `${name} fixed transform`,
            position,
            rpy,
            rotationOrder,
        });
        const joint = new Group();
        joint.name = name;
        fixedFrame.add(joint);
        this.nodes.set(key, joint);
        this.joints.set(key, { node: joint, axis });
        return joint;
    }

    addVisual({
        parent = 'root',
        file,
        name = `${file} visual offset`,
        position = [0, 0, 0],
        rpy = [0, 0, 0],
        scale = 1,
        rotationOrder = 'ZYX',
        resetColladaRotation = true,
        materialResolver = this.materialResolver,
    }) {
        if (!file) {
            throw new Error('ModelRig visual requires a file.');
        }
        this.visualSpecs.push({
            parent,
            file,
            name,
            position,
            rpy,
            scale,
            rotationOrder,
            resetColladaRotation,
            materialResolver,
        });
        return this;
    }

    async loadVisual(spec) {
        const holder = new Group();
        holder.name = spec.name;
        applyTransform(holder, spec);
        this.resolveNode(spec.parent).add(holder);

        const collada = await this.loader.loadAsync(this.assetUrl + spec.file);
        const visual = collada.scene;
        if (spec.resetColladaRotation) {
            // Keep mesh coordinates in their URDF frame; the rig root performs the ROS-to-scene conversion.
            visual.rotation.set(0, 0, 0);
        }

        const auxiliaryNodes = [];
        visual.traverse((object) => {
            if (object.isCamera || object.isLight) {
                auxiliaryNodes.push(object);
                return;
            }
            if (!object.isMesh) {
                return;
            }
            if (spec.materialResolver) {
                const material = spec.materialResolver(object.material, object, spec);
                if (material) {
                    object.material = material;
                }
            }
            object.castShadow = true;
            object.receiveShadow = true;
        });
        auxiliaryNodes.forEach((object) => object.removeFromParent());
        holder.add(visual);
        return visual;
    }

    load() {
        if (this.ready) {
            return Promise.resolve(this.root);
        }
        if (this.loadPromise) {
            return this.loadPromise;
        }

        this.loadPromise = Promise.all(this.visualSpecs.map((spec) => this.loadVisual(spec)))
            .then(() => {
                this.ready = true;
                return this.root;
            })
            .catch((error) => {
                this.loadPromise = null;
                throw error;
            });
        return this.loadPromise;
    }

    setJointValue(key, value) {
        const joint = this.joints.get(key);
        if (!joint) {
            return;
        }
        joint.node.rotation[joint.axis] = value;
    }

    setJointValues(values = {}) {
        const mappedValues = this.jointValueMapper
            ? this.jointValueMapper(values)
            : values;
        if (Array.isArray(mappedValues)) {
            let index = 0;
            for (const key of this.joints.keys()) {
                this.setJointValue(key, mappedValues[index]);
                index++;
            }
            return;
        }
        for (const [key, value] of Object.entries(mappedValues)) {
            this.setJointValue(key, value);
        }
    }

    syncBase({ syncUp = true, offset = {} } = {}) {
        if (syncUp) {
            alignBaseMatrix(this.root, offset);
            this.root.matrixWorldNeedsUpdate = true;
            return;
        }

        this.root.matrixAutoUpdate = false;
        this.root.matrix.identity();
        this.root.matrix.setPosition(
            offset.x ?? 0,
            offset.y ?? 0,
            offset.z ?? 0,
        );
        this.root.matrixWorldNeedsUpdate = true;
    }

    setVisible(visible) {
        this.root.visible = visible;
    }

    removeFromParent() {
        this.root.removeFromParent();
    }
}

export {
    ModelRig,
    ModelRig as default,
};
