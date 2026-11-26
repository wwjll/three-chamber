# BVH leaf threshold

Replaces the leaf rule in [Generic binned BVH](./2026-11-24-generic-binned-bvh.md).

## Context

`buildBVH` took `maxLeafSize` as an upper bound only. A node that fitted could
still be split whenever the SAH estimate for the split (traversal cost 1,
intersection cost 1.25) was lower than the estimate for a leaf. At that ratio
even a node of two triangles is usually split, so SAH trees had about 3× the
nodes of center split, 1.7 triangles per leaf, built 6–7× slower in the
browser, and probe rays visited no fewer nodes. three-mesh-bvh makes every node
with at most `targetLeafSize` primitives a leaf without consulting SAH, and has
a separate hard cap, `_strictLeafSize`.

## Decisions

- **One option, `leafThreshold`.** It replaces `maxLeafSize`, with the same
  default of 8 (the shader's `MAX_TRIANGLES_PER_LEAF`). A node with at most
  `leafThreshold` primitives becomes a leaf and a larger node is always split,
  so it is both the stopping rule and the cap. Both strategies follow it and
  differ only in where they split.
- **Name.** `leafThreshold` says when splitting stops. `maxLeafSize` only said
  what may not be exceeded, which hid that SAH kept splitting below it. The
  `maxLeafSize` stat of `getBVHStats`, the largest leaf in a tree, keeps its
  name.
- **SAH ranks planes only.** The traversal and intersection costs are no longer
  build options. The node is split whatever the cost, so those terms are equal
  for every candidate, and a candidate costs
  leftArea × leftCount + rightArea × rightCount.
- **Stats keep the cost constants.** `getBVHStats` defaults to traversal 1 and
  intersection 1.25 on its own, so reported SAH costs stay comparable across
  strategies, thresholds, and refits.

## Benchmark

`node test/partition/bench/buildBVH.js --runs 5 --warmup 2 --rays 50000`,
Node v24.22.3, Intel i9-12900H, SAH with 16 bins, threshold 8. Medians, before
→ after. Center split did not change and is shown for reference.

| data | build (ms) | nodes | nodes/ray | query (ms) | refit (ms) | SAH cost |
|---|---|---|---|---|---|---|
| sphere, 320,000 triangles | 679 → 423 | 372,219 → 108,449 | 48.5 → 42.7 | 121 → 110 | 17.1 → 13.4 | 54.6 → 67.5 |
| center split | 96 | 110,999 | 44.8 | 115 | 14.0 | 74.5 |
| Xbot bind pose, 49,112 triangles | 105 → 63 | 56,179 → 16,843 | 19.2 → 16.9 | 37.1 → 37.5 | 4.6 → 2.6 | 18.1 → 23.8 |
| center split | 15 | 17,535 | 18.8 | 41.3 | 2.9 | 27.1 |
| slivers and a dense ball, 200,000 triangles | 528 → 304 | 396,797 → 70,011 | 712.7 → 371.7 | 1280 → 1062 | 26.0 → 14.2 | 312.0 → 442.9 |
| center split | 97 | 71,561 | 382.5 | 1124 | 13.3 | 473.8 |

- SAH builds are 38–42% faster and have 70–82% fewer nodes, slightly fewer
  than center split. Rays visit fewer nodes than before and than center split
  on every data set, and CPU queries are as fast or faster.
- The reported SAH cost rises because the 1 : 1.25 model rewards tiny leaves,
  while the measured query times fall. Compare the stat only between trees
  built with the same threshold.

## Rejected

- Keeping the SAH leaf decision and raising the traversal to intersection
  ratio, for example to 2 : 1: it keeps a second knob whose right value on the
  GPU is unknown, and the threshold rule already gives the smaller tree.
- Two options as in three-mesh-bvh, a target leaf size plus a strict cap, with
  SAH allowed to end larger nodes early: more options for no measured gain.
  Revisit if render times show that larger leaves would pay off.

## Open

- Render time in the path tracer, where a triangle test reads seven texels and
  a node two, is not measured yet. Tracked in
  [docs/todos](../todos/bvh-compare-example.md).
