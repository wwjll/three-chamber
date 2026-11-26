# Todos

Known problems and follow-up work that is deliberately left for later. Each
file covers one area, records what the code does today and why it matters, and
says when the item should be picked up. Delete an item, or the whole file, once
the change that resolves it lands, and mention it in that change's
`docs/changes` entry.

## Open

- [BVH and the path tracing shader](./bvh-shader-compatibility.md): limits and
  format gaps between `extend/partition` and the WebGL traversal in
  `extend/path-tracing/shaders`.
- [BVH comparison example follow-ups](./bvh-compare-example.md): the leaf
  threshold's effect on render time, a build crash to investigate, and
  deferred scenes for `examples/bvhCompare.html`.
