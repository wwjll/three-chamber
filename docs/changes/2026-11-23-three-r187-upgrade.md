# Upgrade three to r187, add CI checks and path tracing diagnostics

## Motivation

The project pinned three.js r160, which blocked newer loaders, controls and
the WebGPU and TSL rendering path. The deploy workflow only built and
published the site, so a broken push could reach Pages without lint or tests.
Several examples depended on large scene files and textures stored in the
repository, and the path tracer had no way to inspect why individual paths
ended. Large batches like this one also needed a place to record their details
outside the commit message.

## Changes

### Dependencies and tooling

- Upgraded `three` from `^0.160` to `^0.187.0` and updated the lockfile.
- Pinned the toolchain with `.nvmrc` (Node 24) and `packageManager`
  (`pnpm@11.22.0`). Added `pnpm-workspace.yaml` to disable dependency build
  scripts.
- Added a `test` script and enabled `packageExports` in the Parcel resolver.
  `@tweenjs/tween.js` is now imported by its package name.
- Ignored `.alma-snapshots`.

### CI

- The deploy workflow runs lint and tests before the Pages build.
- Node and pnpm versions come from `.nvmrc` and `packageManager`.
- Each job declares its own permissions. The build job reads the Pages
  configuration and the deploy job holds the Pages write and OIDC token
  permissions.
- The workflow runs only on `main`, including manual runs, because the project
  no longer uses other branches.
- The concurrency group is keyed by workflow and ref.

### Kinematics

- `ChainGenerator`, `Joint` and `Link` mark world matrices for update, and
  `syncBase` updates the base world matrix. Base alignment changes now reach
  the actuator before the next render.
- `SequenceGenerator` uses the r169+ `TransformControls.getHelper()` API.
- The pick-and-return sequence moved from `examples/ikModelPickSequence.js`
  into `examples/ikModelPick.js` as `createCubePickAndReturnSequence`.
- Tests check behaviour through the public API, including trajectory points,
  marker colours and collider retention. A new test covers base alignment.

### Path tracing

- Added a diagnostics mode. The shader records path length, termination
  reason, last BSDF event, sample PDF, peak throughput, peak contribution and
  failure flags for non-finite or extreme values. `PathTracer` renders them
  into two float targets, `OutputMaterial` visualises each channel, and
  `readDiagnosticPixel` reads a single pixel.
- Added `extend/path-tracing/Diagnostics.js`, the
  `examples/pathTracingDiagnostics` page and its tests.
- `setSize` now honours the device pixel ratio and sizes render targets from
  the drawing buffer.
- Renamed the shader `luminance` helper to `bsdfLuminance` to avoid a clash
  with three.js r187 shader chunks. `pathTracing.js` uses `HDRLoader`, which
  replaces `RGBELoader`.

### Examples

- `cameraEditor` loads Collision World and Dungeon from the three.js r187
  example models and adds a generated scene. The track editor now lives in
  the example.
- `dissolve` uses `WebGPURenderer` with TSL, procedural noise, a hot edge with
  bloom, dissolve particles and a progress monitor. Models load from the
  three.js example models.
- `towerMotion` builds its tower procedurally.
- Control panels in `dhLinks`, `ik` and `ikModelPick` moved to the top right
  with margins.

### Assets and removed code

- Robot models moved from `assets/models/<robot>` to
  `assets/models/robots/<robot>`.
- Removed the scene models and textures that the examples no longer use,
  including the 21 MB `chicken_gun_deserttown.glb`.
- Removed `extend/editor/TrackEditor.js` and `extend/effect/legacy`.
- Removed explanatory comments that restated the code.

### Documentation and agent rules

- Added the change log under `docs/changes/` and linked it from the README and
  the agent instructions.
- Added `.agent/validation.md` with tiered checks and a description of CI.
  The path tracer roadmap refers to it.
- Clickable file links in agent replies use Windows UNC paths for the WSL
  checkout.

## Validation

- `pnpm run lint` passed with 91 warnings and no errors.
- `pnpm test` passed all 80 tests.
- `pnpm run build-pages` passed and produced `pathTracingDiagnostics.html`.
- All checks ran with `pnpm install --frozen-lockfile` in a clean copy of the
  working tree.

## Compatibility and migration

- Code that loads robot models from `assets/models/kuka-kr5`,
  `assets/models/ur3e` or `assets/models/robotiq-2f-85` must add `robots/` to
  the path.
- `extend/editor/TrackEditor.js`, `extend/effect/legacy` and
  `examples/ikModelPickSequence.js` no longer exist. Import
  `createCubePickAndReturnSequence` from `examples/ikModelPick.js`.
- Local development needs Node 24 and pnpm 11.22. Run `corepack enable` so
  pnpm follows `packageManager`.
- `cameraEditor` and `dissolve` fetch models from `raw.githubusercontent.com`
  and need network access.
