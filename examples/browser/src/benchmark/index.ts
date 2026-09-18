import { Pool, PgWebTransport } from "@ooraini/pgquic";
const now = () => performance.now();
const result = document.getElementById("result")!;
async function measure(name: string, fn: () => Promise<void>) {
  const start = now();
  await fn();
  return { name, ms: Number((now() - start).toFixed(2)) };
}
async function main() {
  const rows: unknown[] = [];
  // Pinning lets localhost use a generated certificate without weakening TLS
  // verification for the rest of the browser session.
  const encoded = import.meta.env.VITE_PGQUIC_CERT_HASH as string | undefined;
  const serverCertificateHashes = encoded
    ? [
        {
          algorithm: "sha-256" as const,
          value: Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0)),
        },
      ]
    : undefined;
  for (const concurrency of [1, 5, 20]) {
    // A fresh transport per tier keeps connection-establishment measurements
    // independent and matches the pool size to the advertised concurrency.
    const transport = new PgWebTransport({
      url: "https://localhost:4433/v1/session",
      maxConnections: concurrency,
      serverCertificateHashes,
    });
    const pool = new Pool({
      transport,
      max: concurrency,
      user: "browser_user",
      password: "development-only-password",
      database: "app",
      ssl: false,
      enableChannelBinding: false,
    } as any);
    // Compare parallel multiplexing, serial request latency, and bulk transfer
    // using the same query protocol and PostgreSQL connection pool.
    rows.push(
      await measure(`${concurrency} connection establishment`, async () => {
        const clients = await Promise.all(
          Array.from({ length: concurrency }, () => pool.connect()),
        );
        clients.forEach((c: any) => c.release());
      }),
    );
    rows.push(
      await measure(`${concurrency} concurrent small queries`, async () => {
        await Promise.all(
          Array.from({ length: 100 }, (_, i) =>
            pool.query("select $1::int", [i]),
          ),
        );
      }),
    );
    rows.push(
      await measure(`${concurrency} sequential small queries`, async () => {
        for (let i = 0; i < 100; i++) await pool.query("select $1::int", [i]);
      }),
    );
    rows.push(
      await measure(`${concurrency} large result transfer`, async () => {
        await pool.query(
          "select i, repeat('x',128) from generate_series(1,10000) i",
        );
      }),
    );
    rows.push({ concurrency, ...transport.state });
    await pool.end();
    await transport.close();
  }
  result.textContent = JSON.stringify(
    {
      userAgent: navigator.userAgent,
      at: new Date().toISOString(),
      measurements: rows,
    },
    null,
    2,
  );
}
main().catch((e) => {
  result.textContent = String(e);
  throw e;
});
