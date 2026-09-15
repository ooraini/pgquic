import { Buffer } from "buffer";
import BaseClient from "pg/lib/client.js";
import BasePool from "pg-pool";
import type { ClientConfig, PoolConfig } from "pg";
import { PgWebTransportSocket } from "./socket";
import { PgWebTransport } from "./transport";

if (!(globalThis as any).Buffer) (globalThis as any).Buffer = Buffer;

export interface PgquicClientConfig extends ClientConfig {
  transport: PgWebTransport;
  enableChannelBinding?: boolean;
}
export interface PgquicPoolConfig extends PoolConfig {
  transport: PgWebTransport;
  enableChannelBinding?: boolean;
}

export class Client extends (BaseClient as any) {
  constructor(config: PgquicClientConfig) {
    if (!config?.transport)
      throw new Error("@pgquic/client requires a PgWebTransport instance");
    if (config.ssl !== false)
      throw new Error(
        "@pgquic/client requires ssl: false; WebTransport supplies encryption",
      );
    if (config.enableChannelBinding)
      throw new Error(
        "channel binding is unavailable without end-to-end PostgreSQL TLS",
      );
    const socket = new PgWebTransportSocket(config.transport);
    super({ ...config, password: config.password, stream: socket });
  }
}

export class Pool extends (BasePool as any) {
  constructor(config: PgquicPoolConfig) {
    super(config, Client);
  }
}

export { PgWebTransport, PgWebTransportSocket };
export type {
  PgWebTransportOptions,
  TransportState,
  TokenProvider,
} from "./types";
