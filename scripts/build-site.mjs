// The public website is independent of the local session viewer and npm archive.
import { build, context } from "esbuild";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

process.chdir(fileURLToPath(new URL("..", import.meta.url)));
await mkdir("website-dist/assets", { recursive: true });

const assets = {
  "icon.svg": "ui/assets/runlens.svg",
  LICENSE: "LICENSE",
  "THIRD_PARTY_NOTICES.md": "THIRD_PARTY_NOTICES.md",
};
const screenshotSources = {};
for (const theme of ["light", "dark"]) {
  for (const view of ["library", "session"]) {
    const name = `${view}-${theme}`;
    const source = `docs/screenshots/${name}.png`;
    const hash = createHash("sha256")
      .update(await readFile(source))
      .digest("hex")
      .slice(0, 12);
    const destination = `assets/${name}-${hash}.png`;
    assets[destination] = source;
    screenshotSources[name] = `./${destination}`;
  }
}
await Promise.all(
  Object.entries(assets).map(([destination, source]) =>
    copyFile(source, `website-dist/${destination}`),
  ),
);

let html = await readFile("website/index.html", "utf8");
for (const [name, source] of Object.entries(screenshotSources)) {
  html = html.replaceAll(`./assets/${name}.png`, source);
}
const versionHash = createHash("sha256").update(html);
for (const file of (await readdir("website"))
  .filter((file) => /\.(ts|css|html)$/.test(file))
  .sort()) {
  versionHash.update(file).update(await readFile(`website/${file}`));
}
const version = versionHash
  .update(await readFile("ui/assets/runlens.svg"))
  .digest("hex")
  .slice(0, 12);
for (const asset of ["./icon.svg", "./assets/main.js", "./assets/main.css"]) {
  html = html.replaceAll(asset, `${asset}?v=${version}`);
}
await writeFile("website-dist/index.html", html);

const options = {
  entryPoints: ["website/main.ts"],
  outfile: "website-dist/assets/main.js",
  bundle: true,
  format: "esm",
  target: "es2022",
  define: { __SITE_IMAGES__: JSON.stringify(screenshotSources) },
  loader: { ".woff2": "file", ".woff": "file" },
  assetNames: "[name]-[hash]",
  minify: true,
  logLevel: "info",
};

if (process.argv.includes("--serve")) {
  const preview = await context(options);
  await preview.watch();
  const server = await preview.serve({
    servedir: "website-dist",
    host: "127.0.0.1",
    port: 8741,
  });
  console.log(`Runlens website → http://127.0.0.1:${server.port}/`);
  console.log("CSS and TypeScript rebuild automatically. Restart after HTML or asset edits.");
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, async () => {
      await preview.dispose();
      process.exit(0);
    });
  }
} else {
  await build(options);
  console.log("Built Runlens website → website-dist/");
}
