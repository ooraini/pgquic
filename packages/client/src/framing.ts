import { Buffer } from "buffer";

export interface ControlWelcome {
  ok: boolean;
  version: number;
  sessionId?: string;
  maxStreams?: number;
  error?: string;
}

export function encodeControl(token: string): Uint8Array {
  const payload = Buffer.from(JSON.stringify({ version: 1, token }), "utf8");
  const result = Buffer.allocUnsafe(4 + payload.length);
  result.writeUInt32BE(payload.length, 0);
  payload.copy(result, 4);
  return result;
}

export async function readControl(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  maximum = 32 * 1024,
): Promise<ControlWelcome> {
  let buffered = new Uint8Array(0);
  const exact = async (length: number): Promise<Uint8Array> => {
    while (buffered.length < length) {
      const { value, done } = await reader.read();
      if (done) throw new Error("control stream ended unexpectedly");
      const next = new Uint8Array(buffered.length + value.length);
      next.set(buffered);
      next.set(value, buffered.length);
      buffered = next;
    }
    const out = buffered.slice(0, length);
    buffered = buffered.slice(length);
    return out;
  };
  const header = await exact(4);
  const length = new DataView(header.buffer, header.byteOffset, 4).getUint32(0);
  if (length === 0 || length > maximum)
    throw new Error(`invalid control frame length ${length}`);
  const decoded = JSON.parse(
    new TextDecoder().decode(await exact(length)),
  ) as ControlWelcome;
  if (decoded.version !== 1)
    throw new Error("unsupported pgquic protocol version");
  return decoded;
}
