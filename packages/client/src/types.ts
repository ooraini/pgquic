export type TokenProvider = string | (() => string | Promise<string>);

export interface CertificateHash {
  algorithm: "sha-256";
  value: BufferSource;
}

export interface PgWebTransportOptions {
  url: string;
  token?: TokenProvider;
  serverCertificateHashes?: CertificateHash[];
  maxConnections?: number;
  highWaterMark?: number;
  lowWaterMark?: number;
  maxQueuedBytes?: number;
  reconnectBaseDelayMs?: number;
  reconnectMaxDelayMs?: number;
  /** Test/runtime injection. Normal browser users should leave this unset. */
  webTransportFactory?: (
    url: string,
    options: Record<string, unknown>,
  ) => WebTransportLike;
}

export interface WebTransportLike {
  ready: Promise<void>;
  closed: Promise<unknown>;
  createBidirectionalStream(): Promise<WebTransportBidirectionalStream>;
  close(options?: { closeCode?: number; reason?: string }): void;
}

export interface TransportState {
  status: "idle" | "connecting" | "ready" | "backoff" | "closed";
  generation: number;
  sessionId?: string;
  activeConnections: number;
  maxConnections: number;
  totalSessions: number;
}
