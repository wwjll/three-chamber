# Path Tracer Roadmap

This document records the current path tracer baseline and the ordered work
needed to improve correctness, observability, convergence, and maintainability.

## Current Baseline

- The integrator uses pure BSDF path sampling without NEE or MIS.
- Each path-loop iteration performs one scene intersection. The next ray is not
  intersected eagerly and then intersected again on the following iteration.
- `BSDFSample` returns direction, weight, PDF, event flags, and validity as one
  contract.
- Diffuse and GGX sampling use the same mixture weights in sampling and PDF
  evaluation. Invalid GGX reflections remain zero-contribution null events.
- Environment and surface emission evaluation are isolated behind light
  interfaces.
- Russian roulette starts after depth three and compensates surviving paths.
- Biased HDR, throughput, and sample-contribution clamps have been removed.
- GPU scene layout constants are shared by CPU encoders and shader generation.
- `SceneCompiler`, `GpuSceneEncoder`, and `CompiledScene` separate scene
  compilation, encoding, ownership, and rendering concerns.
- Scene geometry is normalized to finite Float32 position, normal, and UV data
  before it is merged and encoded.
- Deterministic tests cover BSDF/PDF consistency, GPU layout contracts, compiler
  ownership, finite scene buffers, and light interfaces.

## Guiding Principles

- Establish estimator correctness before optimizing variance.
- Diagnose rare high-energy samples instead of hiding them with biased clamps.
- Keep BSDF sampling, evaluation, and PDF logic under one testable contract.
- Keep light sampling, evaluation, and PDF logic under one testable contract.
- Measure performance before replacing a correct implementation.
- Do not reintroduce MIS until both participating sampling techniques are
  independently correct and covered by tests.

## P0: Integrator Diagnostics

- Add debug outputs for path length, BSDF event type, sample PDF, throughput,
  and per-sample contribution.
- Add explicit non-finite detection for ray data, surface data, BSDF results,
  throughput, and accumulated radiance.
- Add a diagnostic mode that identifies the bounce at which a non-finite or
  extreme value first appears.
- Keep diagnostics separate from production radiance so they cannot silently
  change the estimator.

### Acceptance Criteria

- A problematic pixel can be traced to a bounce, event type, PDF, and
  contribution without modifying the estimator.
- Reference scenes produce no NaN or Infinity values.

## P0: Shading Normals and Ray Spawning

- Define the responsibilities of geometric normals and shading normals in one
  surface-frame helper.
- Add a mathematically justified shading-normal correction for reflection.
- Validate the correction at grazing angles and with strong normal maps.
- Offset new ray origins to the side selected by the outgoing direction.
- Replace the fixed world-space epsilon with a scale-aware offset strategy.
- Cover front-facing, back-facing, and double-sided geometry.

### Acceptance Criteria

- Strong normal maps do not create non-finite or unbounded path weights.
- Outgoing rays do not self-intersect or start on the wrong side of thin
  double-sided geometry in the reference scenes.
- White-furnace tests remain energy bounded across supported roughness values.

## P0: Reference Scene Tests

- Add deterministic procedural scenes for a Lambert surface under a constant
  environment, a mirror under a directional environment, an emissive surface,
  and a white-furnace material test.
- Add a grazing-angle normal-map scene that targets shading-normal regressions.
- Run tests with a fixed random seed, resolution, camera, bounce limit, and
  sample count.
- Check finite output, mean luminance, maximum luminance, and selected pixel
  ranges instead of relying only on screenshots.
- Add a GPU execution test so GLSL behavior is tested in addition to the
  JavaScript numerical reference.

### Acceptance Criteria

- Test thresholds are derived from analytic results or a documented reference
  renderer.
- Failures distinguish estimator regressions from ordinary Monte Carlo noise.

## P1: BSDF Lobe Architecture

- Split diffuse, GGX reflection, sheen, subsurface approximation, and clearcoat
  into explicit lobe evaluation, PDF, and sampling functions.
- Derive the total BSDF and total PDF from the same lobe weights.
- Add direct clearcoat sampling instead of relying on diffuse hemisphere
  coverage for that lobe.
- Make event flags precise enough to identify diffuse, glossy, delta,
  reflection, and future transmission events.
- Add energy and reciprocity checks over representative material parameters.
- Add transmission and refraction only after the reflection contract is stable.

### Acceptance Criteria

- Every enabled non-delta lobe has matching evaluation, sampling, and PDF code.
- Mixture tests cover normal incidence, grazing incidence, low roughness, high
  metalness, and clearcoat-heavy materials.

## P1: Scene Compiler Decomposition

- Extract mesh collection, material registration, geometry normalization,
  triangle storage, BVH construction, and GPU packing from `SceneGenerator`.
- Replace per-triangle `Vector2` and `Vector3` object graphs with flat typed
  arrays.
- Introduce explicit encoded-buffer schemas and validate the layout version when
  a `CompiledScene` is bound to a `PathTracer`.
- Detect BVH depth that can exceed the shader traversal stack instead of
  silently dropping nodes.
- Benchmark the current median split against a binned SAH builder before
  changing the default.
- Move expensive compilation to a worker with progress reporting and
  cancellation.
- Add explicit support policies for instancing, skinning, morph targets, and
  dynamic transforms.
- Separate material-only updates from full geometry and BVH rebuilds.
- Replace maximum-resolution texture-array expansion with a documented texture
  packing or resampling policy.

### Acceptance Criteria

- Compiler stages can be tested independently without constructing a renderer.
- Large-scene compilation records wall time, peak memory, triangle count, node
  count, BVH depth, and encoded texture sizes.
- Cancelling or replacing a compile releases all temporary and owned resources.

## P1: Lifecycle and Loading

- Dispose replaced model geometry, materials, and source textures in the demo.
- Dispose assets produced by stale asynchronous load requests.
- Make ownership of source textures, texture arrays, environment textures, and
  compiled data textures explicit.
- Keep disposal idempotent across scene replacement and application shutdown.

## P2: Variance Measurement and Adaptive Sampling

- Accumulate first and second moments so per-pixel variance can be estimated.
- Add a variance visualization mode and convergence statistics.
- Use variance to guide adaptive sampling only after the estimator tests pass.
- Evaluate denoising as a presentation layer that does not modify accumulated
  unbiased radiance.
- Do not use undocumented radiance or throughput clamps as a noise solution.

## P2: NEE and MIS

- Add environment importance sampling with a distribution proportional to
  luminance multiplied by the spherical `sin(theta)` measure.
- Add emissive-triangle or area-light sampling with explicit area-to-solid-angle
  PDF conversion.
- Add transparent-aware visibility rays.
- Apply the same MIS heuristic to light-sampled contributions and BSDF paths
  that hit an emitter or the environment.
- Handle delta events without evaluating incompatible PDFs.
- Test constant environments, concentrated HDR emitters, small area lights,
  glossy materials, and occlusion before enabling MIS in the demo.

### Acceptance Criteria

- Enabling MIS changes variance but not the converged mean within documented
  statistical tolerance.
- Every MIS weight is computed from all active techniques that could have
  generated the sampled path.

## P2: Performance Measurement

- Add repeatable compile-time and render-time benchmarks.
- Measure BVH traversal cost, intersections per path, average path length,
  texture bandwidth, and time per accumulated sample.
- Compare changes at fixed scene, camera, resolution, bounce count, and sample
  count.
- Keep optimization changes only when they preserve reference-scene results.

## Required Validation for Path Tracer Changes

- Run `pnpm run test:path-tracing`.
- Run ESLint for the modified path tracer and test files.
- Run a production Parcel build for `examples/pathTracing.html`.
- Check generated shader assembly when shader modules change.
- Run the deterministic browser smoke test for visible rendering, progressive
  sample growth, and console errors.
- Document any expected statistical or visual change in this roadmap or the
  relevant test.
