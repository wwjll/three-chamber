# BVH comparison example follow-ups

Open items for `examples/bvhCompare.html`, recorded on 2026-11-25. Pick them up
the next time the example is changed. None of them affects the correctness of
`extend/partition`.

## To investigate

- **Leaf threshold on the GPU.** Since 2026-11-25 a node of at most
  `leafThreshold` primitives always becomes a leaf
  ([decision](../decisions/2026-11-25-bvh-leaf-threshold.md)). In Node, SAH
  trees now have about as many nodes as center split and rays visit fewer
  nodes. Still to measure: render time in the path tracer, and whether a
  threshold other than 8 suits it, since a triangle test reads seven
  texels and a node two; and build times for the models in this example.
- **Build crash.** On 2026-11-25 `pnpm run build-examples` ended with a Parcel
  segmentation fault every time it ran in the same script right after
  `pnpm test` (three times, including a docs-only change), while the preview
  service's `parcel serve` was running. Every standalone run (four in total)
  succeeded.
  - Not reproduced on 2026-11-25 in 30 builds of a copy of the worktree:
    test then build, build while `parcel serve` was idle and while it was
    rebuilding after a source change, both with the shared cache and with
    `--cache-dir` for the build, and with the output piped to `grep` and
    `head`. The preview now runs `http-server`, not `parcel serve`, and CI
    runs `pnpm test` and the build as separate steps without a server.
  - `--no-cache` only skips reading the cache: each build still wrote about
    126 MB to the project's `.parcel-cache`, the same LMDB database
    `pnpm start` uses.
  - Piping `parcel build` into `head` makes it exit with code 1 once `head`
    closes the pipe, which reads as a failed build.
  - Proposed: give `build-examples` its own `--cache-dir` so it never shares
    a database with a dev server, write build output to a file in helper
    scripts and grep that file instead of piping into `head`, and if a crash
    comes back, keep the full log and a core dump (`ulimit -c unlimited`)
    before changing the Parcel version.

## Deferred

- A synthetic pathological scene (for example a small dense object inside a
  large sparse one) to widen the gap between split strategies.
