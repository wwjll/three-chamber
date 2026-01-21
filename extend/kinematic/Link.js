
import { Matrix4 } from 'three'
import { Frame } from './Frame.js'

export class Link extends Frame {

    constructor() {
        super();
        this.isLink = true;
        this.matrixAutoUpdate = false;
    }

    applyDH(d, a, alpha) {

        const Tz = new Matrix4().makeTranslation(0, 0, d);
        const Rx = new Matrix4().makeRotationX(alpha);
        const Tx = new Matrix4().makeTranslation(a, 0, 0);

        const m = Tz.multiply(Rx).multiply(Tx);
        this.matrix.copy(m);
        return m;
    }

    applyMDH(a, alpha) {
        const Rx = new Matrix4().makeRotationX(alpha);
        const Tx = new Matrix4().makeTranslation(a, 0, 0);

        const m = Rx.multiply(Tx);
        this.matrix.copy(m);
        return m;
    }

    setChild(child) {

        if (this.children.length !== 0) {
            return;
        }

        const canAttachJoint = child.isJoint === true;
        const canAttachLink = this.isBase === true && child.isLink === true;

        if (canAttachJoint || canAttachLink) {
            this.add(child);
        }

    }


}
