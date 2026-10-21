# Working on Runlens

Read `README.md` for setup, behavior, limitations, and the change log.

## Priorities

Readable code, correctness, and performance come first. Code must be easy for people and agents
to extend. Preserve behavior during a refactor and explain any deliberate behavior change.

- Use descriptive names and normal multiline TypeScript/JSX. Run Prettier; do not compress code.
- Keep each component responsible for one part of the workflow. Extract a function or component
  when it has a clear responsibility or removes meaningful duplication, not just to move lines.
- Store user choices and external results in state. Compute filtered rows, counts, and flags from
  their sources. Do not mirror props in state or add effects to synchronize derived values.
- Keep state near its consumers. Group values when they change together; independent choices
  can use separate state. Do not replace many state variables with an unrelated giant object.
- Use refs for request controllers, timers, and DOM references that do not affect rendering.
- Effects synchronize with external systems: network requests, storage, browser events, and DOM.
  Reset state with component identity or an event handler when possible.
- Use `ui/shared/use-resource.ts` for GET request lifecycle, cancellation, debounce, and optional polling.
  Do not add parallel loading/error/refresh flags or retry counters in individual pages.
- Memoize expensive work, not every expression. Avoid walking transcripts, serializing inputs,
  or mounting large tool outputs while a user is typing into an unrelated field.
- Put feature-specific UI in `ui/features`, the application shell in `ui/app`, and genuinely shared
  components/hooks in `ui/shared`. Keep styles grouped by their UI responsibility.
- Use Phosphor's supported `*Icon` exports, not its deprecated compatibility aliases.
- Avoid new runtime dependencies unless there is a demonstrated need. The UI uses Preact.
- Keep README behavior, architecture notes, and the change log current with substantive changes.

## Verification

Use `npm run check` after a coherent change. It checks formatting, types, core/feature tests,
and the production build without starting an HTTP server. Add focused tests for behavior changes.
Do not repeat all checks unless a change or failure justifies it. Browser and live-server checks
are separate; the user is currently handling visual verification.
