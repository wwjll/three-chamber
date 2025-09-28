
import { Matrix4 } from 'three'
import { Frame } from './Frame.js'

export class Link extends Frame {

    constructor() {
        super();
        this.isLink = true;
    }

    setFromDH(d, a, alpha) {

        const Tz = new Matrix4().makeTranslation(0, 0, d);
        const Tx = new Matrix4().makeTranslation(a, 0, 0);
        const Rx = new Matrix4().makeRotationX(alpha);

        return Tz.multiply(Tx).multiply(Rx);
    }

    setChild(child) {

        if (child.isJoint && this.children.length == 0) {

            this.add(child);

            if (!child.parent) {

                child.parent = this;

            } else {

                console.warn("This Link has parent!");

            }
        } else {

            console.warn("This Link has child!")

        }

    }


}