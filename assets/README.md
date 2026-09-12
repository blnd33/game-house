# Supplied identity and references

The user provided two images in the parent workspace:

- `IMG_4432.PNG`: original GH/controller logo and Gaming House wordmark. Byte-for-byte
  copy at `apps/desktop/public/brand/gaming-house-logo.png`; rendered unchanged
  (CSS crops its black padding and blends the black into the sidebar).
- `ChatGPT Image Sep 9, 2026, 10_09_36 PM.png`: library concept, copied to
  `assets/reference/library-concept.png` as the Phase 2 layout reference.

Do not redesign the logo or describe concept games as installed. Original files
remain untouched. The brief is preserved verbatim in `docs/reference/Gaming-House-Codex-Prompt.md`.

## Game artwork

No approved per-game artwork has been supplied, so the UI draws labeled
placeholder covers. To add approved art for a game whose catalog entry has
`artwork_asset: "<asset-id>"` (lowercase letters, digits, `.`, `_`, `-`):

```text
apps/desktop/public/artwork/<asset-id>/cover.jpg   portrait, 3:4 (Steam 600×900 also fits)
apps/desktop/public/artwork/<asset-id>/hero.jpg    wide banner, about 1920×620
```

A missing or unreadable file falls back to the placeholder. Images load from the
app's own files only; remote URLs are never used. Record where each image came
from and that the venue may use it.
