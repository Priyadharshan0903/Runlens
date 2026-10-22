# Runlens website

The monochrome landing page lives in `website/`. It is independent of `ui/`, the local session
viewer. It has no backend, transcript access, analytics, external fonts, or new dependencies.

```sh
npm install
npm run site:preview
```

Open `http://127.0.0.1:8741/`. The preview binds to loopback and fails if that port is occupied.
Reuse an existing healthy preview when available. Stop it with Ctrl+C. CSS and TypeScript changes
rebuild automatically; restart after HTML or screenshot changes. The preview uses the existing
esbuild development dependency and is not a production server.

```sh
npm run site:build
```

This writes a self-contained static website to `website-dist/`, including the HTML, bundled
CSS/JavaScript, local Geist fonts, favicon, demo screenshots, and license notices. All asset links
are relative so the output can be hosted below a GitHub Pages repository path. The website stays
out of `dist/` and the npm package. No deployment workflow is added yet. A later GitHub Actions
workflow can run `npm ci`, `npm run check`, and `npm run site:build`, then publish `website-dist/`.

Screenshot filenames include their content hash. HTML and interactive screenshot choices use the
same generated paths; changing an image creates a fresh URL. The stylesheet, script, and icon also
carry a build version so updated previews do not depend on reusing cached branding or images.

## Files and interactions

- `website/index.html`: readable page content, install commands, external links, FAQ, and planned MCP section.
- `website/styles.css`: monochrome tokens, responsive layouts, folder-shaped surfaces, and control transitions.
- `website/main.ts`: screenshot previews, walkthrough selection, clipboard feedback, scroll entrances, and gentle hero movement.
- `website/screenshot-preview.ts`: native image dialog, zoom, Escape dismissal, and full-image link fallback.
- `website/footer-traces.ts`: decorative run-trace packets, paused outside the footer or when the document is hidden.
- `website/footer-layout.ts`: aligns the desktop footer arrow and navigation with the existing SVG trace coordinates.
- `scripts/build-site.mjs`: static asset copying, build, and loopback preview.

The install commands remain selectable without JavaScript. Script-only controls are hidden until
initialized; the walkthrough exposes all its content without scripts. Copy buttons select the
command and explain manual copying if clipboard access fails. Screenshot choices work with click,
keyboard, or mouse hover; walkthrough choices use native buttons. FAQs use native disclosures.
The product-preview section includes three native disclosures about finding a familiar fix,
reviewing an unexpected change, and carrying session context into a handoff. These illustrative
scenarios explain practical benefits using existing features; they are not customer quotations.
They work with click, keyboard, and without JavaScript.

Motion uses transforms and opacity, runs entrances once per element, and schedules hero movement
only after scrolling. `prefers-reduced-motion` removes travel, smooth scrolling, and transitions;
changing that preference also cancels running Web Animations. Reading never waits for an animation.
The footer adds branching monochrome traces behind the wordmark. Only small packets animate;
reduced motion leaves the static paths and removes the packets. All background artwork is
decorative and hidden from assistive technology.
The original branching paths run across a full-width, full-height `.footer-signature` stage with
the wordmark centered over them. Keep this stage taller than the wordmark so the animation retains
its original spread. On desktop, the closing copy moves down 60px, the arrow meets the upper-right
lane, and the license/navigation row sits between the lower two lanes. The independent-project
notice stays below the field. Resize observation maps SVG coordinates into the rendered layout;
smaller viewports keep the copy and links in normal flow.

## Content and assets

The product capabilities follow README and the usage guide. Product pictures are the sanitized
demo screenshots documented in [screenshots/README.md](screenshots/README.md). Refresh them after
branding or interface changes; never capture personal sessions for this public website. The
walkthrough illustrates the same demo search-cancellation session, not a user result or product benchmark.
The header and favicon both use `ui/assets/runlens.svg` so branding stays in sync with the viewer.
Product screenshots are captured directly at 3× pixel density. The privacy section preserves the
complete library image, including its sidebar and controls. Every screenshot opens in a native
dialog with zoom and keyboard dismissal; without JavaScript, its link opens the full PNG instead.

MCP copy was checked against Foglio's Runlens tasks FOG-79 through FOG-83 on 22 October 2026.
It distinguishes the planned safety contract, bounded search/summary tools, and client guidance
from later candidates. MCP is not implemented or advertised as currently available. Do not add a
launch date or a runnable MCP command before the actual contract ships. In particular, potential
Cursor MCP compatibility does not mean Runlens reads Cursor history.

## Verification

Run `npm run check` for formatting, shared TypeScript checking (including `website/`), the existing
core/feature tests, and the viewer build. Run `npm run site:build` separately to check the website's
bundling and assets. Review the preview on laptop and desktop, then check narrower widths, keyboard
focus, light/dark screenshot selection, all walkthrough choices, both copy buttons, FAQ disclosure,
and reduced motion. Browser verification is separate from the server-free project check.
