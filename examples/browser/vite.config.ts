import { defineConfig } from "vite";
import fs from "node:fs";

function certificateHash() {
  if (process.env.VITE_PGQUIC_CERT_HASH)
    return process.env.VITE_PGQUIC_CERT_HASH;
  try {
    return /(?:^|\n)PGQUIC_CERT_HASH=([^\n]+)/.exec(
      fs.readFileSync("../../deploy/.env", "utf8"),
    )?.[1];
  } catch {
    return undefined;
  }
}

export default defineConfig({
  define: {
    "import.meta.env.VITE_PGQUIC_CERT_HASH": JSON.stringify(certificateHash()),
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
  },
});
