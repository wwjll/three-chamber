# three-chamber

A repository of creative and practical experiments using Three.js

# How to run

All examples use vanilla JavaScript and are primarily for experimental purposes.

1. Install Depencencies

```shell
pnpm i
```

2. Launch Asset Server

```shell
cd assets && http-server -p 2000 --cors
```

3. Start dev server

```shell
pnpm run start
```

# My Blog

Find more in my blog : [juejin](https://juejin.cn/user/46634010687316/posts)

# Featured Projects

-   **Dissolve Effect**

    Custom shader extension using Three.js onBeforeCompile API

    [Preview](https://wwjll.github.io/three-chamber/examples/bundle/dissolveEffect.html)

    ![Dissolve](./assets/docs/DissolveEffect.gif)

-   **CameraEditor**

    Spline-based camera animation toolkit

    [Preview](https://wwjll.github.io/three-chamber/examples/bundle/cameraEditor.html)

    ![CameraEditor](./assets/docs/CameraEditor.gif)

-   **Bim Animation**

    Lightweight building animation controller

    [Preview](https://wwjll.github.io/three-chamber/examples/bundle/buildingAnimation.html)

    ![BimAnimation](./assets/docs/BimAnimation.gif)

-   **DistortHighMap**

    Visual effects using bump textures and custom shaders

    [Preview](https://wwjll.github.io/three-chamber/examples/bundle/distortHighMap.html)

    ![DistortHighMap](./assets/docs/DistortHighMap.gif)

-   **PathTracing**

    Simple Path-Tracing demo on top of Three.js.
    Unfortunately due to my lack of experience, you may need to set Chrome browser ANGLE backend to OpenGL to be compatible.

    [Preview](https://wwjll.github.io/three-chamber/examples/bundle/pathTracing.html)

    ![DistortHighMap](./assets/docs/PathTracing.png)
