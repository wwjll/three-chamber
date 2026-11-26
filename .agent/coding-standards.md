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

## Project Scope

- Focus on engineering and graphics prototype validation.
- Keep features and abstractions small enough to understand and experiment with.
- Avoid detailed production engineering systems unless explicitly requested;
  add only what the prototype needs to demonstrate its behavior.

## Examples

- Each example in `examples/` is exactly one HTML file and one JS file with
  the same base name, for example `bvhCompare.html` and `bvhCompare.js`.
- A worker entry used only by one example sits beside it, named
  `<example>_<name>.js`, for example `bvhCompare_bvhWorker.js`. Do not add
  other source files to `examples/`.
- Reusable code belongs in `extend/` next to the module it serves, written so
  other pages can reuse it. Example-specific settings stay in the example's
  JS file and are passed in.
- Load example models from online sources instead of adding them to the
  repository: the three.js example models at the pinned release
  (`https://raw.githubusercontent.com/mrdoob/three.js/r187/examples/models/gltf/`)
  or the Khronos glTF Sample Assets
  (`https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/`).
  Load Draco decoders the same way, from the pinned three.js release. Only when
  no online model fits, generate geometry procedurally in the example's JS
  file, as `bvhCompare.js` does with its generated tube.

## WSL Workspace Links

- When the repository is opened through a Windows-hosted Codex workspace backed
  by WSL, use Windows UNC paths for clickable file links in responses, for
  example: `\\wsl$\Ubuntu-26.04\home\user\project\src\file.js`.
- Do not use WSL-internal paths such as `/home/user/project/src/file.js` as
  clickable links in the Windows desktop app; the host-side link resolver may
  report that the file does not exist.
- Linux paths remain appropriate for commands executed inside WSL. This rule
  applies specifically to user-facing file links resolved by the Windows app.

## WSL Preview Server

- When developing in WSL, preview built examples at
  `http://localhost:1234/examples/bundle/<example>.html` and use this prefix
  for every preview link given to the user. WSL forwards `localhost` to
  Windows. Do not link the WSL VM IP; it changes when WSL restarts.
- `getAssetURL()` sends `localhost` pages to the asset origin
  `http://localhost:2000/`, so two servers must run: `http-server -p 1234 -c-1
  --cors` at the repository root and `http-server -p 2000 -c-1 --cors` in
  `assets/`, the same asset server `pnpm start` runs.
- Run both as enabled systemd user services so they start with WSL, and enable
  lingering once with `loginctl enable-linger <user>`. This needs
  `systemd=true` under `[boot]` in `/etc/wsl.conf`. Do not use transient
  `systemd-run` units or background shell jobs; they vanish when WSL restarts.
  User services do not load nvm, so `ExecStart` takes absolute paths:

  ```ini
  # ~/.config/systemd/user/three-chamber-preview.service
  [Unit]
  Description=three-chamber example preview on 1234

  [Service]
  WorkingDirectory=/home/<user>/<repo>
  ExecStart=/home/<user>/.nvm/versions/node/<version>/bin/node /home/<user>/<repo>/node_modules/http-server/bin/http-server -p 1234 -c-1 --cors
  Restart=on-failure

  [Install]
  WantedBy=default.target
  ```

  The asset service is the same with `WorkingDirectory` set to
  `/home/<user>/<repo>/assets` and `-p 2000`. Enable both with
  `systemctl --user enable --now <service>`.
- Run `pnpm run build-examples` after changes. The servers disable caching
  (`-c-1`), so a browser refresh loads the new bundle.
- If a link does not respond, WSL may have shut down while idle. Open any WSL
  shell to start it, then check `systemctl --user status <service>`.
