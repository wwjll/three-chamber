import { Matrix4 } from "three";

export function dhToMatrix(theta, d, a, alpha) {
    const ct = Math.cos(theta), st = Math.sin(theta);
    const ca = Math.cos(alpha), sa = Math.sin(alpha);

    return new Matrix4().set(
        ct, -st * ca, st * sa, a * ct,
        st, ct * ca, -ct * sa, a * st,
        0, sa, ca, d,
        0, 0, 0, 1
    );

}
