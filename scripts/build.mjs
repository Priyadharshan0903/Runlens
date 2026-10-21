// Builds dist/cli.js (the npx entry point) and dist/ui (the pre-built browser app).

import { build } from "esbuild";
import { copyFile, mkdir, readFile } from "node:fs/promises";

const pkg = JSON.parse(await readFile("package.json", "utf8"));

// All output names are fixed. Write them in place so rebuilds also work when the
// output directory is mounted or a local viewer already has it open.
await mkdir("dist/ui", { recursive: true });

await build({
  entryPoints: ["src/cli.ts"],
  outfile: "dist/cli.js",
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  banner: { js: "#!/usr/bin/env node" },
  define: { __VERSION__: JSON.stringify(pkg.version) },
  logLevel: "warning",
});

await build({
  entryPoints: ["ui/main.tsx"],
  outfile: "dist/ui/app.js",
  bundle: true,
  platform: "browser",
  target: "es2022",
  format: "esm",
  jsx: "automatic",
  jsxImportSource: "preact",
  // Phosphor icons are written for React; Preact's compat layer runs them unchanged.
  alias: {
    react: "preact/compat",
    "react-dom": "preact/compat",
    "react/jsx-runtime": "preact/jsx-runtime",
  },
  minify: true,
  logLevel: "warning",
});

await copyFile("ui/index.html", "dist/ui/index.html");
await build({
  entryPoints: ["ui/styles/index.css"],
  outfile: "dist/ui/styles.css",
  bundle: true,
  target: "es2022",
  external: ["/*.woff2"],
  minify: true,
  logLevel: "warning",
});

// Fonts ship with the package instead of loading from a font CDN: nothing leaves the machine.
const fonts = {
  "geist-400.woff2": "@fontsource/geist-sans/files/geist-sans-latin-400-normal.woff2",
  "geist-500.woff2": "@fontsource/geist-sans/files/geist-sans-latin-500-normal.woff2",
  "geist-600.woff2": "@fontsource/geist-sans/files/geist-sans-latin-600-normal.woff2",
  "geist-mono-400.woff2": "@fontsource/geist-mono/files/geist-mono-latin-400-normal.woff2",
  "geist-mono-500.woff2": "@fontsource/geist-mono/files/geist-mono-latin-500-normal.woff2",
};
for (const [name, source] of Object.entries(fonts)) {
  await copyFile(`node_modules/${source}`, `dist/ui/${name}`);
}

console.log(`Built runlens ${pkg.version} → dist/`);
