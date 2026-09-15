import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const root = fileURLToPath(new URL("../", import.meta.url));
const outputRoot = `${root}dist`;
const temporaryRoot = `${root}.standalone-build`;
const demos = [
  { entry: "index.html", output: "dashboard.html" },
  { entry: "benchmark.html", output: "benchmark.html" },
  { entry: "pg-cron.html", output: "pg-cron.html" },
];

await rm(outputRoot, { recursive: true, force: true });
await rm(temporaryRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });

try {
  for (const demo of demos) {
    const buildRoot = `${temporaryRoot}/${demo.output.replace(/\.html$/, "")}`;
    await build({
      root,
      configFile: `${root}vite.config.ts`,
      build: {
        outDir: buildRoot,
        emptyOutDir: true,
        rollupOptions: { input: `${root}${demo.entry}` },
      },
    });

    const builtHtmlPath = `${buildRoot}/${demo.entry}`;
    let html = await readFile(builtHtmlPath, "utf8");

    const stylesheets = [
      ...html.matchAll(
        /<link\b[^>]*\brel="stylesheet"[^>]*\bhref="([^"]+)"[^>]*>/g,
      ),
    ];
    for (const match of stylesheets) {
      const css = await readFile(assetPath(buildRoot, match[1]), "utf8");
      html = html.replace(match[0], () => `<style>${css}</style>`);
    }

    const scripts = [
      ...html.matchAll(/<script\b([^>]*)\bsrc="([^"]+)"([^>]*)><\/script>/g),
    ];
    for (const match of scripts) {
      const javascript = await readFile(assetPath(buildRoot, match[2]), "utf8");
      const attributes = `${match[1]}${match[3]}`.replace(
        /\s*crossorigin(?:="[^"]*")?/g,
        "",
      );
      html = html.replace(
        match[0],
        () =>
          `<script${attributes}>${javascript.replaceAll("</script", "<\\/script")}</script>`,
      );
    }

    html = html.replace(/<link\b[^>]*\brel="modulepreload"[^>]*>\s*/g, "");
    const remainingAsset = html.match(
      /<(?:script|link)\b[^>]*\b(?:src|href)="\/?assets\//,
    );
    if (remainingAsset) {
      throw new Error(
        `${demo.output} still references a generated asset near ${remainingAsset[0]}`,
      );
    }
    await writeFile(`${outputRoot}/${demo.output}`, html);
  }
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

function assetPath(buildRoot, assetUrl) {
  const relative = assetUrl.replace(/^\.\//, "").replace(/^\//, "");
  if (relative.includes("..")) throw new Error(`unsafe asset URL: ${assetUrl}`);
  return `${buildRoot}/${relative}`;
}
