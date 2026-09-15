import { defineConfig } from "tsup";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
const local = (name: string) =>
  fileURLToPath(new URL(`./src/shims/${name}.cjs`, import.meta.url));
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  platform: "browser",
  bundle: true,
  noExternal: [/.*/],
  esbuildPlugins: [
    {
      name: "pgquic-pool",
      setup(build) {
        build.onLoad({ filter: /pg-pool\/index\.js$/ }, async (args) => ({
          contents: (await readFile(args.path, "utf8")).replace(
            "this.Client = this.options.Client || Client || require('pg').Client",
            "this.Client = this.options.Client || Client; if (!this.Client) throw new Error('Pool requires a Client')",
          ),
          loader: "js",
        }));
      },
    },
  ],
  esbuildOptions(options) {
    options.inject = [
      fileURLToPath(new URL("./src/shims/inject.ts", import.meta.url)),
    ];
    options.alias = {
      ...(options.alias || {}),
      "util/types": local("util-types"),
      util: local("util"),
      crypto: local("crypto"),
      net: local("net"),
      tls: local("tls"),
      dns: local("dns"),
      fs: local("fs"),
      pgpass: local("pgpass"),
    };
  },
  define: { "process.env.NODE_ENV": '"production"' },
});
