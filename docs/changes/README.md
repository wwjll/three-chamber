# Change Log

## Entries

- [2026-11-26 · Add a generic BVH, path tracing transmission and README example GIFs](./2026-11-26-generic-bvh-and-transmission.md)
- [2026-11-23 · Upgrade three to r187, add CI checks and path tracing diagnostics](./2026-11-23-three-r187-upgrade.md)

## Adding an entry

- Add one entry per push to `main`. Group all commits in that push into the
  same entry.
- Name the file `YYYY-MM-DD-topic.md` using the date the batch lands on `main`
  and a short, lowercase English topic. Add it to the top of the index.
- Keep the commit subject short. Put the entry's repository path in the body
  of the last commit in the push.

## Entry template

    # Short change summary

    ## Motivation

    Explain why the batch was needed.

    ## Changes

    - Group related changes by feature or subsystem.

    ## Validation

    - Record the checks run and their results.

    ## Compatibility and migration

    Describe any action readers need to take. Omit this section when it does
    not apply.
