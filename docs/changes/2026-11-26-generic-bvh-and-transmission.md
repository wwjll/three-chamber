# Add a generic BVH, path tracing transmission and README example GIFs

## Motivation

The path tracer built its BVH with a private builder tied to its own triangle
classes, which made the tree hard to test, compare or reuse outside the
shader. Glass and other transmissive materials rendered as opaque surfaces.
Large scenes rendered the whole frame in one draw, which could stall the
browser. The r187 upgrade also changed the look and controls of most
examples, but the README still showed media from before the upgrade, and five
examples had only static screenshots. The previous push showed that agents had
no step that asked whether media needed updating.

## Changes

### Generic BVH

- Added `extend/partition/` with `aabb.js`, `triangles.js` and the BVH modules
  `bvh/BVHLayout.js`, `bvh/buildBVH.js`, `bvh/refitBVH.js`, `bvh/queryBVH.js`
  and `bvh/packBVHs.js`. The package has no dependency on three.js or the path
  tracer.
- Nodes use a 32-byte typed-array layout that matches the WGSL struct.
- Builds use binned SAH or center splits in `auto`, recursive or iterative
  mode. Recursive and iterative builds produce byte-identical trees.
- Added refit, reentrant ray queries and `packBVHs`, which packs several trees
  into one buffer.
- `leafThreshold` replaces `maxLeafSize`. A node with at most that many
  primitives becomes a leaf. Compared with the old rule, SAH builds are 38 to
  42 percent faster and produce 70 to 82 percent fewer nodes.
- Several ideas come from three-mesh-bvh.
- Added tests in `test/partition` for build, layout, pack, query and refit,
  plus the `pnpm run test:partition` and `pnpm run bench:partition` scripts.
- Added three decision records in `docs/decisions/`: generic binned BVH, BVH
  comparison example and BVH leaf threshold.

### Path tracer

- `SceneGenerator` collects world-space triangles, including skinned and
  morphed positions and skinned normals, builds the tree with `buildBVH` and
  writes triangles in leaf order.
- BVH nodes are uploaded unchanged as RGBA32UI textures, two texels per node.
  The GPU scene layout version is now 4 and the material stride is 6 texels.
- Removed `Triangle`, `BVHNode` and `BVHBuilder`.
- Added smooth dielectric transmission with Fresnel reflection, Snell
  refraction, total internal reflection and the inverse eta squared radiance
  factor. A thickness of 0 is treated as a thin wall. Beer-Lambert absorption
  uses `attenuationColor` and `attenuationDistance`. Rough transmission is not
  implemented yet.
- Added the material fields `transmission`, `ior`, `thickness` and
  `absorption`, and Transmission and Delta event flags in Diagnostics.
- `spawnRayOrigin` offsets new rays toward the side the direction leaves
  through, scaled by the position magnitude.
- Added tiled rendering with `Tiles.js` (`getTileRect`) and
  `PathTracer.setTiles`. `update(tileSteps)` traces that many tiles per call.
- `setDataTexture` throws when a texture needs more rows than
  `maxTextureSize`.
- Added tests in `bsdf.test.js`, `contracts.test.js` and the new
  `tiles.test.js`.

### Examples

- `pathTracing` has a collapsible stats panel that shows load, compile, BVH
  and GPU data times and samples per second. Tiles X and Y controls split the
  frame, and a grid outline flashes when the grid changes.
- `pathTracing` loads DamagedHelmet from glTF-Sample-Assets, FlightHelmet from
  the legacy glTF-Sample-Models, whose lenses use alpha blend, and Nemetona
  from three.js r187 with Draco. A TorusKnot is the fallback. Meshopt and
  Draco decoders are configured.
- Added `bvhCompare`, which shows up to a 3 by 3 grid of cells or a wipe view.
  Each cell builds its tree in a Web Worker (`bvhCompare_bvhWorker.js`) and
  can show boxes by depth, a traversal heat map, single-ray picks, refit
  against rebuild and a brute-force check. It loads three.js r187 models.
- Added `pathTracingTransmission` with a sphere, a prism, DragonAttenuation, a
  glass panel and a raster reference view.

### README media

- Rewrote the README introduction, changed section headings from `##` to `#`
  and removed the DH Links entry. The `dhLinks` example is still built and
  published.
- Added the BVH Compare and Path Tracing Transmission entries.
- Every example listed in the README now shows a GIF. `SimpleIK.png`,
  `CameraEditor.png`, `PathTracing.png` and `TowerMotion.png` were replaced by
  GIFs of the same name and the README references were updated.
  `DHLinks.png` was deleted with the DH Links entry.
- Recorded new GIFs for IK Model Pick, Simple IK, Camera Editor, Path
  Tracing, Tower Motion and Dissolve, and added `BVHCompare.gif` and
  `PathTracingTransmission.gif`. Path Tracing was recorded with the new stats
  panel.
- All GIFs use the full 1280 by 800 viewport and loop forever.
  Path Tracing Transmission plays at about 5 frames per second. The others
  play at about 10 frames per second.
- The recordings draw a pointer that follows clicks and drags, because
  headless capture does not show the system cursor.
- Camera Editor was recorded with `stride` at 0.003 and preview `scale` at
  0.35.

### Agent rules and docs

- `coding-standards.md` has an Examples section: one HTML and one JS file per
  example, worker files named `<example>_<name>.js`, reusable code in
  `extend/`, and models loaded online from three.js r187 or
  glTF-Sample-Assets. A WSL Preview Server section describes the systemd user
  services on ports 1234 and 2000.
- `path-tracer-roadmap.md` has a new "P1: Generic BVH" section and updated
  transmission status.
- Added "Updating Media Before a Push" to `demo-media-standards.md`. Before a
  push, agents list the examples whose appearance or interaction changed, ask
  whether to recapture their media, and include new media in the same batch
  and change log entry. `.agent/README.md` links to the section.
- Added `docs/todos/` with follow-ups for the BVH shader and `bvhCompare`.
  `docs/todos/demo-media.md` was removed because Path Tracing has been
  re-recorded.

### Dependencies

- Added the `path-browserify` and `process` dev dependencies, which Parcel
  uses as browser polyfills, and updated the lockfile.

## Validation

- `pnpm run lint` passed with 0 errors and 91 warnings.
- `pnpm test` passed 130 of 130 tests.
- `pnpm run build-pages` passed in a clean copy of the working tree and
  produced the 10 example pages and `index.html`. The generated `index.html`
  references all eight GIFs.
- `git diff --check` passed.

## Compatibility and migration

- The GPU scene layout moved from version 1 to version 4. Code that used
  `BVHBuilder`, `Triangle` or `BVHNode` should use `extend/partition`.
- `cameraEditor`, `pathTracing`, `pathTracingTransmission` and `bvhCompare`
  need network access to load their models.
