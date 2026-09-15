import { describe, expect, it, vi } from "vitest";
import { PgWebTransport } from "../src/transport";
import type { WebTransportLike } from "../src/types";

function stream(
  readable: ReadableStream<Uint8Array> = new ReadableStream(),
): WebTransportBidirectionalStream {
  return { readable, writable: new WritableStream<Uint8Array>() };
}
function fakeSession(): WebTransportLike & { opens: number } {
  let opens = 0;
  let close!: () => void;
  const closed = new Promise<void>((r) => (close = r));
  return {
    ready: Promise.resolve(),
    closed,
    get opens() {
      return opens;
    },
    close() {
      close();
    },
    async createBidirectionalStream() {
      opens++;
      if (opens === 1) {
        let sent = false;
        const readable = new ReadableStream<Uint8Array>({
          pull(c) {
            if (!sent) {
              const b = new TextEncoder().encode(
                JSON.stringify({
                  ok: true,
                  version: 1,
                  sessionId: "one",
                  maxStreams: 10,
                }),
              );
              const f = new Uint8Array(b.length + 4);
              new DataView(f.buffer).setUint32(0, b.length);
              f.set(b, 4);
              c.enqueue(f);
              sent = true;
            }
          },
        });
        return stream(readable);
      }
      return stream();
    },
  };
}
describe("PgWebTransport", () => {
  it("shares exactly one session and reserves its first stream for control", async () => {
    const fake = fakeSession();
    const factory = vi.fn(() => fake);
    const t = new PgWebTransport({
      url: "https://localhost/x",
      maxConnections: 3,
      webTransportFactory: factory,
    });
    const sockets = [t.createSocket(), t.createSocket(), t.createSocket()];
    await Promise.all(
      sockets.map(
        (s) =>
          new Promise<void>((resolve, reject) => {
            s.once("connect", resolve);
            s.once("error", reject);
            s.connect();
          }),
      ),
    );
    expect(factory).toHaveBeenCalledTimes(1);
    expect(fake.opens).toBe(4);
    expect(t.state).toMatchObject({
      generation: 1,
      totalSessions: 1,
      activeConnections: 3,
    });
    sockets.forEach((s) => s.destroy());
    await t.close();
  });
  it("enforces the local stream limit", async () => {
    const fake = fakeSession();
    const t = new PgWebTransport({
      url: "https://localhost/x",
      maxConnections: 1,
      webTransportFactory: () => fake,
    });
    const one = t.createSocket();
    await new Promise<void>((r, j) => {
      one.once("connect", r);
      one.once("error", j);
      one.connect();
    });
    await expect(t.openStream(t.createSocket())).rejects.toThrow(/limit/);
    one.destroy();
    await t.close();
  });
  it("creates a new generation only for later connections after session loss", async () => {
    const first = fakeSession(),
      second = fakeSession();
    const factory = vi
      .fn()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second);
    const t = new PgWebTransport({
      url: "https://localhost/x",
      reconnectBaseDelayMs: 0,
      webTransportFactory: factory,
    });
    const one = t.createSocket();
    one.on("error", () => {});
    await new Promise<void>((r, j) => {
      one.once("connect", r);
      one.once("error", j);
      one.connect();
    });
    first.close();
    await new Promise((r) => setTimeout(r, 0));
    expect(one.destroyed).toBe(true);
    const two = t.createSocket();
    await new Promise<void>((r, j) => {
      two.once("connect", r);
      two.once("error", j);
      two.connect();
    });
    expect(t.state.generation).toBe(2);
    expect(factory).toHaveBeenCalledTimes(2);
    two.destroy();
    await t.close();
  });
});
