import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import {
  DatabaseProvider,
  channels,
  useConnectionStatus,
  usePgLiveQuery,
  usePgNotification,
  type Channel,
  type DatabaseConfig,
} from "./react-pg";
import "./commerce.css";

type Metrics = {
  revenue: string;
  order_count: string;
  customer_count: string;
  low_stock: string;
  pending_count: string;
};
type Order = {
  id: string;
  customer_name: string;
  product_name: string;
  quantity: number;
  total: string;
  status: "pending" | "processing" | "shipped" | "delivered";
  created_at: string;
};
type Product = {
  id: string;
  name: string;
  sku: string;
  price: string;
  stock: number;
  sold: string;
};
type Customer = {
  id: string;
  name: string;
  email: string;
  segment: string;
  order_count: string;
  spend: string;
};
type Activity = { channel: Channel; id: string; receivedAt: Date };

const encodedHash = import.meta.env.VITE_PGQUIC_CERT_HASH as string | undefined;
const initialConfig: DatabaseConfig = {
  url: "https://localhost:4433/v1/session",
  token: "",
  certificateHash: encodedHash,
};

function App() {
  const [config, setConfig] = useState(initialConfig);
  const [draft, setDraft] = useState(initialConfig);

  function reconnect(event: FormEvent) {
    event.preventDefault();
    setConfig({ ...draft });
  }

  return (
    <DatabaseProvider config={config}>
      <Dashboard draft={draft} setDraft={setDraft} reconnect={reconnect} />
    </DatabaseProvider>
  );
}

function Dashboard({
  draft,
  setDraft,
  reconnect,
}: {
  draft: DatabaseConfig;
  setDraft: (config: DatabaseConfig) => void;
  reconnect: (event: FormEvent) => void;
}) {
  const status = useConnectionStatus();
  const metrics = usePgLiveQuery<Metrics>(
    "metrics",
    `select
      coalesce(sum(total) filter (where created_at > now() - interval '24 hours'), 0)::text as revenue,
      count(*) filter (where created_at > now() - interval '24 hours')::text as order_count,
      (select count(*)::text from customers) as customer_count,
      (select count(*)::text from products where stock < 8) as low_stock,
      count(*) filter (where status in ('pending', 'processing'))::text as pending_count
     from orders`,
    channels,
  );
  const orders = usePgLiveQuery<Order>(
    "orders",
    `select o.id, c.name as customer_name, p.name as product_name,
            o.quantity, o.total::text, o.status, o.created_at
     from orders o
     join customers c on c.id = o.customer_id
     join products p on p.id = o.product_id
     order by o.created_at desc limit 9`,
    ["orders", "customers", "products"],
  );
  const products = usePgLiveQuery<Product>(
    "products",
    `select p.id, p.name, p.sku, p.price::text, p.stock,
            coalesce(sum(o.quantity), 0)::text as sold
     from products p left join orders o on o.product_id = p.id
     group by p.id order by p.stock, p.name`,
    ["products", "orders"],
  );
  const customers = usePgLiveQuery<Customer>(
    "customers",
    `select c.id, c.name, c.email, c.segment,
            count(o.id)::text as order_count,
            coalesce(sum(o.total), 0)::text as spend
     from customers c left join orders o on o.customer_id = c.id
     group by c.id order by max(o.created_at) desc nulls last limit 5`,
    ["customers", "orders"],
  );
  const activity = useActivity();
  const summary = metrics.rows[0];
  const anyError =
    metrics.error ?? orders.error ?? products.error ?? customers.error;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="logo" href="#top" aria-label="Northstar home">
          <span className="logo-mark">N</span>
          <span>northstar</span>
        </a>
        <nav aria-label="Primary navigation">
          <NavItem icon="grid" active>
            Overview
          </NavItem>
          <NavItem icon="bag">Orders</NavItem>
          <NavItem icon="box">Products</NavItem>
          <NavItem icon="users">Customers</NavItem>
          <NavItem icon="chart">Analytics</NavItem>
        </nav>
        <div className="sidebar-bottom">
          <div className="database-chip">
            <span className={`live-dot ${status}`} />
            <div>
              <strong>PostgreSQL</strong>
              <small>{status}</small>
            </div>
          </div>
          <span className="powered">PQ · pgquic transport</span>
        </div>
      </aside>

      <main id="top">
        <header className="topbar">
          <div>
            <p className="overline">LIVE OPERATIONS</p>
            <h1>Store pulse</h1>
          </div>
          <div className="topbar-actions">
            <span className={`connection-state ${status}`}>
              <span className="live-dot" />
              {status}
            </span>
            <details className="connection-menu">
              <summary aria-label="Connection settings">
                <Icon name="sliders" />
              </summary>
              <form onSubmit={reconnect}>
                <label>
                  Gateway URL
                  <input
                    value={draft.url}
                    onChange={(event) =>
                      setDraft({ ...draft, url: event.target.value })
                    }
                  />
                </label>
                <label>
                  JWT <small>optional</small>
                  <input
                    type="password"
                    value={draft.token}
                    onChange={(event) =>
                      setDraft({ ...draft, token: event.target.value })
                    }
                  />
                </label>
                <label>
                  Certificate SHA-256 <small>base64</small>
                  <input
                    value={draft.certificateHash ?? ""}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        certificateHash: event.target.value,
                      })
                    }
                  />
                </label>
                <button type="submit">Reconnect</button>
              </form>
            </details>
            <div className="avatar">OR</div>
          </div>
        </header>

        <section className="dashboard-content">
          <div className="intro-row">
            <div>
              <h2>Good morning.</h2>
              <p>Your storefront is updating directly from database events.</p>
            </div>
            <div className="sync-note">
              <Icon name="bolt" />
              <span>
                <strong>Live sync</strong>LISTEN on 3 channels
              </span>
            </div>
          </div>

          {anyError && (
            <div className="error-banner">
              <strong>Connection unavailable.</strong> {anyError.message}
            </div>
          )}

          <section className="metric-grid" aria-label="Store metrics">
            <Metric
              label="Revenue · 24h"
              value={money(summary?.revenue)}
              note="settled and open orders"
              accent="lime"
            />
            <Metric
              label="Orders · 24h"
              value={summary?.order_count ?? "—"}
              note={`${summary?.pending_count ?? "—"} need attention`}
              accent="violet"
            />
            <Metric
              label="Customers"
              value={summary?.customer_count ?? "—"}
              note="active profiles"
              accent="orange"
            />
            <Metric
              label="Low stock"
              value={summary?.low_stock ?? "—"}
              note="below 8 units"
              accent="pink"
            />
          </section>

          <section className="primary-grid">
            <Card
              title="Recent orders"
              eyebrow="FULFILLMENT"
              action={
                <span className="updated">
                  {formatUpdate(orders.updatedAt)}
                </span>
              }
            >
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Order</th>
                      <th>Customer</th>
                      <th>Product</th>
                      <th>Total</th>
                      <th>Status</th>
                      <th>Placed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.rows.map((order) => (
                      <tr key={order.id}>
                        <td className="mono">#{shortId(order.id)}</td>
                        <td>
                          <strong>{order.customer_name}</strong>
                        </td>
                        <td>
                          {order.quantity}× {order.product_name}
                        </td>
                        <td className="money">{money(order.total)}</td>
                        <td>
                          <span className={`status ${order.status}`}>
                            {order.status}
                          </span>
                        </td>
                        <td className="muted">{timeAgo(order.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!orders.loading && !orders.rows.length && (
                  <Empty>No orders yet</Empty>
                )}
              </div>
            </Card>

            <Card
              title="Live activity"
              eyebrow="PG_NOTIFY"
              action={
                <span className="pulse-label">
                  <i />
                  STREAMING
                </span>
              }
            >
              <div className="activity-list" aria-live="polite">
                {!activity.length && (
                  <div className="activity-empty">
                    <span className="radar" />
                    <strong>Waiting for table events</strong>
                    <small>Cron jobs will stimulate the store</small>
                  </div>
                )}
                {activity.map((event) => (
                  <div
                    className="activity-item"
                    key={`${event.channel}-${event.id}-${event.receivedAt.getTime()}`}
                  >
                    <span className={`event-icon ${event.channel}`}>
                      <Icon name={channelIcon(event.channel)} />
                    </span>
                    <div>
                      <strong>{event.channel}</strong>
                      <small>row {shortId(event.id)} changed</small>
                    </div>
                    <time>
                      {event.receivedAt.toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      })}
                    </time>
                  </div>
                ))}
              </div>
            </Card>
          </section>

          <section className="secondary-grid">
            <Card
              title="Inventory"
              eyebrow="PRODUCTS"
              action={
                <span className="updated">{products.rows.length} SKUs</span>
              }
            >
              <div className="inventory-list">
                {products.rows.map((product) => {
                  const level = Math.min(100, product.stock * 4);
                  return (
                    <div className="inventory-row" key={product.id}>
                      <div className="product-art">
                        {product.name.slice(0, 1)}
                      </div>
                      <div className="product-copy">
                        <strong>{product.name}</strong>
                        <small>
                          {product.sku} · {money(product.price)}
                        </small>
                      </div>
                      <div className="stock">
                        <span>
                          <strong>{product.stock}</strong> in stock
                        </span>
                        <div>
                          <i style={{ width: `${level}%` }} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>

            <Card
              title="Top customers"
              eyebrow="RELATIONSHIPS"
              action={<span className="updated">LIFETIME</span>}
            >
              <div className="customer-list">
                {customers.rows.map((customer, index) => (
                  <div className="customer-row" key={customer.id}>
                    <span className="rank">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span className={`customer-avatar tone-${index % 4}`}>
                      {initials(customer.name)}
                    </span>
                    <div>
                      <strong>{customer.name}</strong>
                      <small>
                        {customer.segment} · {customer.order_count} orders
                      </small>
                    </div>
                    <span className="customer-spend">
                      {money(customer.spend)}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          </section>

          <footer>
            <span>
              Data is queried with <code>Pool</code>
            </span>
            <span>
              Updates arrive through one dedicated PostgreSQL connection
            </span>
          </footer>
        </section>
      </main>
    </div>
  );
}

function useActivity() {
  const [activity, setActivity] = useState<Activity[]>([]);
  const receive = (event: Activity) =>
    setActivity((current) => [event, ...current].slice(0, 7));
  usePgNotification("orders", receive);
  usePgNotification("products", receive);
  usePgNotification("customers", receive);
  return activity;
}

function Card({
  title,
  eyebrow,
  action,
  children,
}: {
  title: string;
  eyebrow: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <article className="card">
      <header>
        <div>
          <p className="overline">{eyebrow}</p>
          <h2>{title}</h2>
        </div>
        {action}
      </header>
      {children}
    </article>
  );
}

function Metric({
  label,
  value,
  note,
  accent,
}: {
  label: string;
  value: string;
  note: string;
  accent: string;
}) {
  return (
    <article className={`metric ${accent}`}>
      <div className="metric-head">
        <span>{label}</span>
        <Icon name="trend" />
      </div>
      <strong>{value}</strong>
      <p>{note}</p>
      <div className="spark">
        {[22, 38, 27, 52, 44, 68, 57, 82, 74, 94].map((height, index) => (
          <i key={index} style={{ height: `${height}%` }} />
        ))}
      </div>
    </article>
  );
}

function NavItem({
  icon,
  active,
  children,
}: {
  icon: IconName;
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <a
      href={`#${String(children).toLowerCase()}`}
      className={active ? "active" : ""}
    >
      <Icon name={icon} />
      {children}
      {active && <i />}
    </a>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

type IconName =
  | "grid"
  | "bag"
  | "box"
  | "users"
  | "chart"
  | "sliders"
  | "bolt"
  | "trend";
const iconPaths: Record<IconName, ReactNode> = {
  grid: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="2" />
      <rect x="14" y="3" width="7" height="7" rx="2" />
      <rect x="3" y="14" width="7" height="7" rx="2" />
      <rect x="14" y="14" width="7" height="7" rx="2" />
    </>
  ),
  bag: (
    <>
      <path d="M6 8h12l1 13H5L6 8Z" />
      <path d="M9 9V6a3 3 0 0 1 6 0v3" />
    </>
  ),
  box: (
    <>
      <path d="m4 7 8-4 8 4-8 4-8-4Z" />
      <path d="M4 7v10l8 4 8-4V7M12 11v10" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="4" />
      <path d="M2 21a7 7 0 0 1 14 0M16 4a4 4 0 0 1 0 8M18 15a6 6 0 0 1 4 6" />
    </>
  ),
  chart: (
    <>
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
    </>
  ),
  sliders: (
    <>
      <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="8" cy="17" r="2" />
    </>
  ),
  bolt: <path d="m13 2-8 12h7l-1 8 8-12h-7l1-8Z" />,
  trend: (
    <>
      <path d="m4 16 5-5 4 4 7-8" />
      <path d="M15 7h5v5" />
    </>
  ),
};
function Icon({ name }: { name: IconName }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {iconPaths[name]}
    </svg>
  );
}
function channelIcon(channel: Channel): IconName {
  return channel === "orders"
    ? "bag"
    : channel === "products"
      ? "box"
      : "users";
}
function shortId(id: string) {
  return id.slice(0, 8).toUpperCase();
}
function initials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2);
}
function money(value?: string) {
  return value === undefined
    ? "—"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      }).format(Number(value));
}
function timeAgo(value: string) {
  const seconds = Math.max(
    1,
    Math.round((Date.now() - new Date(value).getTime()) / 1000),
  );
  return seconds < 60
    ? `${seconds}s ago`
    : seconds < 3600
      ? `${Math.floor(seconds / 60)}m ago`
      : `${Math.floor(seconds / 3600)}h ago`;
}
function formatUpdate(value?: Date) {
  return value
    ? `UPDATED ${value.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
    : "LOADING";
}

createRoot(document.getElementById("root")!).render(<App />);
