# BVH comparison example

## Purpose

An example page that shows how build options change tree quality and how refit
quality decays during animation. It also checks the module visually. Its
timings are indicative only: `performance.now` is coarsened in browsers, and
GC and other tabs add noise. Performance conclusions come from the Node
benchmark, which runs each configuration in its own process.

## What the cells compare

- Options that change the tree: SAH vs. center splits, bin count, leaf size,
  and refit vs. rebuild every frame during animation. Every cell (slot) has
  its own configuration of these
  options. Clicking a cell selects it, and the panel's slot folder edits the
  selected cell's configuration.
- Recursive and iterative builds produce identical bytes, so they do not get a
  cell. Every label shows both build times and whether the two trees are
  byte-identical.

## Layout

- `cols` and `rows` sliders run from 1 to
  `clamp(floor(canvas.clientWidth / 360), 1, 3)` and
  `clamp(floor(canvas.clientHeight / 240), 1, 3)` CSS pixels. A resize
  recomputes the limits, clamps the values, and recreates the sliders, since
  tweakpane cannot change a slider's range in place.
- **Grid** (default): each cell gets its own viewport and scissor, and the
  camera aspect follows the cell, so every cell shows the whole view (small
  multiples). A full-canvas viewport with per-cell scissors would show each
  cell only its fraction of the view.
- **Wipe**: only with 2 columns and 1 row. The viewport covers the canvas and
  the scissor splits it at a draggable divider, so the two halves line up
  pixel for pixel.
- Thin frames separate the cells; the selected cell has a highlighted frame.
  In wipe mode the divider separates the halves and only the selection frame
  is drawn.
- `setViewport` and `setScissor` take CSS pixels with a bottom-left origin;
  with row 0 at the top, a cell's y is `H - (row + 1) * cellH`.
- An HTML label in each cell shows the slot number, a name generated from its
  configuration, and its key statistics.

## Architecture

- **One renderer.** A single `WebGLRenderer` draws every cell. Several
  renderers would mean several GL contexts and uploads of every model.
- **Layers.** The model, its geometry, and its GPU buffers exist once, on
  layer 0. Slot i's overlays use layer i + 1 (at most 10 of three's 32
  layers). Before drawing a cell, the shared camera sets layer 0 and enables
  layer i + 1. One camera and one `OrbitControls` serve every cell.
- **One worker per unique configuration.** Building, refitting, and queries run in
  module workers, created with
  `new Worker(new URL('./bvhCompare_bvhWorker.js', import.meta.url), { type: 'module' })`.
  Parcel 2 bundles that pattern. Each worker has its own isolate and JIT, so
  configurations build in parallel and their timings stay apart. Slots
  showing the same configuration share its worker and tree, and its overlays
  are enabled on each of their layers. At most
  `min(unique configurations, navigator.hardwareConcurrency - 1)` workers run. A
  configuration beyond that limit is queued and starts when a visible configuration leaves
  the grid and its worker is terminated; its label says so. Workers are
  never reused for another configuration.
- **Files.** `examples/bvhCompare.html` and `examples/bvhCompare.js` (main
  thread), following the one-HTML-one-JS rule for examples. The worker entry
  is `examples/bvhCompare_bvhWorker.js`, used only by this example; it
  documents its message protocol, and `bvhCompare.js` chooses every count it
  uses (probe rays, heat map batch size, timed builds, rebuild threshold) and
  passes them in. `extend/partition` stays plain functions and knows nothing
  about workers. Traversal recording for
  picking is `traceRaycastTriangles` in `queryBVH.js`, and camera rays are
  `setRayFromCamera` in `aabb.js`. The main thread imports only the layout
  constants and readers it needs to draw boxes.
- **Zero-copy messages.** Buffers are transferred both ways. A transferred
  buffer is detached, so data sent to both workers is `slice()`d once first.
  `SharedArrayBuffer` is not used because it needs cross-origin isolation
  (COOP/COEP headers), which GitHub Pages cannot set easily.
- **Timing inside the worker.** Warm up, then report the median of N runs,
  excluding message passing.

## Message protocol (draft)

- `build`: `{ positions, index, buildOptions, animationUpdate, repeats }`,
  transferred. The worker keeps the geometry, because queries and refits need
  it. It returns `{ nodes, nodeCount, stats }`, where `stats` is
  `getBVHStats` plus the `buildMode` used, the median recursive and iterative
  build times, whether the two trees are byte-identical, and nodes visited per
  probe ray.
- `nodes`: the main thread decodes a received node buffer for the box
  overlay and immediately transfers it back. Anything in the worker that
  reads the tree waits until the buffer is home, so the tree is never copied
  and never lost.
- `heatmap`: `{ camera, width, height, region, jobId }`. The worker traces one CPU ray
  per pixel of `region` (an NDC rectangle) and returns a `Uint16Array` of visited-node counts for each batch
  of rows. The main thread writes the batches into a `DataTexture`. Moving the
  camera, changing the layout, or changing a slot starts a new `jobId`. The
  worker yields between batches and abandons a job once a newer one arrives,
  and the main thread drops batches whose `jobId` is stale. Heat maps belong
  to configurations, like trees, so slots with the same configuration share one.
- `refit`, once per animation frame: after `mixer.update`, the main thread
  reads skinned positions with `getVertexPosition` (local space, then
  `matrixWorld`). Bones are read through their `matrixWorld`, so
  `updateMatrixWorld` is enough and no render is needed first. The worker
  refits in place, measures the SAH cost against the value
  right after the last build, and rebuilds above the threshold (default 1.5).
  It returns `{ nodes, stats, refitMs, rebuildMs, rebuilt, sahRatio,
  positions }`. While a reply is outstanding, that configuration skips the frame, so
  at most one request is in flight. Positions alternate between two buffers
  (ping-pong): the reply carries the previous buffer back. The node buffer
  makes its usual round trip. A rebuild may return a buffer of a different
  size, which replaces the old one.

## Visualization modes

- **Boxes.** `LineSegments` based on three-mesh-bvh's `MeshBVHHelper`,
  colored by depth with a non-cycling gradient from depth 0 to the tree's
  deepest level; the slot label shows a legend with both end depths. The
  default shows only the nodes at depth N (plus leaves
  that end above it), like the helper with `displayParents` off; "Up to depth"
  and leaves-only views are also available. Lines are depth-tested against the
  model, so the model hides boxes behind it; a toggle draws them on top
  instead. The slot label shows the depth and the number of boxes drawn.
- **Traversal heat map.** CPU `raycastTriangles` in the worker, one ray per
  pixel, colored by visited nodes. The total budget is fixed at about 256²
  rays, split evenly across the configurations on screen, at the cell's aspect
  ratio. In wipe mode both sides use the full-screen viewport, so each
  configuration only traces the part of the screen on its side of the
  divider, with the budget split by visible area; moving the divider
  re-traces once it stops. It also exercises the module's query code. There is no GPU version
  this round because no shader reads the new layout yet.
- **Pick ray.** Clicking a pixel of the selected cell highlights the nodes its
  ray visited and the triangle it hit; clicking another cell only selects it.
  The pointer is first mapped to its cell and then to NDC
  inside that cell (in wipe mode, NDC of the whole canvas). Every cell shows
  the same view, so the same ray goes to every configuration. This needs the list of
  visited nodes, which `raycastTriangles` does not record. The example adds a
  separate debug traversal in the worker that records it, so the production
  query loop stays unchanged.

## Cell labels

- Build time (median), `buildMode` used, node count, leaf count, maximum
  depth, maximum leaf size, SAH cost, and average nodes visited per ray.
- In animation: refit time per frame, current SAH cost relative to the last
  build, and the number of rebuilds.
- A correctness button that casts a batch of random rays through the BVH and
  by brute force and shows the number of mismatches. The cost is rays ×
  triangles, so the worker checks rays in slices of about 8 ms and yields
  between them; heat map, refit, and pick messages keep being handled. Each
  slot's label shows progress with elapsed and estimated remaining time, the
  button reads "Verifying…" and is disabled until every configuration
  finishes, and a label with mismatches turns red. Each ray is checked within
  one slice, so its two casts always see the same geometry even while the
  model animates. Terminating a worker (configuration change, Rebuild all,
  model switch) drops its check; refits and threshold rebuilds during
  animation do not, since "Rebuild every frame" would otherwise never finish.

## Scenes

- Models load remotely from the three.js examples repository at the pinned
  release, as `examples/cameraEditor.js` does. The model menu shows each
  triangle count:
  - `Xbot.glb` (49k) and `Soldier.glb` (11k): skinned and animated; the run
    or walk clip plays.
  - `DragonAttenuation.glb` (135k, 2 meshes): a static scanned model.
  - `dungeon_warkarma.glb` (72k, 798 meshes): a static scene with large
    differences in object size and much empty space, where SAH and center
    splits differ most.
  - `LittlestTokyo.glb` (142k, 71 meshes, Draco): only some objects move, which
    shows refit decay and the rebuild threshold. Its first clip plays.
  - `nemetona.glb` (320k, Draco): the highest polygon count, for build time and
    the brute-force check's progress.
- Draco meshes are decoded with three's decoder from the same release
  (`examples/jsm/libs/draco/gltf/`). Models needing KTX2 textures
  (`coffeemat.glb`, `CarbonFrameBike.glb`) are left out: they would need a
  `KTX2Loader` and renderer support detection for no extra BVH insight.
- Models without animation clips are not rewritten or refit per frame.
- When a download fails, the page falls back to a generated skinned tube
  (about 25k triangles bent by nine bones), which is also selectable.
- Deferred: a synthetic pathological scene (for example a small, dense teapot
  in a large stadium of long, thin triangles); the Node benchmark's sliver
  data set covers that case.

## Follow-ups outside the example

- The README example list (the generated homepage) gets the new page when this
  work merges to `main`, because `main` has uncommitted README changes.
