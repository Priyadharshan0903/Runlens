// Check the archive users would install, away from the checkout and its node_modules.
// --help and --version exit before discovering sessions or starting a server.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const npmCli = process.env.npm_execpath;
assert(npmCli, "Run this check through npm run test:package.");

const expected = JSON.parse(await readFile("package.json", "utf8"));
const temporary = await mkdtemp(join(tmpdir(), "runlens-package-"));
const destination = resolve(process.argv[2] ?? join(temporary, "package"));
const environment = {
  ...process.env,
  npm_config_cache: join(temporary, "npm-cache"),
  npm_config_update_notifier: "false",
};

try {
  await mkdir(destination, { recursive: true });
  const [packed] = JSON.parse(
    execFileSync(
      process.execPath,
      [npmCli, "pack", "--json", "--ignore-scripts", "--pack-destination", destination],
      { encoding: "utf8", env: environment },
    ),
  );
  assert.equal(packed.version, expected.version);
  assert(
    packed.files.every((file) => !/(^|\/)\.env(?:\.|$)|\.jsonl$/i.test(file.path)),
    "The package must not include environment files or session transcripts.",
  );

  const archive = join(destination, packed.filename);
  const installation = join(temporary, "installation");
  await mkdir(installation);
  await writeFile(join(installation, "package.json"), JSON.stringify({ private: true }));
  execFileSync(
    process.execPath,
    [npmCli, "install", "--ignore-scripts", "--no-audit", "--no-fund", archive],
    { cwd: installation, encoding: "utf8", env: environment },
  );

  const installed = join(installation, "node_modules", ...expected.name.split("/"));
  const manifest = JSON.parse(await readFile(join(installed, "package.json"), "utf8"));
  assert.equal(manifest.version, expected.version);
  assert.equal(manifest.bin.runlens, "dist/cli.js");
  assert.equal(manifest.license, expected.license);

  for (const notice of ["LICENSE", "THIRD_PARTY_NOTICES.md"]) {
    const source = await readFile(notice, "utf8");
    const shipped = await readFile(join(installed, notice), "utf8");
    assert(source.trim().length > 0, `Empty license notice: ${notice}`);
    assert.equal(shipped, source, `The package must include the full ${notice}.`);
  }

  for (const argument of ["--version", "--help"]) {
    const output = execFileSync(
      process.execPath,
      [npmCli, "exec", "--offline", "--", "runlens", argument],
      { cwd: installation, encoding: "utf8", env: environment },
    ).trim();
    if (argument === "--version") assert.equal(output, expected.version);
    else assert(output.includes("Usage"), "The installed command must show its help.");
  }

  const ui = join(installed, "dist", "ui");
  for (const asset of ["index.html", "app.js", "styles.css", "icon.svg"]) {
    assert((await readFile(join(ui, asset))).length > 0, `Missing UI asset: ${asset}`);
  }
  const styles = await readFile(join(ui, "styles.css"), "utf8");
  const fonts = new Set(
    [...styles.matchAll(/url\(["']?\/([^"')]+\.woff2)["']?\)/g)].map((match) => match[1]),
  );
  assert(fonts.size > 0, "The stylesheet must reference bundled fonts.");
  for (const font of fonts) {
    assert((await readFile(join(ui, font))).length > 0, `Missing font: ${font}`);
  }

  const checksum = createHash("sha256")
    .update(await readFile(archive))
    .digest("hex");
  await writeFile(join(destination, "SHA256SUMS"), `${checksum}  ${packed.filename}\n`);
  console.log(
    `Verified ${expected.name}@${expected.version}: installed CLI, UI, ${fonts.size} local fonts, and license notices.`,
  );
  if (process.argv[2]) console.log(`Release files: ${destination}`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
