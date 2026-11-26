# BVH and the path tracing shader

`SceneGenerator.js` builds the path tracer's BVH with `extend/partition` and
uploads the 32-byte nodes unchanged as two RGBA32UI texels per node (GPU scene
layout version 2). `getBVHNode` in `shaders/utils.glsl.js` reads them with
`uintBitsToFloat`, takes the left child as `node + 1` and the right child from
the relative offset, and reads the leaf flag and count from the flags word.
Triangles are written in leaf order, so a leaf's primitive offset is its first
triangle slot. The items below are still open. Fix each one when the shader
code it names is next changed, not before.

## Traversal limits drop hits silently

- `hitBVH` stops after `MAX_BVH_STEPS` (512) popped nodes. On a large or badly
  split scene, the loop can end before the closest hit is found, and the ray
  returns a farther hit or a miss.
- A push to a full stack (`STACK_SIZE` 128) is skipped
  (`if(sp < STACK_SIZE)`), so whole subtrees vanish.
- The builder caps depth at `maxDepth` (64), so a stack of `maxDepth + 1`
  entries is always enough. That bound only holds when a node is replaced by
  its two children, as `queryBVH.js` does.
- To do: size the stack from the build's `maxDepth`. Count the cases that hit
  the step limit in the diagnostics, then raise the limit or remove it once
  ANGLE allows.

## Triangle indices stored as floats

- BVH nodes are integers now. Triangles are still fetched with
  `getTriangle(float(i))`, whose texel index `8 * i` is computed in float, and
  the material index is a float texel.
- These are exact while the texel index stays at or below 2^24. A 512-wide
  texture reaches 2^24 texels at 32768 rows, so the row limit is hit first.
  `PathTracer.setDataTexture` throws when a texture needs more rows than
  `maxTextureSize`. With 16384 rows, that is about 1.05M triangles.
- To do: compute triangle texel coordinates with integers, as `getBVHNode`
  does, when the triangle fetch is rewritten.

## Children are fetched and tested twice

- For each internal node, `hitBVH` fetches both children and runs `hitAABB`
  on them before pushing. When a child is popped, it is fetched and tested
  again.
- Pushing does not depend on distance (left first, so right pops first), so
  traversal is not near-first.
- To do: either push the children unconditionally and test on pop, or keep
  the pre-test and push the farther hit child first. The split-axis bits in
  the flags word give a cheap near-first order without distances (see
  `pushChildren` in `queryBVH.js`).

## Triangle fetch and shading cost

- `getTriangle` reads seven texels: positions, normals, UVs, and the
  material, for every triangle tested.
- `hitTriangle` computes the normal, UV, and tangent frame for every hit that
  is closer than the current one, not only for the final hit.
- To do: split positions into their own texture (three texels, or a packed
  float32 position buffer). Record only the triangle index and barycentrics
  during traversal, and shade the closest hit once after `hitBVH` returns.

## Several trees

- `packBVHs` packs trees into one node buffer plus a root table
  (`nodeOffset`, `primitiveOffset`). The shader traverses one tree rooted at
  node 0, and leaf offsets are used directly as triangle slots.
- WebGL can keep a single tree for this round. When several trees are needed
  (a static scene plus animated objects, or a light BVH), either loop over the
  roots and test each root box with a shared closest distance, or build a
  small top-level BVH over the root boxes. Each tree then adds its
  `primitiveOffset` to its leaf offsets.
- Triangles must be written in each tree's leaf order, starting at its
  `primitiveOffset`, so there is no indirection on the GPU.

## Animated geometry uploads everything

- A refit only changes node bounds, and for animated meshes, triangle
  positions and normals. With `DataTexture.needsUpdate`, three.js uploads the
  whole texture.
- To do: upload only the changed tree's node range and triangle range, using
  `texSubImage2D` in WebGL or `writeBuffer` in WebGPU. If upload time matters
  before then, keep animated objects in their own textures.
