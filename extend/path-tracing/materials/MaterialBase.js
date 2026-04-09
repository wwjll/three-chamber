import { ShaderMaterial } from 'three';

class MaterialBase extends ShaderMaterial {

    set needsUpdate(v) {

        super.needsUpdate = true;
        this.dispatchEvent({

            type: 'recompilation',

        });

    }

    constructor(shader) {

        super(shader);

        for (const key in this.uniforms) {

            Object.defineProperty(this, key, {

                get() {

                    return this.uniforms[key].value;

                },

                set(v) {

                    this.uniforms[key].value = v;

                }

            });

        }

    }

}

export { MaterialBase };
