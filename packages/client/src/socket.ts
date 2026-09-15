import { Buffer } from "buffer";
import { EventEmitter } from "events";
import type { PgWebTransport } from "./transport";

export class PgWebTransportSocket extends EventEmitter {
  writable = true;
  connecting = false;
  destroyed = false;
  readonly generation: number | undefined = undefined;
  private stream?: WebTransportBidirectionalStream;
  private writer?: WritableStreamDefaultWriter<Uint8Array>;
  private reader?: ReadableStreamDefaultReader<Uint8Array>;
  private queue: Array<{
    value: Uint8Array;
    callback?: (error?: Error) => void;
  }> = [];
  private queuedBytes = 0;
  private pumping = false;
  private pressured = false;
  private closeEmitted = false;

  constructor(
    private readonly transport: PgWebTransport,
    private readonly limits = transport.queueLimits,
  ) {
    super();
  }

  connect(..._ignored: unknown[]): this {
    if (this.connecting || this.stream) return this;
    this.connecting = true;
    void this.open();
    return this;
  }

  private async open(): Promise<void> {
    try {
      const opened = await this.transport.openStream(this);
      if (this.destroyed) {
        await opened.writable.abort(
          new Error("socket destroyed during connect"),
        );
        return;
      }
      this.stream = opened;
      this.writer = opened.writable.getWriter();
      this.reader = opened.readable.getReader();
      this.connecting = false;
      this.emit("connect");
      void this.readLoop();
      void this.pump();
    } catch (error) {
      this.fail(error);
    }
  }

  write(
    chunk: Uint8Array | string,
    encoding?: BufferEncoding,
    callback?: (error?: Error) => void,
  ): boolean {
    if (this.destroyed || !this.writable) {
      const error = new Error("write after end");
      queueMicrotask(() => callback?.(error));
      this.fail(error);
      return false;
    }
    const copy =
      typeof chunk === "string"
        ? Buffer.from(chunk, encoding)
        : Buffer.from(chunk).slice();
    if (this.queuedBytes + copy.byteLength > this.limits.maximum) {
      const error = new Error("WebTransport socket write queue limit exceeded");
      queueMicrotask(() => callback?.(error));
      this.destroy(error);
      return false;
    }
    this.queue.push({ value: copy, callback });
    this.queuedBytes += copy.byteLength;
    if (this.queuedBytes >= this.limits.high) this.pressured = true;
    void this.pump();
    return !this.pressured;
  }

  private async pump(): Promise<void> {
    if (this.pumping || !this.writer || this.destroyed) return;
    this.pumping = true;
    try {
      while (this.queue.length && !this.destroyed) {
        const item = this.queue.shift()!;
        const value = item.value;
        await this.writer.ready;
        await this.writer.write(value);
        this.queuedBytes -= value.byteLength;
        item.callback?.();
        if (this.pressured && this.queuedBytes <= this.limits.low) {
          this.pressured = false;
          this.emit("drain");
        }
      }
    } catch (error) {
      for (const item of this.queue.splice(0)) item.callback?.(asError(error));
      this.fail(error);
    } finally {
      this.pumping = false;
    }
  }

  private async readLoop(): Promise<void> {
    try {
      while (!this.destroyed && this.reader) {
        const { value, done } = await this.reader.read();
        if (done) break;
        if (value?.byteLength) this.emit("data", Buffer.from(value));
      }
      this.finishClose();
    } catch (error) {
      this.fail(error);
    }
  }

  end(
    chunk?: Uint8Array | string,
    encoding?: BufferEncoding,
    callback?: () => void,
  ): this {
    if (chunk !== undefined) this.write(chunk, encoding);
    this.writable = false;
    void (async () => {
      while ((this.queue.length || this.pumping) && !this.destroyed)
        await new Promise((r) => setTimeout(r, 0));
      try {
        await this.writer?.close();
        callback?.();
      } catch (error) {
        this.fail(error);
      }
    })();
    return this;
  }

  destroy(error?: Error): this {
    if (this.destroyed) return this;
    this.destroyed = true;
    this.writable = false;
    this.queue = [];
    this.queuedBytes = 0;
    void this.reader?.cancel(error).catch(() => undefined);
    void this.writer?.abort(error).catch(() => undefined);
    if (error) queueMicrotask(() => this.emit("error", error));
    this.finishClose();
    return this;
  }

  private fail(value: unknown): void {
    this.destroy(asError(value));
  }
  private finishClose(): void {
    if (this.closeEmitted) return;
    this.closeEmitted = true;
    this.destroyed = true;
    this.writable = false;
    this.transport.release(this);
    queueMicrotask(() => this.emit("close"));
  }
  setNoDelay(_enabled?: boolean): this {
    return this;
  }
  setKeepAlive(_enabled?: boolean, _delay?: number): this {
    return this;
  }
  ref(): this {
    return this;
  }
  unref(): this {
    return this;
  }
}
function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
