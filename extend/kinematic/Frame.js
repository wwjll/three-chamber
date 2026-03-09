import { Object3D } from "three";

export class Frame extends Object3D {

    constructor() {

        super();

        this.position.set(0, 0, 0);
        this.quaternion.set(0, 0, 0, 1);
        this.matrixAutoUpdate = true;

    }



}
