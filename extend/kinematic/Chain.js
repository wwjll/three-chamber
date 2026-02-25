import * as THREE from 'three';
import { Joint } from './Joint.js';
import { Link } from './Link.js';
import { AlignBaseMatrix, ConvertMDH } from './Utils.js';

const _tmpParentQuat = new THREE.Quaternion();
const _tmpWorldQuat = new THREE.Quaternion();

function createSoftRandomColor() {
    const color = new THREE.Color();
    const hue = Math.random();
    const saturation = 0.65 + Math.random() * 0.25;
    const lightness = 0.45 + Math.random() * 0.2;
    color.setHSL(hue, saturation, lightness);
    return color;
}

function getDhEndWorld(parentJoint) {
    const dh = parentJoint.dh || {};
    const d = Number.isFinite(dh.d) ? dh.d : 0;
    const a = Number.isFinite(dh.a) ? dh.a : 0;
    const alpha = Number.isFinite(dh.alpha) ? dh.alpha : 0;
    const tz = new THREE.Matrix4().makeTranslation(0, 0, d);
    const rx = new THREE.Matrix4().makeRotationX(alpha);
    const tx = new THREE.Matrix4().makeTranslation(a, 0, 0);
    return new THREE.Vector3(0, 0, 0)
        .applyMatrix4(parentJoint.matrixWorld.clone().multiply(tz).multiply(rx).multiply(tx));
}

function buildLinkCurve(parentJoint, childJoint) {
    const posA = new THREE.Vector3();
    const posB = new THREE.Vector3();
    parentJoint.getWorldPosition(posA);
    if (childJoint) {
        childJoint.getWorldPosition(posB);
    } else {
        posB.copy(posA);
    }

    const dh = parentJoint.dh || {};
    const d = Number.isFinite(dh.d) ? dh.d : 0;
    const a = Number.isFinite(dh.a) ? dh.a : 0;
    const alpha = Number.isFinite(dh.alpha) ? dh.alpha : 0;

    const tz = new THREE.Matrix4().makeTranslation(0, 0, d);
    const rx = new THREE.Matrix4().makeRotationX(alpha);
    const tx = new THREE.Matrix4().makeTranslation(a, 0, 0);

    const midWorld = new THREE.Vector3(0, 0, 0)
        .applyMatrix4(parentJoint.matrixWorld.clone().multiply(tz));
    const endWorld = new THREE.Vector3(0, 0, 0)
        .applyMatrix4(parentJoint.matrixWorld.clone().multiply(tz).multiply(rx).multiply(tx));

    const endPoint = childJoint && endWorld.distanceTo(posB) > 1e-6 ? posB : endWorld;

    const p0 = posA;
    const p1 = midWorld;
    const p2 = endPoint;
    return new THREE.QuadraticBezierCurve3(p0, p1, p2);
}

export function createChainFromDHParameters(dhParameters, mode = 'DH') {
    const chain = [];
    let lastNode = null;

    if (mode === 'MDH') {
        const baseLink = new Link();
        baseLink.isBase = true;
        baseLink.applyMDH(0, 0);
        lastNode = baseLink;
        chain.push(baseLink);

        for (let i = 0; i < dhParameters.length; i++) {
            const [theta, d, a, alpha, thetaOffset = 0, minAngle, maxAngle] = dhParameters[i];
            const thetaConst = theta + thetaOffset;

            let linkNode = baseLink;
            if (i > 0) {
                linkNode = new Link();
                linkNode.applyMDH(a, alpha);
                lastNode.setChild(linkNode);
                lastNode = linkNode;
                chain.push(linkNode);
            } else {
                baseLink.applyMDH(a, alpha);
            }

            const joint = new Joint({ minAngle, maxAngle });
            if (i === 0) joint.isRoot = true;
            joint.applyJointMDH(thetaConst, d);
            joint.dh = { theta: thetaConst, d, a, alpha, thetaOffset };

            lastNode.setChild(joint);
            lastNode = joint;
            chain.push(joint);
        }

        return chain;
    }
    for (let i = 0; i < dhParameters.length; i++) {
        const [theta, d, a, alpha, thetaOffset = 0, minAngle, maxAngle] = dhParameters[i];
        const thetaValue = theta + thetaOffset;

        const joint = new Joint({ minAngle, maxAngle });
        if (i === 0) joint.isRoot = true;

        joint.applyJointDH(thetaValue, d, a, alpha);

        if (lastNode) lastNode.setChild(joint);
        lastNode = joint;

        const link = new Link();
        link.applyDH(d, a, alpha);
        link.d = d;
        link.a = a;
        joint.setChild(link);
        lastNode = link;

        chain.push(joint);
        chain.push(link);
    }

    return chain;
}

export class Chain {
    constructor(scene) {
        this.scene = scene;
        this.robotContainer = null;
        this.roboticArm = null;
        this.joints = [];
        this.randomJointColors = [];
        this.randomJointColorEnabled = false;
    }

    generate(dhParameters, styleParams, baseParams = {}) {
        if (this.robotContainer) {
            this.robotContainer.traverse(child => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) child.material.dispose();
            });
            this.scene.remove(this.robotContainer);
        }

        const mode = baseParams.mdhMode ? 'MDH' : 'DH';
        const baseOffset = baseParams.baseOffset || {};
        const useConvertedParams = baseParams.useConvertedParams === true;
        const chainParams = mode === 'MDH' && !useConvertedParams
            ? ConvertMDH(dhParameters)
            : dhParameters;

        if (styleParams.randomJointColor) {
            if (!this.randomJointColorEnabled) {
                this.randomJointColors = Array.from({ length: dhParameters.length }, () => createSoftRandomColor());
                this.randomJointColorEnabled = true;
            } else if (this.randomJointColors.length !== dhParameters.length) {
                if (this.randomJointColors.length > dhParameters.length) {
                    this.randomJointColors.length = dhParameters.length;
                } else {
                    const missing = dhParameters.length - this.randomJointColors.length;
                    for (let i = 0; i < missing; i++) {
                        this.randomJointColors.push(createSoftRandomColor());
                    }
                }
            }
        } else {
            this.randomJointColorEnabled = false;
        }

        this.robotContainer = new THREE.Group();
        this.scene.add(this.robotContainer);

        this.roboticArm = new THREE.Group();
        this.robotContainer.add(this.roboticArm);

        if (dhParameters.length === 0) {
            this.syncAxis(styleParams, baseOffset);
            return;
        }

        const chain = createChainFromDHParameters(chainParams, mode);
        const root = chain[0];
        this.roboticArm.add(root);
        root.updateMatrixWorld(true);

        if (mode === 'MDH' && styleParams.showAxisHelper) {
            const axisSize = Number.isFinite(styleParams.axisHelperSize)
                ? styleParams.axisHelperSize
                : 0.1;
            const baseAxis = new THREE.AxesHelper(axisSize);
            baseAxis.matrixAutoUpdate = false;
            this.robotContainer.add(baseAxis);
        }

        if (mode === 'MDH') {
            const joints = chain.filter(node => node.isJoint);
            for (let i = 1; i < joints.length; i++) {
                const prev = joints[i - 1];
                const cur = joints[i];
                const linkNode = cur.parent && cur.parent.isLink ? cur.parent : null;
                if (!linkNode) continue;

                const posA = new THREE.Vector3();
                const posB = new THREE.Vector3();
                const posC = new THREE.Vector3();
                prev.getWorldPosition(posA);
                linkNode.getWorldPosition(posB);
                cur.getWorldPosition(posC);

                if (posA.distanceTo(posC) <= 0) continue;
                const curve = new THREE.QuadraticBezierCurve3(posA, posB, posC);
                const tubeGeo = new THREE.TubeGeometry(curve, 50, styleParams.linkRadius, 8, false);
                const linkColor = styleParams.randomLinkColor ? createSoftRandomColor() : styleParams.linkColor;
                const tubeMat = new THREE.MeshBasicMaterial({ color: linkColor });
                const tube = new THREE.Mesh(tubeGeo, tubeMat);
                this.roboticArm.add(tube);
            }
        }

        this.joints = [];
        let jointIndex = 0;
        root.traverse((node) => {
            if (mode === 'MDH' && node.isLink) {
                return;
            }
            if (node.isLink) {
                // Make sure frame helper shows on the end of the link in CDH mode(classic)
                if (node.parent && node.children.length > 0 && node.children[0].isJoint) {
                    const child = node.children[0];
                    const posA = new THREE.Vector3();
                    node.parent.getWorldPosition(posA);
                    const posB = new THREE.Vector3();
                    child.getWorldPosition(posB);
                    if (posA.distanceTo(posB) > 0) {
                        const path = buildLinkCurve(node.parent, child);
                        const tubeGeo = new THREE.TubeGeometry(path, 50, styleParams.linkRadius, 8, false);
                        const linkColor = styleParams.randomLinkColor ? createSoftRandomColor() : styleParams.linkColor;
                        const tubeMat = new THREE.MeshBasicMaterial({ color: linkColor });
                        const tube = new THREE.Mesh(tubeGeo, tubeMat);
                        this.roboticArm.add(tube);
                    }

                    if (styleParams.showAxisHelper) {
                        const axisSize = Number.isFinite(styleParams.axisHelperSize)
                            ? styleParams.axisHelperSize
                            : 0.1;
                        const linkAxis = new THREE.AxesHelper(axisSize);
                        linkAxis.matrixAutoUpdate = false;
                        child.updateWorldMatrix(true, false);
                        linkAxis.applyMatrix4(child.matrixWorld);
                        this.roboticArm.add(linkAxis);
                    }
                } else if (node.parent && node.parent.isJoint) {
                    const posA = new THREE.Vector3();
                    node.parent.getWorldPosition(posA);
                    const endWorld = getDhEndWorld(node.parent);
                    if (posA.distanceTo(endWorld) > 0) {
                        const path = buildLinkCurve(node.parent, null);
                        const tubeGeo = new THREE.TubeGeometry(path, 24, styleParams.linkRadius, 8, false);
                        const linkColor = styleParams.randomLinkColor ? createSoftRandomColor() : styleParams.linkColor;
                        const tubeMat = new THREE.MeshBasicMaterial({ color: linkColor });
                        const tube = new THREE.Mesh(tubeGeo, tubeMat);
                        this.roboticArm.add(tube);
                    }

                    if (styleParams.showAxisHelper) {
                        const axisSize = Number.isFinite(styleParams.axisHelperSize)
                            ? styleParams.axisHelperSize
                            : 0.1;
                        const linkAxis = new THREE.AxesHelper(axisSize);
                        linkAxis.matrixAutoUpdate = false;
                        const dh = node.parent.dh || {};
                        const d = Number.isFinite(dh.d) ? dh.d : 0;
                        const a = Number.isFinite(dh.a) ? dh.a : 0;
                        const alpha = Number.isFinite(dh.alpha) ? dh.alpha : 0;
                        const tz = new THREE.Matrix4().makeTranslation(0, 0, d);
                        const rx = new THREE.Matrix4().makeRotationX(alpha);
                        const tx = new THREE.Matrix4().makeTranslation(a, 0, 0);
                        linkAxis.matrix.copy(node.parent.matrixWorld.clone().multiply(tz).multiply(rx).multiply(tx));
                        this.roboticArm.add(linkAxis);
                    }
                }
            } else if (node.isJoint) {
                this.joints.push(node);
                if (typeof styleParams.showAxisHelper === 'boolean') {
                    const axisOptions = {};
                    if (styleParams.axisHelperSize !== undefined) {
                        axisOptions.size = styleParams.axisHelperSize;
                    }
                    node.toggleAxisHelper(styleParams.showAxisHelper, axisOptions);
                }

                let jointColor = styleParams.jointColor;
                if (styleParams.randomJointColor) {
                    jointColor = this.randomJointColors[jointIndex];
                    if (!jointColor) {
                        jointColor = createSoftRandomColor();
                        this.randomJointColors[jointIndex] = jointColor;
                    }
                }
                jointIndex += 1;

                if (typeof styleParams.showDOFHelper === 'boolean') {
                    const dofOptions = {};
                    if (styleParams.dofUseJointColor) {
                        dofOptions.color = jointColor;
                    } else if (styleParams.dofColor !== undefined) {
                        dofOptions.color = styleParams.dofColor;
                    }
                    if (styleParams.dofOpacity !== undefined) dofOptions.opacity = styleParams.dofOpacity;
                    if (styleParams.dofUseAutoRadius !== undefined || styleParams.dofRadius !== undefined) {
                        dofOptions.radius = styleParams.dofUseAutoRadius ? null : styleParams.dofRadius;
                    }
                    if (styleParams.dofRadiusScale !== undefined) dofOptions.radiusScale = styleParams.dofRadiusScale;
                    if (styleParams.dofThicknessRatio !== undefined) dofOptions.thicknessRatio = styleParams.dofThicknessRatio;
                    if (styleParams.dofSegments !== undefined) dofOptions.segments = styleParams.dofSegments;
                    if (styleParams.dofOffsetZ !== undefined) dofOptions.offsetZ = styleParams.dofOffsetZ;

                    node.toggleDOFHelper(styleParams.showDOFHelper, dofOptions);
                }

                const cylGeo = new THREE.CylinderGeometry(styleParams.jointRadius, styleParams.jointRadius, styleParams.jointHeight, 16);
                const cylMat = new THREE.MeshBasicMaterial({ color: jointColor });
                const cyl = new THREE.Mesh(cylGeo, cylMat);
                // Orient cylinder so its axis aligns with the joint's local z (rotation axis)
                cyl.rotateX(Math.PI / 2);
                node.updateWorldMatrix(true, false);
                cyl.applyMatrix4(node.matrixWorld);
                this.roboticArm.add(cyl);
            }
        });

        this.syncAxis(styleParams, baseOffset);
    }

    update(dhParameters, styleParams, baseParams) {
        this.generate(dhParameters, styleParams, baseParams);
    }

    getEndEffectorNode() {
        if (!this.robotContainer) return null;
        this.robotContainer.updateMatrixWorld(true);

        let root = null;
        this.robotContainer.traverse((node) => {
            if (node && node.isRoot) root = node;
        });
        if (!root) {
            this.robotContainer.traverse((node) => {
                if (!root && node && (node.isJoint || node.isLink)) root = node;
            });
        }
        if (!root) return null;

        let current = root;
        while (true) {
            const next = current.children.find((child) => child && (child.isJoint || child.isLink));
            if (!next) break;
            current = next;
        }

        current.updateWorldMatrix(true, false);
        return current;
    }

    getEndEffectorWorldPosition(out = new THREE.Vector3()) {
        const node = this.getEndEffectorNode();
        if (!node) return null;
        return node.getWorldPosition(out);
    }

    getEndEffectorWorldQuaternion(out = new THREE.Quaternion()) {
        const node = this.getEndEffectorNode();
        if (!node) return null;
        return node.getWorldQuaternion(out);
    }

    getEndEffectorLocalPosition(out = new THREE.Vector3()) {
        if (!this.robotContainer) return null;
        const worldPos = this.getEndEffectorWorldPosition(out);
        if (!worldPos) return null;
        return this.robotContainer.worldToLocal(worldPos);
    }

    getEndEffectorLocalQuaternion(out = new THREE.Quaternion()) {
        if (!this.robotContainer) return null;
        const worldQuat = this.getEndEffectorWorldQuaternion(_tmpWorldQuat);
        if (!worldQuat) return null;
        this.robotContainer.updateMatrixWorld(true);
        this.robotContainer.getWorldQuaternion(_tmpParentQuat);
        return out.copy(_tmpParentQuat).invert().multiply(worldQuat).normalize();
    }

    updateJoint(q = []) {
        if (!this.robotContainer) return;
        const joints = Array.isArray(this.joints) && this.joints.length > 0
            ? this.joints
            : [];

        if (joints.length === 0) {
            this.robotContainer.traverse((node) => {
                if (node && node.isJoint) joints.push(node);
            });
            this.joints = joints;
        }

        for (let i = 0; i < joints.length; i++) {
            const joint = joints[i];
            if (!joint) continue;
            const thetaBase = Number.isFinite(q[i]) ? q[i] : 0;
            const dh = joint.dh || {};
            const thetaOffset = Number.isFinite(dh.thetaOffset) ? dh.thetaOffset : 0;
            const theta = thetaBase + thetaOffset;

            if (joint.mode === 'MDH' || joint.mdh) {
                const d = Number.isFinite(joint.mdh?.d)
                    ? joint.mdh.d
                    : (Number.isFinite(dh.d) ? dh.d : 0);
                const m = new THREE.Matrix4().makeRotationZ(theta);
                m.setPosition(0, 0, d);
                joint.matrix.copy(m);
                if (joint.mdh) joint.mdh.theta = theta;
                if (joint.dh) joint.dh.theta = theta;
                joint.mode = 'MDH';
            } else {
                const m = new THREE.Matrix4().makeRotationZ(theta);
                joint.matrix.copy(m);
                if (joint.dh) joint.dh.theta = theta;
                joint.mode = 'DH';
            }
        }

        this.robotContainer.updateMatrixWorld(true);
    }

    syncAxis(styleParams = {}, baseOffset = {}) {
        if (this.robotContainer) {
            if (styleParams.syncUp) {
                AlignBaseMatrix(this.robotContainer, baseOffset);
            } else {
                this.robotContainer.matrixAutoUpdate = false;
                this.robotContainer.matrix.identity();
                if (baseOffset) {
                    const tx = Number.isFinite(baseOffset.x) ? baseOffset.x : 0;
                    const ty = Number.isFinite(baseOffset.y) ? baseOffset.y : 0;
                    const tz = Number.isFinite(baseOffset.z) ? baseOffset.z : 0;
                    this.robotContainer.matrix.setPosition(tx, ty, tz);
                }
            }
        }
    }
}
