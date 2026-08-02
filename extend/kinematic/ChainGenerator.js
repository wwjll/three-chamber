import {
    Color,
    Group,
    Matrix4,
    Mesh,
    MeshBasicMaterial,
    MeshStandardMaterial,
    CatmullRomCurve3,
    TubeGeometry,
    Vector3,
    AxesHelper,
    CylinderGeometry,
} from 'three';
import { Joint } from './Joint.js';
import { Link } from './Link.js';

function createSoftRandomColor() {
    const color = new Color();
    const hue = Math.random();
    const saturation = 0.65 + Math.random() * 0.25;
    const lightness = 0.45 + Math.random() * 0.2;
    color.setHSL(hue, saturation, lightness);
    return color;
}

function normalizeDhParam(item) {
    if (Array.isArray(item)) {
        const [
            theta = 0,
            d = 0,
            a = 0,
            alpha = 0,
            thetaOffset = 0,
            minAngle = -185,
            maxAngle = 185,
            axisSign = 1,
        ] = item;
        return { theta, d, a, alpha, thetaOffset, minAngle, maxAngle, axisSign };
    }
    if (item && typeof item === 'object') {
        return {
            theta: Number.isFinite(item.theta) ? item.theta : 0,
            d: Number.isFinite(item.d) ? item.d : 0,
            a: Number.isFinite(item.a) ? item.a : 0,
            alpha: Number.isFinite(item.alpha) ? item.alpha : 0,
            thetaOffset: Number.isFinite(item.thetaOffset) ? item.thetaOffset : 0,
            minAngle: Number.isFinite(item.minAngle) ? item.minAngle : -185,
            maxAngle: Number.isFinite(item.maxAngle) ? item.maxAngle : 185,
            axisSign: item.axisSign === -1 ? -1 : 1,
        };
    }
    return { theta: 0, d: 0, a: 0, alpha: 0, thetaOffset: 0, minAngle: -185, maxAngle: 185, axisSign: 1 };
}

function alignBaseMatrix(container, offset = {}) {
    const align = new Matrix4().set(
        1, 0, 0, 0,
        0, 0, 1, 0,
        0, -1, 0, 0,
        0, 0, 0, 1,
    );
    const tx = Number.isFinite(offset.x) ? offset.x : 0;
    const ty = Number.isFinite(offset.y) ? offset.y : 0;
    const tz = Number.isFinite(offset.z) ? offset.z : 0;
    const translation = new Matrix4().makeTranslation(tx, ty, tz);
    container.matrixAutoUpdate = false;
    container.matrix.copy(align).multiply(translation);
}

function convertMDH(params) {
    const dhParams = Array.isArray(params) ? params : [];
    const result = [];
    const n = dhParams.length;

    for (let i = 0; i < n; i++) {
        const cur = normalizeDhParam(dhParams[i]);
        const prev = i > 0 ? normalizeDhParam(dhParams[i - 1]) : null;
        const a = i === 0 ? 0 : prev.a;
        const alpha = i === 0 ? 0 : prev.alpha;
        result.push([cur.theta, cur.d, a, alpha, cur.thetaOffset, cur.minAngle, cur.maxAngle, cur.axisSign]);
    }

    if (n > 0) {
        const last = normalizeDhParam(dhParams[n - 1]);
        result.push([0, 0, last.a, last.alpha, 0, -185, 185, 1]);
    }

    return result;
}

function convertDH(params) {
    const mdhParams = Array.isArray(params) ? params : [];
    const m = mdhParams.length;
    const result = [];
    const n = Math.max(0, m - 1);

    for (let i = 0; i < n; i++) {
        const cur = normalizeDhParam(mdhParams[i]);
        const next = normalizeDhParam(mdhParams[i + 1]);
        result.push([cur.theta, cur.d, next.a, next.alpha, cur.thetaOffset, cur.minAngle, cur.maxAngle, cur.axisSign]);
    }

    return result;
}

function createChainFromDHParameters(dhParameters, mode = 'DH') {
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

function createVisualMaterial(color, styleParams) {
    if (styleParams.litMaterials) {
        return new MeshStandardMaterial({
            color,
            roughness: Number.isFinite(styleParams.roughness) ? styleParams.roughness : 0.45,
            metalness: Number.isFinite(styleParams.metalness) ? styleParams.metalness : 0.2,
        });
    }
    return new MeshBasicMaterial({ color });
}

function getDistinctLocalPoints(points) {
    const result = [];
    for (const point of points) {
        if (!point) continue;
        if (result.length === 0 || result[result.length - 1].distanceToSquared(point) > 1e-12) {
            result.push(point.clone());
        }
    }
    return result;
}

function trimPolylineStart(points, distance) {
    let remaining = distance;
    while (points.length >= 2 && remaining > 1e-8) {
        const segmentLength = points[0].distanceTo(points[1]);
        if (segmentLength <= 1e-8) {
            points.shift();
        } else if (remaining >= segmentLength) {
            remaining -= segmentLength;
            points.shift();
        } else {
            points[0].lerp(points[1], remaining / segmentLength);
            break;
        }
    }
}

function trimPolylineEnd(points, distance) {
    let remaining = distance;
    while (points.length >= 2 && remaining > 1e-8) {
        const lastIndex = points.length - 1;
        const segmentLength = points[lastIndex].distanceTo(points[lastIndex - 1]);
        if (segmentLength <= 1e-8) {
            points.pop();
        } else if (remaining >= segmentLength) {
            remaining -= segmentLength;
            points.pop();
        } else {
            points[lastIndex].lerp(points[lastIndex - 1], remaining / segmentLength);
            break;
        }
    }
}

function getJointSurfaceDistance(direction, jointAxis, styleParams) {
    const radius = Math.max(0, Number.isFinite(styleParams.jointRadius) ? styleParams.jointRadius : 0);
    const halfHeight = Math.max(0, Number.isFinite(styleParams.jointHeight) ? styleParams.jointHeight * 0.5 : 0);
    if (radius === 0 || halfHeight === 0) return 0;

    const unitDirection = direction.clone().normalize();
    const unitAxis = jointAxis.clone().normalize();
    const axialAmount = Math.abs(unitDirection.dot(unitAxis));
    const radialAmount = Math.sqrt(Math.max(0, 1 - axialAmount * axialAmount));
    const capDistance = axialAmount > 1e-8 ? halfHeight / axialAmount : Infinity;
    const sideDistance = radialAmount > 1e-8 ? radius / radialAmount : Infinity;
    return Math.min(capDistance, sideDistance);
}

function prepareLinkPoints(points, styleParams, {
    trimStart = false,
    trimEnd = false,
    startAxis = new Vector3(0, 0, 1),
    endAxis = new Vector3(0, 0, 1),
} = {}) {
    const prepared = getDistinctLocalPoints(points);
    if (prepared.length < 2 || styleParams.trimLinksAtJoints !== true) return prepared;

    const overlap = Math.max(
        0,
        Number.isFinite(styleParams.linkJointOverlap)
            ? styleParams.linkJointOverlap
            : (Number.isFinite(styleParams.linkRadius) ? styleParams.linkRadius : 0),
    );

    if (trimStart && prepared.length >= 2) {
        const direction = prepared[1].clone().sub(prepared[0]);
        const surfaceDistance = getJointSurfaceDistance(direction, startAxis, styleParams);
        trimPolylineStart(prepared, Math.max(0, surfaceDistance - overlap));
    }

    if (trimEnd && prepared.length >= 2) {
        const lastIndex = prepared.length - 1;
        const direction = prepared[lastIndex].clone().sub(prepared[lastIndex - 1]);
        const surfaceDistance = getJointSurfaceDistance(direction, endAxis, styleParams);
        trimPolylineEnd(prepared, Math.max(0, surfaceDistance - overlap));
    }

    return getDistinctLocalPoints(prepared);
}

function createTubeFromLocalPoints(points, radius, color, styleParams) {
    if (!Array.isArray(points) || points.length < 2) return null;
    const curve = new CatmullRomCurve3(points);
    const tubeGeo = new TubeGeometry(curve, 32, radius, 8, false);
    const tube = new Mesh(tubeGeo, createVisualMaterial(color, styleParams));
    tube.castShadow = styleParams.castShadow === true;
    tube.receiveShadow = styleParams.receiveShadow === true;
    return tube;
}

function attachJointVisual(joint, styleParams, jointColor) {
    const cylGeo = new CylinderGeometry(styleParams.jointRadius, styleParams.jointRadius, styleParams.jointHeight, 16);
    const cyl = new Mesh(cylGeo, createVisualMaterial(jointColor, styleParams));
    cyl.rotateX(Math.PI / 2);
    cyl.castShadow = styleParams.castShadow === true;
    cyl.receiveShadow = styleParams.receiveShadow === true;
    joint.add(cyl);
}

function attachDHLinkVisual(joint, styleParams, linkColor) {
    const dh = joint.dh || {};
    const d = Number.isFinite(dh.d) ? dh.d : 0;
    const a = Number.isFinite(dh.a) ? dh.a : 0;
    const alpha = Number.isFinite(dh.alpha) ? dh.alpha : 0;
    const end = new Vector3(a, 0, d);
    if (end.lengthSq() <= 1e-12) return;

    const points = [new Vector3(0, 0, 0)];
    if (Math.abs(d) > 1e-6) {
        points.push(new Vector3(0, 0, d));
    }
    points.push(end);
    const linkNode = joint.children.find((child) => child?.isLink);
    const nextJoint = linkNode?.children.find((child) => child?.isJoint);
    const linkPoints = prepareLinkPoints(points, styleParams, {
        trimStart: true,
        trimEnd: Boolean(nextJoint),
        endAxis: new Vector3(0, -Math.sin(alpha), Math.cos(alpha)),
    });
    const tube = createTubeFromLocalPoints(linkPoints, styleParams.linkRadius, linkColor, styleParams);
    if (tube) joint.add(tube);
}

function attachMDHLinkVisual(hostNode, joint, styleParams, linkColor) {
    if (!hostNode || !joint) return;
    const dh = joint.dh || {};
    const a = Number.isFinite(dh.a) ? dh.a : 0;
    const alpha = Number.isFinite(dh.alpha) ? dh.alpha : 0;
    const d = Number.isFinite(dh.d) ? dh.d : 0;
    const end = new Vector3(a, -Math.sin(alpha) * d, Math.cos(alpha) * d);
    if (end.lengthSq() <= 1e-12) return;

    const points = [new Vector3(0, 0, 0)];
    if (Math.abs(a) > 1e-6) {
        points.push(new Vector3(a, 0, 0));
    }
    points.push(end);
    const linkPoints = prepareLinkPoints(points, styleParams, {
        trimStart: hostNode.isJoint === true,
        trimEnd: true,
        endAxis: new Vector3(0, -Math.sin(alpha), Math.cos(alpha)),
    });
    const tube = createTubeFromLocalPoints(linkPoints, styleParams.linkRadius, linkColor, styleParams);
    if (tube) hostNode.add(tube);
}

class ChainGenerator {
    static build(chainOwner, dhParameters, styleParams, baseParams = {}) {
        const scene = chainOwner?.scene ?? null;
        if (!scene) return null;

        if (chainOwner.robotContainer) {
            chainOwner.robotContainer.traverse((child) => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) child.material.dispose();
            });
            scene.remove(chainOwner.robotContainer);
        }

        const mode = baseParams.mdhMode ? 'MDH' : 'DH';
        const baseOffset = baseParams.baseOffset || {};
        const useConvertedParams = baseParams.useConvertedParams === true;
        const chainParams = mode === 'MDH' && !useConvertedParams
            ? convertMDH(dhParameters)
            : dhParameters;

        if (styleParams.randomJointColor) {
            if (!chainOwner.randomJointColorEnabled) {
                chainOwner.randomJointColors = Array.from({ length: dhParameters.length }, () => createSoftRandomColor());
                chainOwner.randomJointColorEnabled = true;
            } else if (chainOwner.randomJointColors.length !== dhParameters.length) {
                if (chainOwner.randomJointColors.length > dhParameters.length) {
                    chainOwner.randomJointColors.length = dhParameters.length;
                } else {
                    const missing = dhParameters.length - chainOwner.randomJointColors.length;
                    for (let i = 0; i < missing; i++) {
                        chainOwner.randomJointColors.push(createSoftRandomColor());
                    }
                }
            }
        } else {
            chainOwner.randomJointColorEnabled = false;
        }

        chainOwner.robotContainer = new Group();
        scene.add(chainOwner.robotContainer);

        chainOwner.roboticArm = new Group();
        chainOwner.robotContainer.add(chainOwner.roboticArm);

        if (dhParameters.length === 0) {
            ChainGenerator.syncBase(chainOwner, styleParams, baseOffset);
            chainOwner.joints = [];
            return chainOwner.roboticArm;
        }

        const chain = createChainFromDHParameters(chainParams, mode);
        const root = chain[0];
        chainOwner.roboticArm.add(root);
        root.updateMatrixWorld(true);

        if (mode === 'MDH' && styleParams.showAxisHelper) {
            const axisSize = Number.isFinite(styleParams.axisHelperSize) ? styleParams.axisHelperSize : 0.1;
            const baseAxis = new AxesHelper(axisSize);
            baseAxis.matrixAutoUpdate = false;
            chainOwner.robotContainer.add(baseAxis);
        }

        chainOwner.joints = [];
        let jointIndex = 0;
        const mdhHosts = [];
        root.traverse((node) => {
            if (mode === 'MDH' && node.isLink) {
                return;
            }
            if (node.isJoint) {
                chainOwner.joints.push(node);
                mdhHosts.push(node.parent?.isLink ? (node.parent.parent?.isJoint ? node.parent.parent : chainOwner.roboticArm) : node);
                if (typeof styleParams.showAxisHelper === 'boolean') {
                    const axisOptions = {};
                    if (styleParams.axisHelperSize !== undefined) {
                        axisOptions.size = styleParams.axisHelperSize;
                    }
                    node.toggleAxisHelper(styleParams.showAxisHelper, axisOptions);
                }

                let jointColor = styleParams.jointColor;
                if (styleParams.randomJointColor) {
                    jointColor = chainOwner.randomJointColors[jointIndex];
                    if (!jointColor) {
                        jointColor = createSoftRandomColor();
                        chainOwner.randomJointColors[jointIndex] = jointColor;
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

                attachJointVisual(node, styleParams, jointColor);
                const linkColor = styleParams.randomLinkColor ? createSoftRandomColor() : styleParams.linkColor;
                if (mode === 'MDH') {
                    attachMDHLinkVisual(mdhHosts[mdhHosts.length - 1], node, styleParams, linkColor);
                } else {
                    attachDHLinkVisual(node, styleParams, linkColor);
                }
            }
        });

        ChainGenerator.syncBase(chainOwner, styleParams, baseOffset);
        return chainOwner.roboticArm;
    }

    static syncBase(chainOwner, styleParams = {}, baseOffset = {}) {
        if (!chainOwner?.robotContainer) return;
        if (styleParams.syncUp) {
            alignBaseMatrix(chainOwner.robotContainer, baseOffset);
        } else {
            chainOwner.robotContainer.matrixAutoUpdate = false;
            chainOwner.robotContainer.matrix.identity();
            const tx = Number.isFinite(baseOffset.x) ? baseOffset.x : 0;
            const ty = Number.isFinite(baseOffset.y) ? baseOffset.y : 0;
            const tz = Number.isFinite(baseOffset.z) ? baseOffset.z : 0;
            chainOwner.robotContainer.matrix.setPosition(tx, ty, tz);
        }
    }
}

export {
    alignBaseMatrix,
    convertMDH,
    convertDH,
    createChainFromDHParameters,
    ChainGenerator,
    ChainGenerator as default,
};
