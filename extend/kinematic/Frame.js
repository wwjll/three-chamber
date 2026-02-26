import { Object3D } from "three";

import { mat4, quat, vec3 } from 'gl-matrix';
import { RAD2DEG } from '../tools/Constants.js';


export class Frame extends Object3D {

    constructor() {

        super();

        this.position.set(0, 0, 0);
        this.quaternion.set(0, 0, 0, 1);
        this.matrixAutoUpdate = true;

    }

    

}
