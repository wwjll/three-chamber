import { Matrix4 } from 'three'
import { Frame } from './Frame.js'
import { dhToMatrix } from './Utils.js';

export class Joint extends Frame {

constructor() {

        super();
        this.isJoint = true;
        this.matrixAutoUpdate = false;

    }

    setFromDH(theta) {

        const matrix = new Matrix4().makeRotationZ(theta);
        this.matrix = matrix;

    }

    applyDH(theta, d, a, alpha) {
        this.matrix = dhToMatrix(theta, d, a, alpha);
    }

    setChild(child) {

        if (child.isLink && this.children.length == 0) {

            this.add(child);

            if (!child.parent) {

                child.parent = this;

            } else {

                console.warn("This Joint has parent!");

            }
        } else {

            console.warn("This Joint has child!")

        }

    }


}