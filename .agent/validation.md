# Validation

Run validation in tiers. Cheap checks always cover the whole repository;
expensive checks run only when a change can affect what they measure.

## Every Change

- Run `pnpm test`. The complete unit suite runs in under a second, so do not
  select a subset by changed file; contract tests intentionally span modules.
- Run `pnpm run lint`.
- Revisit this tier only if the suite grows beyond roughly ten seconds.

## Scoped Checks

- Changes under `examples/`, page entry points, or bundling configuration:
  run `pnpm run build-examples`.
- Shader or rendering changes: also follow
  [Required Validation for Path Tracer Changes](./path-tracer-roadmap.md#required-validation-for-path-tracer-changes).
- Before merging a change that affects rendering, run every applicable scoped
  check once more on the final revision.

## Continuous Integration

- The project works directly on `main` without other branches.
  `.github/workflows/deploy.yml` runs lint, tests, the Pages build and the
  deployment on every push to `main`. A manual run deploys only from `main`.
- CI reads the Node version from `.nvmrc` and the pnpm version from the
  `packageManager` field. Change those two sources instead of the workflow.
- Local Node is managed with nvm; run `nvm use` in the repository root.
