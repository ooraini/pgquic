import { encodeControl, readControl } from "./framing";
import { PgWebTransportSocket } from "./socket";
import type {
  PgWebTransportOptions,
  TransportState,
  WebTransportLike,
} from "./types";

export class PgWebTransport extends EventTarget {
  readonly queueLimits: { high: number; low: number; maximum: number };
  private session?: WebTransportLike;
  private connecting?: Promise<WebTransportLike>;
  private sockets = new Set<PgWebTransportSocket>();
  private status: TransportState["status"] = "idle";
  private generation = 0;
  private totalSessions = 0;
  private sessionId?: string;
  private terminal = false;
  private lastFailureAt = 0;
  private failures = 0;

  constructor(private readonly options: PgWebTransportOptions) {
    super();
    const high = options.highWaterMark ?? 64 * 1024;
    const low = options.lowWaterMark ?? Math.floor(high / 2);
    const maximum = options.maxQueuedBytes ?? 256 * 1024;
    if (!options.url.startsWith("https://"))
      throw new Error("WebTransport URL must use https://");
    if (!(low >= 0 && low < high && high <= maximum))
      throw new Error("invalid write queue watermarks");
    this.queueLimits = { high, low, maximum };
  }

  get state(): TransportState {
    return {
      status: this.status,
      generation: this.generation,
      sessionId: this.sessionId,
      activeConnections: this.sockets.size,
      maxConnections: this.options.maxConnections ?? 10,
      totalSessions: this.totalSessions,
    };
  }

  createSocket(): PgWebTransportSocket {
    return new PgWebTransportSocket(this);
  }

  async openStream(
    socket: PgWebTransportSocket,
  ): Promise<WebTransportBidirectionalStream> {
    if (this.terminal) throw new Error("PgWebTransport is closed");
    if (this.sockets.size >= (this.options.maxConnections ?? 10))
      throw new Error("local WebTransport stream limit reached");
    const session = await this.ensureSession();
    const stream = await session.createBidirectionalStream();
    this.sockets.add(socket);
    this.changed();
    return stream;
  }

  release(socket: PgWebTransportSocket): void {
    if (this.sockets.delete(socket)) this.changed();
  }

  private async ensureSession(): Promise<WebTransportLike> {
    if (this.session) return this.session;
    if (this.connecting) return this.connecting;
    this.connecting = this.connectSession();
    try {
      return await this.connecting;
    } finally {
      this.connecting = undefined;
    }
  }

  private async connectSession(): Promise<WebTransportLike> {
    if (this.failures) {
      this.status = "backoff";
      this.changed();
      const base = this.options.reconnectBaseDelayMs ?? 100;
      const cap = this.options.reconnectMaxDelayMs ?? 5_000;
      const delay = Math.min(cap, base * 2 ** Math.min(this.failures - 1, 8));
      const remaining = Math.max(
        0,
        this.lastFailureAt + delay * (0.5 + Math.random()) - Date.now(),
      );
      if (remaining)
        await new Promise((resolve) => setTimeout(resolve, remaining));
    }
    this.status = "connecting";
    this.changed();
    const factory = this.options.webTransportFactory ?? defaultFactory;
    const session = factory(
      this.options.url,
      this.options.serverCertificateHashes
        ? { serverCertificateHashes: this.options.serverCertificateHashes }
        : {},
    );
    try {
      await session.ready;
      const control = await session.createBidirectionalStream();
      const writer = control.writable.getWriter();
      const reader = control.readable.getReader();
      const token =
        typeof this.options.token === "function"
          ? await this.options.token()
          : (this.options.token ?? "");
      await writer.write(encodeControl(token));
      const welcome = await readControl(reader);
      if (!welcome.ok)
        throw new Error(welcome.error || "pgquic authentication failed");
      writer.releaseLock();
      reader.releaseLock();
      this.session = session;
      this.sessionId = welcome.sessionId;
      this.generation++;
      this.totalSessions++;
      this.failures = 0;
      this.status = "ready";
      this.changed();
      void session.closed.then(
        () => this.sessionFailed(new Error("WebTransport session closed")),
        (e) => this.sessionFailed(asError(e)),
      );
      return session;
    } catch (error) {
      session.close({ closeCode: 1, reason: "control handshake failed" });
      this.noteFailure();
      throw error;
    }
  }

  private sessionFailed(error: Error): void {
    if (!this.session || this.terminal) return;
    this.session = undefined;
    this.sessionId = undefined;
    this.noteFailure();
    for (const socket of [...this.sockets]) socket.destroy(error);
  }
  private noteFailure(): void {
    this.lastFailureAt = Date.now();
    this.failures++;
    this.status = this.terminal ? "closed" : "idle";
    this.changed();
  }
  async close(): Promise<void> {
    this.terminal = true;
    this.status = "closed";
    const current = this.session;
    this.session = undefined;
    for (const socket of [...this.sockets])
      socket.destroy(new Error("PgWebTransport closed"));
    current?.close({ closeCode: 0, reason: "client closed" });
    this.changed();
  }
  private changed(): void {
    this.dispatchEvent(new CustomEvent("statechange", { detail: this.state }));
  }
}
function defaultFactory(
  url: string,
  options: Record<string, unknown>,
): WebTransportLike {
  return new WebTransport(
    url,
    options as WebTransportOptions,
  ) as unknown as WebTransportLike;
}
function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
