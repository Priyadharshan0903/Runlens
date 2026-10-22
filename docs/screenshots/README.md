# UI screenshots

These images show the actual Runlens UI with a small, fictional session library. They contain
no personal history, real project paths, account information, or user annotations.

- `library-light.png` and `library-dark.png`: mixed Claude Code/Codex history and agent selection.
- `session-light.png` and `session-dark.png`: paired questions and agent activity, including commands
  and a recorded file change.

The fixture responses use the normal session API shapes; labels, counts, navigation, and themes are
rendered by the application. The images illustrate the UI, rather than claiming measured results
from someone's real sessions. Update them when changing these views, and check both themes.

Refreshed on 22 October 2026 from the current application build, including the agent-face Runlens
mark. All four captures verified the rendered mark against `ui/assets/runlens.svg`. The landing
page reuses these same demo images.

Captures use a 1440 × 1000 CSS-pixel viewport at 3× device scale, producing lossless 4320 × 3000
PNGs directly from the application. Keep the HTML image dimensions at 1440 × 1000 to preserve
layout while the additional pixels keep text sharp on high-density displays. Capture at the
target density rather than enlarging an existing PNG. The website links every screenshot to a
larger preview with optional zoom.
