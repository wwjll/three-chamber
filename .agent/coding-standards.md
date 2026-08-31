# Coding Standards

## Comment Language

- All code comments and documentation comments must be written in English.
- This rule applies to source files, shaders, tests, scripts, and configuration
  files.
- Translate a non-English comment when modifying the surrounding code.
- User-facing documentation may use another language when the intended audience
  requires it.

## Comment Quality

- Explain intent, invariants, mathematical reasoning, and non-obvious tradeoffs.
- Do not restate code that is already self-explanatory.
- Keep terminology consistent with the identifiers and APIs used by the code.

## Simplicity and Trust

- Trust documented platform APIs, library contracts, and project-internal
  invariants. Do not add speculative guards for states those contracts exclude.
- Do not use redundant `typeof`, `Number.isFinite`, method-existence, or similar
  checks around values whose types are already established.
- Prefer default parameters, destructuring, optional chaining, and nullish
  coalescing over fallback wrappers and repeated validation.
- Validate values once at genuine boundaries such as user input, persisted data,
  external assets, and numerical algorithms that can produce non-finite values.
- Fail clearly when a required contract is violated instead of silently coercing
  an invalid value into a default.
- Extract a helper only when it names a meaningful concept or removes substantial
  duplication. Keep one-line expressions inline when they remain readable.
