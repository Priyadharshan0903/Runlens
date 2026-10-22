# Publishing Runlens

`.github/workflows/ci.yml` checks pushes to `master`, pull requests, and manual runs on Ubuntu
with Node 22 and 24. It installs the locked dependencies, checks formatting and types, runs the
complete test suite (including HTTP server tests), builds, and verifies a clean package installation.
The normal local `npm run check` continues to avoid starting a server.

The installation check packs the built files, installs the archive outside the checkout, runs the
installed `runlens --help` and `--version` commands, and checks the shipped UI and referenced fonts.
It also rejects transcript/environment filenames in the archive. This check does not open the UI,
read local sessions, or start a server. To run it after building:

```sh
npm run test:package
```

`.github/workflows/publish.yml` runs when a `v*` tag is pushed, or through **Actions → Publish
release → Run workflow**. It replaces the old draft-only `release.yml` workflow.

1. Check that a pushed version tag matches `package.json`, then run the full checks on Node 24.
2. Build, install-test, and retain the `.tgz` package and `SHA256SUMS`.
3. Verify the downloaded archive's checksum and publish that exact archive to npm using OIDC
   trusted publishing and provenance. Stable versions use `latest`; prereleases use `next`.
4. Publish the GitHub release immediately, with generated notes and the same archive/checksum
   attached. There is no draft or separate Publish button. Prereleases are marked accordingly.

The publish command uses `./release/*.tgz`: the leading `./` makes the expanded archive path
explicitly local. Without it, npm can interpret `release/runlens-<version>.tgz` as GitHub shorthand
and attempt an SSH clone. See [npm package specifiers](https://docs.npmjs.com/cli/v11/using-npm/package-spec).

Configure npm **runlens → Settings → Trusted Publisher → GitHub Actions** once, with owner
`Priyadharshan0903`, repository `Runlens`, and workflow filename `publish.yml`. Permit direct
`npm publish` if npm shows an allowed-actions setting. The workflow uses Node 24 and npm 11,
with `id-token: write` restricted to the npm publishing job; no npm token secret is needed.
See [npm's trusted publishing documentation](https://docs.npmjs.com/trusted-publishers/).

For each release, commit your changes first, then bump the package version and push its commit/tag:

```sh
npm version patch
git push origin master --follow-tags
```

For example, bumping `0.1.2` creates `0.1.3` and tag `v0.1.3`. `npm version` updates both
`package.json` and the lockfile. npm versions cannot be overwritten. Alternatively, update and
commit both files yourself, push the changes, and run the workflow manually on that commit.
The workflow publishes only when invoked by a version-tag push or a manual run; ordinary commits
continue to run CI without releasing.

GitHub publication waits for npm publication to succeed. If the final GitHub job fails after npm
succeeds, use **Re-run failed jobs** to retry that job without publishing the npm version again.
Do not rerun the whole successful npm publication for the same version. GitHub and npm are separate
services, so the workflow cannot roll back an npm publication if GitHub publication fails.

The workflows use pinned action commits. CI and packaging have read access; only the final GitHub
job gets release write access. Checked workflow artifacts are retained for 14 days; assets attached
to the published release remain available separately. Packaging files use the ignored `release/`
directory.
