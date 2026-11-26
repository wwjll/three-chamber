# Generic binned BVH

## Context

The path tracer built its BVH inside `SceneGenerator` from per-triangle
`Triangle` and `BVHNode` objects, and the result could only be used by the path
tracer. The renderer stays on WebGL for now. This round replaces only the BVH,
as a module that other features (picking, light BVHs, animated geometry, a
later WebGPU renderer) can share.

## Credits

Much of this design comes from
[three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh) by Garrett
Johnson. Ideas taken from it:

- The packed 32-byte node: depth-first order with the left child right after
  its parent, the right child as an offset relative to the node, and a leaf
  flag with a 16-bit primitive count in the last word. The word order here is
  rearranged to match a WGSL struct.
- Binned SAH with its cost constants (traversal 1, intersection 1.25) and,
  since 2026-11-25, its rule that a node within the leaf size becomes a leaf
  ([BVH leaf threshold](./2026-11-25-bvh-leaf-threshold.md)).
- An indirect primitive buffer instead of reordering the geometry, and
  refitting node bounds for animated meshes.
- The bounding box display of its `MeshBVHHelper`, used by
  `examples/bvhCompare.html`.

Where this module differs from three-mesh-bvh, the reason is recorded under
Rejected.

## Decisions

- **Location.** `extend/partition/` with no three.js or path tracer
  dependency: `aabb.js`, `triangles.js`, and `bvh/` (`BVHLayout.js`,
  `buildBVH.js`, `refitBVH.js`, `queryBVH.js`, `packBVHs.js`). Spatial
  structures other than the BVH get sibling directories when they are needed;
  none are reserved now.
- **Node encoding.** 32 bytes per node in one `ArrayBuffer`, read through
  `Float32Array` and `Uint32Array` views. Bounds min in words 0-2 and max in
  words 4-6. Word 3 is the right child relative to the node, or the leaf's first
  primitive entry relative to its tree. Word 7 holds flags: bit 31 marks a leaf,
  leaf bits 0-15 hold the count, and internal bits 0-1 hold the split axis.
  Nodes are depth first with the left child at `node + 1`. The layout matches
  the WGSL struct `{ vec3f, u32, vec3f, u32 }`, and relative offsets let a tree
  be copied anywhere in a packed buffer.
- **Primitive bounds.** The public API takes `[min.xyz, max.xyz]` per
  primitive as a `Float32Array`, and the build works on a copy in the same
  format. Centroids are `min + max`, twice the true centroid; bin origins and
  scales use the same units, so the 0.5 cancels and the only division is one
  per node and axis. See the benchmark below for why the center plus half
  extent format was removed.
- **Indirect only.** The build returns `primitiveIndices` and never reorders
  the caller's geometry. Consumers that need locality, such as GPU triangle
  textures, write primitives in leaf order themselves.
- **Build mode.** `buildMode: 'auto' | 'recursive' | 'iterative'`, default
  `auto`. Both builders produce byte-identical output. `auto` compares the
  worst-case depth `min(maxDepth, primitiveCount - 1)` with
  `recursionDepthLimit` (default 1000) once at entry. With the default
  `maxDepth` of 64 it always recurses, so the explicit stack is a fallback.
  An explicit mode is always honoured for benchmarks. The result reports the
  mode used.
- **Defaults.** SAH with 16 bins, `maxLeafSize` 8 (the shader's
  `MAX_TRIANGLES_PER_LEAF`), `maxDepth` 64, traversal cost 1, intersection
  cost 1.25. `strategy: 'center'` is the quick-preview alternative. The
  leaf rule and the build's use of the cost constants were replaced on
  2026-11-25, see [BVH leaf threshold](./2026-11-25-bvh-leaf-threshold.md).
- **Several trees.** `buildBVH` keeps no global state, so callers build as
  many trees as they need and choose how to split them (static and animated
  together or apart, lights). `packBVHs` concatenates trees into one node
  buffer with a root table and returns per-tree views. Queries take their
  stack, ray, and hit buffers from the caller, so a top-level traversal can
  traverse a nested tree inside its callback.
- **Animation.** Refit on the CPU from `mesh.getVertexPosition`, which applies
  morph targets and skinning and returns local-space positions (multiply by
  `matrixWorld`). Call it after the mixer update and `updateMatrixWorld`.
  Rebuild when the refit SAH cost exceeds about 1.5 times the cost right after
  the last build. Morph normals are out of scope this round. GPU skinning and
  GPU refit wait for the WebGPU renderer.
- **Path tracer integration.** `SceneGenerator` uploads the node buffer
  unchanged as an RGBA32UI texture, two texels per node, instead of
  translating it into the old four-texel float format. Integer texels keep the
  offsets and flags exact; small integers stored in float texels would be
  denormals, which some GPUs flush to zero. The shader converts bounds with
  `uintBitsToFloat`. Triangles are written to the triangle texture in leaf
  order. Skinned normals use the same bone matrices as positions, applied
  with w = 0 as in the three.js `skinnormal_vertex` chunk. The remaining
  traversal gaps are tracked in
  [docs/todos](../todos/bvh-shader-compatibility.md) and fixed when the shader
  is next changed.

## Benchmark: primitive bounds formats

`pnpm run bench:partition` (`test/partition/bench/buildBVH.js`) runs every
case in its own Node process; the format comparison below was run with the
version that still had both formats. Node v24.22.3, Intel i9-12900H, 11 runs
after 3 warm-ups, `maxLeafSize` 8. Build times in ms (median), including the
conversion to center plus half extent for `center`.

| data | configuration | minmax before fix | minmax | center |
|---|---|---|---|---|
| sphere, 320,000 triangles | SAH 8 bins | 641 | 589 | 588 |
| | SAH 16 bins | 782 | 680 | 694 |
| | SAH 32 bins | 1082 | 884 | 912 |
| | center split | 101 | 100 | 101 |
| Xbot bind pose, 49,112 triangles | SAH 16 bins | 120 | 106 | 105 |
| | SAH 32 bins | 163 | 135 | 136 |
| slivers in a box around a dense ball, 200,000 triangles | SAH 16 bins | 579 | 526 | 523 |
| | SAH 32 bins | 776 | 657 | 655 |

- The first run made `center` look 8-19% faster on SAH builds. The cause was
  the `minmax` bin loop calling the shared `expandBounds` for every primitive;
  writing that update out in the loop removed the gap ("minmax before fix" vs.
  "minmax"). After the fix the formats are within 3% of each other, mostly
  inside each other's p10-p90 range.
- Tree quality is the same: equal SAH cost and nodes visited per ray in every
  case. Query and refit times do not depend on the format.
- `minmax` stays because it is as fast, needs no conversion pass, keeps node
  bounds exact unions of the input, and needs no epsilon padding.

## Rejected

- Center plus half extent primitive bounds (three-mesh-bvh's build format):
  no faster than `minmax` once the bin loop was fixed, and it adds a
  conversion pass and epsilon-padded, inexact node bounds.
- Reordering the caller's index buffer in place, three-mesh-bvh's default
  mode: it ties the module to one geometry layout.
- Absolute child indices: packing several trees would require rewriting them.
- A balanced depth estimate such as `log2(n / maxLeafSize)` for `auto`: SAH
  splits can be very uneven, so it underestimates.
- Moving BVH building to a compute shader now: the renderer is still WebGL.
