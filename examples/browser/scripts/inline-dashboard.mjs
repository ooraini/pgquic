import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const indexPath = `${root}dist/index.html`;
let html = await readFile(indexPath, "utf8");

const scriptMatch = html.match(/<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/);
const styleMatch = html.match(
  /<link\b[^>]*\brel="stylesheet"[^>]*\bhref="([^"]+)"[^>]*>/,
);
if (!scriptMatch || !styleMatch) {
  throw new Error("could not find Vite assets in dist/index.html");
}

const assetPath = (url) => `${root}dist/${url.replace(/^\//, "")}`;
const [javascript, css] = await Promise.all([
  readFile(assetPath(scriptMatch[1]), "utf8"),
  readFile(assetPath(styleMatch[1]), "utf8"),
]);

html = html
  .replace(styleMatch[0], () => `<style>${css}</style>`)
  .replace(scriptMatch[0], "")
  .replace(
    "</body>",
    () =>
      `<script>${javascript.replaceAll("</script", "<\\/script")}</script>\n</body>`,
  );

await writeFile(`${root}dist/dashboard.html`, html);
