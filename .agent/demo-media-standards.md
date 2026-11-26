# Demo Media Standards

## Browser Captures

- Capture example screenshots and GIFs with an exact browser viewport of 1280
  by 800 pixels.
- Preserve the full viewport in screenshots and every GIF frame; do not crop
  or stretch the capture.
- Store final media in `assets/docs/` and reference those files from
  `README.md`.

## Animated GIFs

- Encode GIFs as an infinite loop and keep the interaction readable at normal
  playback speed.
- Reset the example to a deterministic initial state before recording.

## Updating Media Before a Push

- Before committing or pushing a batch to `main`, list the examples whose
  appearance or interaction changed in the batch, together with their media
  in `assets/docs/`.
- Ask the user whether to recapture the screenshot or record a new GIF for
  each listed example. Wait for the answer before committing.
- Include recaptured media in the same batch and mention it in the change log
  entry.
