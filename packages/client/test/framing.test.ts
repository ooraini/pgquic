import { describe, expect, it } from "vitest";
import { encodeControl, readControl } from "../src/framing";

describe("control framing", () => {
  it("encodes a big-endian length and token", () => {
    const frame = encodeControl("secret");
    expect(new DataView(frame.buffer, frame.byteOffset, 4).getUint32(0)).toBe(
      frame.length - 4,
    );
    expect(new TextDecoder().decode(frame.slice(4))).toContain("secret");
  });
  it("reads arbitrarily fragmented frames", async () => {
    const body = new TextEncoder().encode(
      JSON.stringify({ ok: true, version: 1, sessionId: "s", maxStreams: 10 }),
    );
    const frame = new Uint8Array(body.length + 4);
    new DataView(frame.buffer).setUint32(0, body.length);
    frame.set(body, 4);
    const readable = new ReadableStream<Uint8Array>({
      start(c) {
        for (const byte of frame) c.enqueue(Uint8Array.of(byte));
        c.close();
      },
    });
    await expect(readControl(readable.getReader())).resolves.toMatchObject({
      ok: true,
      sessionId: "s",
    });
  });
  it("rejects oversized responses", async () => {
    const readable = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(Uint8Array.of(0, 1, 0, 0));
        c.close();
      },
    });
    await expect(readControl(readable.getReader(), 100)).rejects.toThrow(
      /length/,
    );
  });
});
