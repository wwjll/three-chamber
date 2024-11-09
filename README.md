# three-chamber

# What is this repo?

A repo contains funny and useful cases using three.js.

# How to run

All the examples use vanilla javascript.
Mostly for my own experiments.

run:

- `git clone https://github.com/wwjll/three-chamber.git`
- `npm i`
- `install `live-server` plugin to start`

or you can use online cases.

# Blog

You can read the details in my blog : [juejin](https://juejin.cn/user/46634010687316/posts)

# Introduction

- **Dissolve**
  A simple case to extend three.js shader using `onBeforeCompile` api, you can experience 2 different shaders.

  ![Dissolve](./assets/docs/DissolveEffect.gif)

- **CameraEditor**
  A small case to edit splines for camera, including progress control, generator animation, scissor and viewport, using RAF(requestAnimationFrame) only in camera animation as needed, featuring tween.js easing functions in animation progress and more.
  It is available in low-end laptops running scene complicated like San-Miguel.

  ![CameraEditor](./assets/docs/CameraEditor.gif)

- **BimAnimation**
  A simple case of animation control.
  ![BimAnimation](./assets/docs/BimAnimation.gif)

# Examples

- [Dissolve](https://wwjll.github.io/three-chamber/examples-io/DissolveEffect.html)
- [CameraEditor](https://wwjll.github.io/three-chamber/examples-io/CameraEditor.html)
- [BimAnimation](https://wwjll.github.io/three-chamber/examples-io/BimAnimation.html)
