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
out of `dist/` and the npm package. The separate, manually triggered GitHub Pages workflow
publishes only `website-dist/`.

Screenshot filenames include their content hash. HTML and interactive screenshot choices use the
same generated paths; changing an image creates a fresh URL. The stylesheet, script, and icon also
carry a build version so updated previews do not depend on reusing cached branding or images.

## Deploy to GitHub Pages

The workflow is [Deploy website to GitHub Pages](../.github/workflows/deploy-pages.yml).
It runs only through `workflow_dispatch`; pushes, merges, and npm releases do not deploy the site.

1. Merge the workflow and website changes into the default branch (`master`) so GitHub shows
   the **Run workflow** button.
2. In the repository's **Settings → Pages → Build and deployment**, select **GitHub Actions**
   as the source. This is a one-time setup.
3. Open **Actions → Deploy website to GitHub Pages → Run workflow**, choose `master`, and run it.
   The selected branch's checked-out commit supplies the website content. Other branches must
   also satisfy any deployment rules on the `github-pages` environment.
4. Open the URL reported by the deployment job. Without a custom domain, the expected address is
   `https://priyadharshan0903.github.io/Runlens/`.

The build job uses Node 24, `npm ci`, the full `npm run check:ci`, and `npm run site:build`.
It uploads the static output only after checks pass. The dependent deployment job uses the
`github-pages` environment with Pages and OIDC permissions; no personal access token or npm
credentials are needed. Deployment runs share one concurrency group without cancelling an active
deployment. Run the workflow again whenever you want to publish an updated site.

This follows GitHub's [custom Pages workflow guidance](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

## Files and interactions

- `website/index.html`: readable page content, viewer installation, MCP preview setup, external links, and FAQ.
- `website/styles.css`: monochrome tokens, responsive layouts, folder-shaped surfaces, and control transitions.
- `website/main.ts`: screenshot previews, walkthrough selection, clipboard feedback, scroll entrances, and gentle hero movement.
- `website/mcp-walkthrough.ts`: synthetic MCP search/summary/verification walkthrough, stage selection, and reduced-motion transitions.
- `website/screenshot-preview.ts`: native image dialog, zoom, Escape dismissal, and full-image link fallback.
- `website/footer-traces.ts`: decorative run-trace packets, paused outside the footer or when the document is hidden.
- `website/hero-traces.ts`: three quieter traces routed around the hero text toward the product preview, updated on resize.
- `website/trace-motion.ts`: shared packet playback, path sampling, visibility, and reduced-motion handling.
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
The hero introduces the same motif with three paths and slower, fainter packets. Routes follow the
open space above and between the columns, then turn toward the preview; narrow layouts keep them
along the perimeter. Resize observation updates path coordinates and packet keyframes without a
continuous JavaScript animation loop. Hero and footer playback pause independently when offscreen.
The hero artwork is optional: without JavaScript the content and controls retain their layout.
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

MCP copy follows the source preview in `src/mcp/` and [MCP setup](mcp.md), with later candidates
originally tracked in Foglio FOG-79 through FOG-83. The dedicated `#mcp` section includes a preview
build, copyable Claude Code/Codex commands, a question to try, fixed project-scope behavior, and
provider exposure. It uses `"$PWD"` at registration so visitors need not type their project path.
Claude uses local scope for private machine-specific configuration. Copy feedback appears in the
same section, with manual selection if clipboard access fails. Commands remain readable without JS.

MCP is not published to npm. The main setup explains the intended one-command npm registration,
clearly marked as unavailable until a release containing MCP ships. Developer build/CLI-path setup
is in an optional source-preview disclosure and is the only path available today. The page
distinguishes available search/recorded-summary tools
from future change/failure/active-session ideas. There is no announced date. Potential Cursor MCP
compatibility does not mean Runlens reads Cursor history.

The interactive MCP walkthrough at `#mcp-walkthrough` replaces the static example question.
Navigation calls the overview **MCP**, with a separate **MCP setup** link to the commands;
the hero preview links to **For your agents** rather than presenting the source preview as future work.
Visitors can select Search, Read, or Verify, follow the next/replay button, and copy the question
for their connected agent. The displayed matches, dates, recorded answer, edit counts, failure
metadata, and continuation offset were checked by running `HistoryService` against the synthetic
`tests/mcp-fixtures.ts` history. It presents selected fields rather than a complete protocol response.
The verification panel suggests a new investigation; it does not claim an agent performed it.
The page makes no MCP, model, or transcript requests. Without JavaScript all three stages remain
readable; with reduced motion, switching stages does not animate. The hero/footer traces are unchanged.

## Verification

Run `npm run check` for formatting, shared TypeScript checking (including `website/`), the existing
core/feature tests, and the viewer build. Run `npm run site:build` separately to check the website's
bundling and assets. Review the preview on laptop and desktop, then check narrower widths, keyboard
focus, light/dark screenshot selection, all walkthrough choices, viewer/MCP copy buttons, disclosures,
and reduced motion. Browser verification is separate from the server-free project check.
