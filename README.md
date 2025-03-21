# three-chamber

A repo contains funny and useful cases using three.js.

# How to run

All examples use vanilla javascript.
Mostly for my own experiments.

1. Install Depencencies

```shell
pnpm i
```

2. Start a local server to provide textures or 3D models.

```shell
cd assets
http-server -p 2000 --cors
```

3. Start dev server

```shell
pnpm run start
```

Install live-server plugin in VSCode or use your own server then you are good to go.

You can also preview the projects online.

# Blog

You can read the details in my blog : [juejin](https://juejin.cn/user/46634010687316/posts)

# Introduction

- **Dissolve**

  A simple case to extend three.js shader using `onBeforeCompile` api, you can experience 2 different shaders.

  [Preview](https://wwjll.github.io/three-chamber/examples/bundle/dissolveEffect.html)


  ![Dissolve](./assets/docs/DissolveEffect.gif)

- **CameraEditor**

  A small case to edit splines for camera, including progress control, generator animation, scissor and viewport, using RAF(requestAnimationFrame) only in camera animation as needed, featuring tween.js easing functions in animation progress and more.
  It is available in low-end laptops running scene complicated like San-Miguel.

  [Preview](https://wwjll.github.io/three-chamber/examples/bundle/cameraEditor.html)

  ![CameraEditor](./assets/docs/CameraEditor.gif)

- **BimAnimation**

  A simple case of animation control.

  [Preview](https://wwjll.github.io/three-chamber/examples/bundle/buildingAnimation.html)

  ![BimAnimation](./assets/docs/BimAnimation.gif)

- **DistortHighMap**

  A simple case using bump texture and shader to create visual effect.

  [Preview](https://wwjll.github.io/three-chamber/examples/bundle/distortHighMap.html)

  ![DistortHighMap](./assets/docs/DistortHighMap.gif)
