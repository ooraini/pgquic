import { describe, expect, it } from "vitest";
import { PgWebTransportSocket } from "../src/socket";

describe("socket facade", () => {
  it("copies writes, bounds its queue, and emits drain", async () => {
    let unblock!: () => void;
    const gate = new Promise<void>((r) => (unblock = r));
    const received: Uint8Array[] = [];
    const duplex = {
      readable: new ReadableStream<Uint8Array>(),
      writable: new WritableStream<Uint8Array>({
        async write(v) {
          await gate;
          received.push(v);
        },
      }),
    } as WebTransportBidirectionalStream;
    const transport = {
      queueLimits: { high: 4, low: 1, maximum: 8 },
      openStream: async () => duplex,
      release: () => {},
    } as any;
    const socket = new PgWebTransportSocket(transport);
    await new Promise<void>((r, j) => {
      socket.once("connect", r);
      socket.once("error", j);
      socket.connect();
    });
    const source = new Uint8Array([1, 2, 3, 4]);
    expect(socket.write(source)).toBe(false);
    source[0] = 9;
    const drain = new Promise<void>((r) => socket.once("drain", r));
    unblock();
    await drain;
    expect([...received[0]]).toEqual([1, 2, 3, 4]);
    socket.destroy();
  });
  it("terminates on hard queue overflow", async () => {
    const duplex = {
      readable: new ReadableStream<Uint8Array>(),
      writable: new WritableStream<Uint8Array>({
        write: () => new Promise(() => {}),
      }),
    } as WebTransportBidirectionalStream;
    const transport = {
      queueLimits: { high: 2, low: 1, maximum: 3 },
      openStream: async () => duplex,
      release: () => {},
    } as any;
    const socket = new PgWebTransportSocket(transport);
    socket.on("error", () => {});
    await new Promise<void>((r) => {
      socket.once("connect", r);
      socket.connect();
    });
    expect(socket.write(new Uint8Array(4))).toBe(false);
    expect(socket.destroyed).toBe(true);
  });
});
