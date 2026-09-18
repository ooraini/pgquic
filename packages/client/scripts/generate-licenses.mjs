import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const sourceMapPath = path.join(packageDirectory, "dist", "index.js.map");
const sourceMap = JSON.parse(await readFile(sourceMapPath, "utf8"));

async function findPackageRoot(source) {
  let directory = path.dirname(
    path.resolve(path.dirname(sourceMapPath), source),
  );

  while (directory !== path.dirname(directory)) {
    const packageJsonPath = path.join(directory, "package.json");
    try {
      const metadata = JSON.parse(await readFile(packageJsonPath, "utf8"));
      if (
        metadata.name &&
        directory.includes(`${path.sep}node_modules${path.sep}`)
      ) {
        return { directory, metadata };
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    directory = path.dirname(directory);
  }

  return undefined;
}

async function readLicense(directory) {
  const files = await readdir(directory);
  const licenseFile = files.find((file) =>
    /^(licen[cs]e|copying)(\..*)?$/i.test(file),
  );
  if (licenseFile) return readFile(path.join(directory, licenseFile), "utf8");

  const readmeFile = files.find((file) => /^readme(\..*)?$/i.test(file));
  if (readmeFile) {
    const readme = await readFile(path.join(directory, readmeFile), "utf8");
    const section = readme.match(/^##+\s+licen[cs]e\s*$([\s\S]*)/im)?.[1];
    if (section) return section.trim();
  }

  throw new Error(`No license text found in ${directory}`);
}

const packages = new Map();
for (const source of sourceMap.sources) {
  if (!source.includes("node_modules")) continue;
  const dependency = await findPackageRoot(source);
  if (!dependency) throw new Error(`Cannot resolve package for ${source}`);
  packages.set(
    `${dependency.metadata.name}@${dependency.metadata.version}`,
    dependency,
  );
}

const sections = [];
for (const [identifier, dependency] of [...packages].sort(([a], [b]) =>
  a.localeCompare(b),
)) {
  const license = await readLicense(dependency.directory);
  sections.push(
    [
      "=".repeat(78),
      `${identifier} (${dependency.metadata.license})`,
      "=".repeat(78),
      license.trim(),
    ].join("\n"),
  );
}

const output = [
  "Third-party licenses for @ooraini/pgquic",
  "",
  "Generated from the packages bundled in dist/index.js.",
  "",
  sections.join("\n\n"),
  "",
].join("\n");

await writeFile(
  path.join(packageDirectory, "LICENSES", "THIRD_PARTY_LICENSES.txt"),
  output,
);
