import * as THREE from 'three';
import { Joint } from './Join.js';
import { Link } from './Link.js';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';

export function createChainFromDHParameters(dhParameters) {
    const chain = [];
    let lastNode = null;

    for (let i in dhParameters) {
        const params = dhParameters[i];
        const [theta, d, a, alpha] = params;

        const joint = new Joint();
        if (i == 0) {
            joint.isRoot = true
        }
        joint.applyDH(theta, d, a, alpha);

        if (lastNode) {
            lastNode.setChild(joint)
        }
        lastNode = joint;

        const link = new Link();
        link.setFromDH(d, a, alpha);
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
        this.roboticArm = null;
    }

    generate(dhParameters, styleParams) {
        if (this.roboticArm) {
            this.roboticArm.traverse(child => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) child.material.dispose();
            });
            this.scene.remove(this.roboticArm);
        }

        this.roboticArm = new THREE.Group();
        this.scene.add(this.roboticArm);

        if (dhParameters.length === 0) {
            return;
        }

        // Visualize initial offset
        const firstDhParams = dhParameters[0];
        const [theta, d, a, alpha] = firstDhParams;
        const origin = new THREE.Vector3(0, 0, 0);
        const d_offset = new THREE.Vector3(0, 0, d);
        const ct = Math.cos(theta);
        const st = Math.sin(theta);
        const a_offset = new THREE.Vector3(a * ct, a * st, d);
        const points = [origin, d_offset, a_offset];
        const positions = [];
        for (const p of points) {
            positions.push(p.x, p.y, p.z);
        }
        const lineGeo = new LineGeometry();
        lineGeo.setPositions(positions);
        const lineMat = new LineMaterial({
            color: styleParams.offsetColor,
            linewidth: styleParams.offsetLineWidth,
            resolution: new THREE.Vector2(window.innerWidth, window.innerHeight)
        });
        lineMat.defines.USE_WIDELINE = "";
        const offsetLine = new Line2(lineGeo, lineMat);
        offsetLine.computeLineDistances();
        this.roboticArm.add(offsetLine);

        const chain = createChainFromDHParameters(dhParameters);
        const root = chain[0];
        root.updateMatrixWorld(true);

        root.traverse((node) => {
            if (node.isLink) {
                if (node.parent && node.children.length > 0 && node.children[0].isJoint) {
                    const child = node.children[0];
                    const posA = new THREE.Vector3();
                    node.parent.getWorldPosition(posA);
                    const posB = new THREE.Vector3();
                    child.getWorldPosition(posB);
                    if (posA.distanceTo(posB) > 0) {
                        const path = new THREE.LineCurve3(posA, posB);
                        const tubeGeo = new THREE.TubeGeometry(path, 1, styleParams.linkRadius, 8, false);
                        const tubeMat = new THREE.MeshBasicMaterial({ color: styleParams.linkColor });
                        const tube = new THREE.Mesh(tubeGeo, tubeMat);
                        this.roboticArm.add(tube);
                    }
                }
            } else if (node.isJoint) {
                const cylGeo = new THREE.CylinderGeometry(styleParams.jointRadius, styleParams.jointRadius, styleParams.jointHeight, 16);
                const cylMat = new THREE.MeshBasicMaterial({ color: styleParams.jointColor });
                const cyl = new THREE.Mesh(cylGeo, cylMat);
                node.updateWorldMatrix(true, false);
                cyl.applyMatrix4(node.matrixWorld);
                this.roboticArm.add(cyl);
            }
        });

        this.syncAxis();
    }

    update(dhParameters, styleParams) {
        this.generate(dhParameters, styleParams);
    }

    syncAxis() {
        if (this.roboticArm) {
            this.roboticArm.rotation.x = -Math.PI / 2;
        }
    }
}

class ChainSolver {

}