<img src="ui/assets/runlens.svg" width="48" height="48" alt="">

# Runlens

See what your coding agents actually did.

Runlens is a local viewer for **Claude Code and Codex** sessions. Browse conversations, inspect
commands and file changes, follow subagents, and find the step that failed. It reads the history
already on your machine. No API key, model calls, or uploads.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/library-dark.png">
  <img src="docs/screenshots/library-light.png" alt="Runlens session library with Claude Code and Codex labels, project groups, and session filters.">
</picture>

## Get started

Requires **Node.js 20 or newer**.

```sh
npx runlens@latest
```

Or install it globally and launch it whenever you need it:

```sh
npm i -g runlens
runlens
```

Open the local URL printed in your terminal, usually `http://127.0.0.1:8740/`.
To try changes that have not been released to npm, [run from source](docs/usage.md#run-from-source).

Runlens discovers Claude history under `~/.claude/projects`, `CLAUDE_CONFIG_DIR`, and local
`~/.claude-accounts` folders. Codex history comes from `sessions` and `archived_sessions` under
`~/.codex` and `CODEX_HOME`. [Custom folders and CLI options →](docs/usage.md)

## What you can inspect

- **Conversations and timelines:** human questions beside agent answers, with expandable tool calls.
- **File changes and failures:** recorded patches, command output, and failed calls in one session.
- **Subagents:** follow child runs and their tool activity.
- **Search and organization:** search transcripts, pick an agent, group by project or date, and filter the library.
- **Your own context:** pin sessions, rename them, add tags and notes, and export Markdown or JSON.
- **Light and dark themes:** follow the system or choose either theme. Collapse the sidebar for more reading space.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/session-dark.png">
  <img src="docs/screenshots/session-light.png" alt="Runlens timeline pairing a human question with agent tool calls, a file edit, and a final response.">
</picture>

Screenshots use [demo sessions](docs/screenshots/README.md), rendered by the application.

## Try it and check the results

1. Open a Claude Code or Codex session you recognize. Compare its question and response with the original.
2. Choose an agent, then switch between **Project** and **Date**. Check that the right sessions appear.
3. Open a tool call, a recorded file change, or a failed command and check its details.
4. Search for a phrase from that session. Try both themes, pin the session, and add a note.

Found something wrong? [Open an issue](https://github.com/Priyadharshan0903/Runlens/issues/new)
with what you expected, what happened, your Runlens/Node versions, and your OS. Screenshots and
small sanitized examples help. Please remove private transcript content before sharing it.
Questions and suggestions are welcome in issues; code changes are welcome through pull requests.

## Know the limits

- Local transcript formats can change, and some historical records may be unsupported. Cursor is not supported yet.
- Usage and cost appear only when recorded. **Codex tokens cover the main agent only**, so inherited fork usage is not counted twice.
- File changes describe recorded operations, not a final Git diff. A successful tool call does not prove the overall task succeeded.
- Notes and preferences stay in this browser. Transcript files are never changed. [Privacy and measurement details →](docs/usage.md)

## Contribute

```sh
npm install
npm run check
```

The check covers formatting, types, server-free tests, and the production build.
For setup, code layout, and state conventions, read the [development guide](docs/development.md)
and [AGENTS.md](AGENTS.md). New readers follow the [adapter guide](docs/source-adapters.md).

[Usage](docs/usage.md) · [Codex support](docs/codex-sessions.md) ·
[Release workflow](docs/releases.md) · [Changelog](CHANGELOG.md)

## Landing page

The public website has its own static build, separate from the local viewer:

```sh
npm run site:preview
```

Preview at `http://127.0.0.1:8741/`. Run `npm run site:build` to prepare `website-dist/` for
hosting. See [website development](docs/website.md) for content, animation, and deployment notes.

## License

[MIT](LICENSE). Bundled libraries, fonts, and agent artwork retain their licenses in
[third-party notices](THIRD_PARTY_NOTICES.md). Claude and OpenAI marks identify supported agents;
Runlens is an independent project.
