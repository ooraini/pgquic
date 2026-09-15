import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Pool, PgWebTransport } from "@pgquic/client";

export const channels = ["orders", "products", "customers"] as const;
export type Channel = (typeof channels)[number] | "vacation_requests";
export type ConnectionStatus = "connecting" | "live" | "reconnecting" | "error";

type PoolInstance = InstanceType<typeof Pool>;
type Handler = (event: {
  channel: Channel;
  id: string;
  receivedAt: Date;
}) => void;

export type DatabaseConfig = {
  url: string;
  token: string;
  certificateHash?: string;
  user?: string;
  password?: string;
  database?: string;
  notificationChannels?: readonly string[];
};

type Database = {
  pool: PoolInstance;
  notifications: NotificationHub;
  transport: PgWebTransport;
};

const DatabaseContext = createContext<Database | null>(null);
const StatusContext = createContext<ConnectionStatus>("connecting");

export function DatabaseProvider({
  config,
  children,
}: {
  config: DatabaseConfig;
  children: ReactNode;
}) {
  const database = useMemo(() => createDatabase(config), [config]);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");

  useEffect(() => {
    let mounted = true;
    const updateStatus = () => {
      if (!mounted) return;
      const next = database.transport.state.status;
      setStatus(
        next === "ready"
          ? "live"
          : next === "backoff"
            ? "reconnecting"
            : next === "closed"
              ? "error"
              : "connecting",
      );
    };

    database.transport.addEventListener("statechange", updateStatus);
    void database.notifications.start().catch(() => {
      if (mounted) setStatus("error");
    });

    return () => {
      mounted = false;
      database.transport.removeEventListener("statechange", updateStatus);
      void database.notifications.close();
      void database.pool.end().catch(() => undefined);
      void database.transport.close().catch(() => undefined);
    };
  }, [database]);

  return (
    <StatusContext.Provider value={status}>
      <DatabaseContext.Provider value={database}>
        {children}
      </DatabaseContext.Provider>
    </StatusContext.Provider>
  );
}

export function useConnectionStatus() {
  return useContext(StatusContext);
}

export function useDatabase() {
  const database = useContext(DatabaseContext);
  if (!database) throw new Error("PostgreSQL hooks require DatabaseProvider");
  return database;
}

export function usePgQuery<Row>(
  key: string,
  text: string,
  values: readonly unknown[] = [],
) {
  const { pool } = useDatabase();
  const [state, setState] = useState<{
    rows: Row[];
    loading: boolean;
    error?: Error;
    updatedAt?: Date;
  }>({ rows: [], loading: true });
  const valuesKey = JSON.stringify(values);

  const refresh = useCallback(async () => {
    try {
      const result = await pool.query(text, [...values]);
      setState({
        rows: result.rows as Row[],
        loading: false,
        updatedAt: new Date(),
      });
    } catch (value) {
      setState((current) => ({
        ...current,
        loading: false,
        error: value instanceof Error ? value : new Error(String(value)),
      }));
    }
  }, [key, pool, text, valuesKey]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { ...state, refresh };
}

export function usePgNotification(channel: Channel, handler: Handler) {
  const { notifications } = useDatabase();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(
    () =>
      notifications.subscribe(channel, (event) => handlerRef.current(event)),
    [channel, notifications],
  );
}

export function usePgLiveQuery<Row>(
  key: string,
  text: string,
  listenChannels: readonly Channel[],
  values: readonly unknown[] = [],
) {
  const { notifications } = useDatabase();
  const query = usePgQuery<Row>(key, text, values);
  const refreshRef = useRef(query.refresh);
  const timerRef = useRef<number | undefined>(undefined);
  refreshRef.current = query.refresh;

  const scheduleRefresh = useCallback(() => {
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => void refreshRef.current(), 120);
  }, []);

  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  const channelsKey = listenChannels.join(",");
  useEffect(() => {
    const unsubscribers = listenChannels.map((channel) =>
      notifications.subscribe(channel, scheduleRefresh),
    );
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [channelsKey, notifications, scheduleRefresh]);

  return query;
}

function createDatabase(config: DatabaseConfig): Database {
  const encoded = config.certificateHash?.trim();
  const serverCertificateHashes = encoded
    ? [{ algorithm: "sha-256" as const, value: decodeHash(encoded) }]
    : undefined;
  const transport = new PgWebTransport({
    url: config.url,
    token: () => config.token,
    maxConnections: 8,
    serverCertificateHashes,
  });
  const pool = new Pool({
    transport,
    max: 8,
    user: config.user ?? "browser_user",
    password: config.password ?? "development-only-password",
    database: config.database ?? "app",
    ssl: false,
    enableChannelBinding: false,
  } as never) as PoolInstance;
  return {
    pool,
    transport,
    notifications: new NotificationHub(
      pool,
      config.notificationChannels ?? channels,
    ),
  };
}

function decodeHash(encoded: string) {
  const value = Uint8Array.from(atob(encoded), (character) =>
    character.charCodeAt(0),
  );
  if (value.byteLength !== 32)
    throw new Error("Certificate hash must contain 32 bytes");
  return value;
}

class NotificationHub {
  private listeners = new Map<string, Set<Handler>>();
  private client: any;
  private starting?: Promise<void>;
  private retry?: number;
  private keepalive?: number;
  private closed = false;
  private attempts = 0;

  constructor(
    private readonly pool: PoolInstance,
    private readonly allowedChannels: readonly string[],
  ) {}

  subscribe(channel: Channel, handler: Handler) {
    const listeners = this.listeners.get(channel) ?? new Set<Handler>();
    listeners.add(handler);
    this.listeners.set(channel, listeners);
    void this.start().catch(() => undefined);
    return () => {
      listeners.delete(handler);
      if (!listeners.size) this.listeners.delete(channel);
    };
  }

  start() {
    if (this.closed)
      return Promise.reject(new Error("Notification hub is closed"));
    if (this.client) return Promise.resolve();
    if (!this.starting) {
      this.starting = this.connect().finally(() => {
        this.starting = undefined;
      });
    }
    return this.starting;
  }

  private async connect() {
    try {
      const client = await this.pool.connect();
      if (this.closed) {
        client.release();
        return;
      }
      this.client = client;
      this.attempts = 0;
      client.on(
        "notification",
        (message: { channel: string; payload?: string }) => {
          if (
            !this.allowedChannels.includes(message.channel) ||
            !message.payload
          )
            return;
          const channel = message.channel as Channel;
          const event = {
            channel,
            id: message.payload,
            receivedAt: new Date(),
          };
          this.listeners.get(channel)?.forEach((handler) => handler(event));
        },
      );
      client.once("error", (error: Error) => this.disconnected(client, error));
      client.once("end", () => this.disconnected(client));
      for (const channel of this.allowedChannels) {
        if (!/^[a-z_][a-z0-9_]*$/.test(channel)) {
          throw new Error(`Unsafe PostgreSQL notification channel: ${channel}`);
        }
        await client.query(`LISTEN ${channel}`);
      }
      this.keepalive = window.setInterval(() => {
        void client
          .query("select 1")
          .catch((error: Error) => this.disconnected(client, error));
      }, 60_000);
    } catch {
      const failedClient = this.client;
      this.client = undefined;
      if (failedClient) {
        try {
          failedClient.release(new Error("LISTEN setup failed"));
        } catch {
          // The pool may already have removed the connection.
        }
      }
      this.scheduleReconnect();
      throw new Error(
        "Could not establish the PostgreSQL notification connection",
      );
    }
  }

  private disconnected(client: any, error?: Error) {
    if (client !== this.client) return;
    this.client = undefined;
    window.clearInterval(this.keepalive);
    try {
      client.release(error ?? new Error("Listener connection ended"));
    } catch {
      // pg-pool may already have removed the failed client.
    }
    this.scheduleReconnect();
  }

  private scheduleReconnect() {
    if (this.closed || this.retry !== undefined) return;
    const delay = Math.min(5_000, 250 * 2 ** Math.min(this.attempts++, 4));
    this.retry = window.setTimeout(() => {
      this.retry = undefined;
      void this.start().catch(() => undefined);
    }, delay);
  }

  async close() {
    this.closed = true;
    window.clearTimeout(this.retry);
    window.clearInterval(this.keepalive);
    const client = this.client;
    this.client = undefined;
    if (!client) return;
    await client.query("UNLISTEN *").catch(() => undefined);
    client.release();
  }
}
