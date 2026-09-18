import { Buffer } from "buffer";
import BaseClient from "pg/lib/client.js";
import BasePool from "pg-pool";
import type {
  Client as PgClient,
  ClientConfig,
  Pool as PgPool,
  PoolConfig,
} from "pg";
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

// The runtime classes come from the browser bundle's patched node-postgres
// internals. Merge their public instance types with the supported `pg` API so
// consumers retain node-postgres query, event, and pool typings.
export interface Client extends PgClient {}
export class Client extends (BaseClient as any) {
  constructor(config: PgquicClientConfig) {
    if (!config?.transport)
      throw new Error("@ooraini/pgquic requires a PgWebTransport instance");
    if (config.ssl !== false)
      throw new Error(
        "@ooraini/pgquic requires ssl: false; WebTransport supplies encryption",
      );
    if (config.enableChannelBinding)
      throw new Error(
        "channel binding is unavailable without end-to-end PostgreSQL TLS",
      );
    const socket = new PgWebTransportSocket(config.transport);
    super({ ...config, password: config.password, stream: socket });
  }
}

export interface Pool extends PgPool {}
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
