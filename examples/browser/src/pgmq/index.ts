import { Pool, PgWebTransport } from "@ooraini/pgquic";
import "./style.css";

type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;
type JsonObject = { [key: string]: JsonValue };

type QueueMetric = {
  queue_name: string;
  queue_length: string;
  newest_msg_age_sec: number | null;
  oldest_msg_age_sec: number | null;
  total_messages: string;
  scrape_time: Date | string;
  queue_visible_length: string;
};

type Message = {
  msg_id: string;
  read_ct: number;
  enqueued_at: Date | string;
  last_read_at: Date | string | null;
  vt: Date | string;
  message: JsonValue;
  headers: JsonValue;
};

type QueueHead = Message & {
  queue_name: string;
  archive_count: string;
};

type ArchivedMessage = Message & {
  queue_name: string;
  archived_at: Date | string;
};

const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const fileMode = location.protocol === "file:";
const encodedHash = import.meta.env.VITE_PGQUIC_CERT_HASH as string | undefined;
let transport: PgWebTransport | undefined;
let pool: InstanceType<typeof Pool> | undefined;
let selectedQueue: string | undefined;
let refreshing = false;
let toastTimer = 0;

$<HTMLInputElement>("certificate-hash").value = encodedHash ?? "";
renderRuntimeNote();

function certificateHashes() {
  const encoded = $<HTMLInputElement>("certificate-hash").value.trim();
  if (!encoded) return undefined;
  try {
    const value = Uint8Array.from(atob(encoded), (character) =>
      character.charCodeAt(0),
    );
    if (value.byteLength !== 32) throw new Error("wrong length");
    return [{ algorithm: "sha-256" as const, value }];
  } catch {
    throw new Error("Certificate SHA-256 must be a 32-byte base64 value.");
  }
}

async function connect() {
  setConnectionState("connecting");
  if (pool) await pool.end().catch(() => undefined);
  if (transport) await transport.close().catch(() => undefined);

  transport = new PgWebTransport({
    url: $<HTMLInputElement>("gateway-url").value.trim(),
    token: () => $<HTMLInputElement>("jwt").value.trim(),
    maxConnections: 6,
    serverCertificateHashes: certificateHashes(),
  });
  pool = new Pool({
    transport,
    max: 6,
    user: "browser_user",
    password: "development-only-password",
    database: "app",
    ssl: false,
    enableChannelBinding: false,
  } as never);
  transport.addEventListener("statechange", () => {
    if (transport) setConnectionState(transport.state.status);
  });
  await refresh();
}

async function refresh() {
  if (!pool || refreshing) return;
  refreshing = true;
  $<HTMLButtonElement>("refresh").disabled = true;
  try {
    // PGMQ metrics are extension APIs; the companion helpers hide dynamic
    // per-queue table names behind a small, permission-checked surface.
    const [metricResult, headResult, archiveResult] = await Promise.all([
      pool.query("select * from pgmq.metrics_all() order by queue_name"),
      pool.query("select * from public.demo_pgmq_queue_heads()"),
      pool.query(`
        select * from public.demo_pgmq_archives(200)
        order by archived_at desc, queue_name, msg_id desc
        limit 200
      `),
    ]);
    const metrics = metricResult.rows as QueueMetric[];
    const heads = headResult.rows as QueueHead[];
    const archives = archiveResult.rows as ArchivedMessage[];

    if (selectedQueue && !metrics.some((row) => row.queue_name === selectedQueue))
      selectedQueue = undefined;
    renderMetrics(metrics, heads);
    renderQueues(metrics, heads);
    renderArchives(archives);
    if (selectedQueue) await refreshMessages(selectedQueue);
    else renderMessages([]);
    $("updated-at").textContent = `updated ${formatClock(new Date())}`;
    setConnectionState("connected");
  } catch (error) {
    setConnectionState("error");
    showToast(actionableError(error), true);
  } finally {
    refreshing = false;
    $<HTMLButtonElement>("refresh").disabled = false;
  }
}

async function refreshMessages(queueName: string) {
  if (!pool) return;
  const result = await pool.query(
    "select * from public.demo_pgmq_messages($1::text, 500)",
    [queueName],
  );
  if (selectedQueue === queueName) renderMessages(result.rows as Message[]);
}

function renderMetrics(metrics: QueueMetric[], heads: QueueHead[]) {
  $("queue-count").textContent = String(metrics.length);
  $("queued-count").textContent = String(
    metrics.reduce((sum, row) => sum + Number(row.queue_length), 0),
  );
  $("visible-count").textContent = String(
    metrics.reduce((sum, row) => sum + Number(row.queue_visible_length), 0),
  );
  $("archive-count").textContent = String(
    heads.reduce((sum, row) => sum + Number(row.archive_count), 0),
  );
}

function renderQueues(metrics: QueueMetric[], heads: QueueHead[]) {
  const grid = $("queue-grid");
  grid.replaceChildren();
  $("queues-empty").hidden = metrics.length !== 0;
  const headByQueue = new Map(heads.map((head) => [head.queue_name, head]));

  for (const metric of metrics) {
    const head = headByQueue.get(metric.queue_name);
    const card = document.createElement("article");
    card.className = `queue${selectedQueue === metric.queue_name ? " selected" : ""}`;

    const heading = document.createElement("div");
    heading.className = "queue-heading";
    const title = document.createElement("div");
    const name = document.createElement("h3");
    name.textContent = metric.queue_name;
    const produced = document.createElement("span");
    produced.textContent = `${metric.total_messages} sent all time`;
    title.append(name, produced);
    const inspect = actionButton("Inspect queue", "select-queue");
    inspect.dataset.queue = metric.queue_name;
    heading.append(title, inspect);

    const stats = document.createElement("dl");
    stats.className = "queue-stats";
    stats.append(
      stat("Queued", metric.queue_length),
      stat("Visible", metric.queue_visible_length),
      stat("Oldest", age(metric.oldest_msg_age_sec)),
      stat("Archived", head?.archive_count ?? "0"),
    );

    const preview = document.createElement("div");
    preview.className = "head-preview";
    const label = document.createElement("div");
    label.className = "preview-label";
    label.textContent = head?.msg_id ? `NEXT · #${head.msg_id}` : "QUEUE EMPTY";
    preview.append(label);
    if (head?.msg_id) {
      preview.append(
        jsonPanel("Body", head.message),
        jsonPanel("Headers", head.headers),
      );
    } else {
      const empty = document.createElement("p");
      empty.className = "subtle";
      empty.textContent = "No message is waiting in this queue.";
      preview.append(empty);
    }
    card.append(heading, stats, preview);
    grid.append(card);
  }
}

function renderMessages(messages: Message[]) {
  const list = $("messages-list");
  list.replaceChildren();
  $("selected-queue").textContent = selectedQueue ?? "Select a queue";
  const empty = $("messages-empty");
  empty.hidden = messages.length !== 0;
  if (!selectedQueue) empty.textContent = "Select a queue to inspect its messages.";
  else empty.textContent = "This queue has no messages.";

  for (const message of messages) {
    const item = messageCard(message);
    const actions = document.createElement("div");
    actions.className = "message-actions";
    const archive = actionButton("Archive", "archive");
    const remove = actionButton("Delete permanently", "delete", true);
    for (const button of [archive, remove]) {
      button.dataset.queue = selectedQueue;
      button.dataset.id = message.msg_id;
    }
    actions.append(archive, remove);
    item.querySelector(".message-heading")!.append(actions);
    list.append(item);
  }
}

function renderArchives(messages: ArchivedMessage[]) {
  const list = $("archive-list");
  list.replaceChildren();
  $("archive-empty").hidden = messages.length !== 0;
  for (const message of messages) {
    const item = messageCard(message, message.queue_name);
    const archived = document.createElement("span");
    archived.className = "archived-at";
    archived.textContent = `Archived ${formatDate(message.archived_at)}`;
    item.querySelector(".message-heading > div")!.append(archived);
    list.append(item);
  }
}

function messageCard(message: Message, queueName?: string) {
  const item = document.createElement("article");
  item.className = "message";
  const heading = document.createElement("div");
  heading.className = "message-heading";
  const identity = document.createElement("div");
  const title = document.createElement("h3");
  title.textContent = `${queueName ? `${queueName} · ` : ""}#${message.msg_id}`;
  const metadata = document.createElement("span");
  metadata.textContent = `${messageState(message.vt)} · enqueued ${formatDate(message.enqueued_at)} · read ${message.read_ct}×`;
  identity.append(title, metadata);
  heading.append(identity);
  const json = document.createElement("div");
  json.className = "json-grid";
  json.append(
    jsonPanel("Body", message.message),
    jsonPanel("Headers", message.headers),
  );
  item.append(heading, json);
  return item;
}

async function handleMessageAction(button: HTMLButtonElement) {
  if (!pool) return;
  const queueName = button.dataset.queue!;
  const id = button.dataset.id!;
  const action = button.dataset.action;
  if (
    action === "delete" &&
    !confirm(`Permanently delete message #${id} from ${queueName}?`)
  )
    return;

  button.disabled = true;
  try {
    // Queue names and message ids are passed as values to SECURITY DEFINER
    // helpers; the browser role never constructs or executes dynamic SQL.
    if (action === "archive") {
      const result = await pool.query(
        "select public.demo_pgmq_archive($1::text, $2::bigint) as changed",
        [queueName, id],
      );
      if (!result.rows[0]?.changed) throw new Error("Message no longer exists.");
      showToast(`Message #${id} archived from ${queueName}.`);
    } else if (action === "delete") {
      const result = await pool.query(
        "select public.demo_pgmq_delete($1::text, $2::bigint) as changed",
        [queueName, id],
      );
      if (!result.rows[0]?.changed) throw new Error("Message no longer exists.");
      showToast(`Message #${id} permanently deleted from ${queueName}.`);
    }
    await refresh();
  } catch (error) {
    showToast(actionableError(error), true);
  } finally {
    button.disabled = false;
  }
}

function jsonPanel(labelText: string, value: JsonValue) {
  const panel = document.createElement("div");
  panel.className = "json-panel";
  const label = document.createElement("span");
  label.textContent = labelText;
  const content = document.createElement("pre");
  content.textContent = value == null ? "null" : JSON.stringify(value, null, 2);
  panel.append(label, content);
  return panel;
}

function stat(labelText: string, value: string) {
  const wrapper = document.createElement("div");
  const valueElement = document.createElement("dd");
  valueElement.textContent = value;
  const label = document.createElement("dt");
  label.textContent = labelText;
  wrapper.append(valueElement, label);
  return wrapper;
}

function actionButton(label: string, action: string, danger = false) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.dataset.action = action;
  button.className = `small-button${danger ? " danger" : ""}`;
  return button;
}

function messageState(vt: Date | string) {
  return new Date(vt).getTime() <= Date.now() ? "visible" : `hidden until ${formatDate(vt)}`;
}

function age(seconds: number | null) {
  if (seconds == null) return "—";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86_400)}d`;
}

function setConnectionState(state: string) {
  const dot = $("connection-dot");
  dot.className = "status-dot";
  const normalized = state === "ready" ? "connected" : state;
  if (normalized === "connected") dot.classList.add("online");
  if (normalized === "error" || normalized === "closed") dot.classList.add("error");
  $("connection-status").textContent = normalized;
}

function renderRuntimeNote() {
  const messages: string[] = [];
  if (fileMode)
    messages.push("Portable file mode active; the gateway must allow the opaque file origin.");
  if (!window.isSecureContext) messages.push("This page needs a secure context.");
  if (!("WebTransport" in window))
    messages.push("This browser does not expose WebTransport.");
  const note = $("runtime-note");
  note.textContent = messages.join(" ") || "WebTransport runtime available.";
  note.classList.toggle("error", !window.isSecureContext || !("WebTransport" in window));
  if (fileMode) $<HTMLDetailsElement>("connection-settings").open = true;
}

function actionableError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  if (lower.includes("pgmq") && (lower.includes("does not exist") || lower.includes("schema")))
    return "PGMQ is not installed in the connected database. Rebuild the demo PostgreSQL image.";
  if (lower.includes("permission denied"))
    return `PostgreSQL rejected this operation: ${message}`;
  if (lower.includes("authentication failed"))
    return "PostgreSQL authentication failed. Check the demo role and gateway configuration.";
  if (lower.includes("certificate") || lower.includes("tls"))
    return "WebTransport certificate validation failed. Check the certificate hash.";
  return message;
}

function showToast(message: string, error = false) {
  const toast = $("toast");
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.className = `toast visible${error ? " error" : ""}`;
  toastTimer = window.setTimeout(() => (toast.className = "toast"), 5000);
}

function formatDate(value: Date | string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function formatClock(value: Date) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(value);
}

$("refresh").addEventListener("click", () => void refresh());
$("connection-form").addEventListener("submit", (event) => {
  event.preventDefault();
  void connect().catch((error) => showToast(actionableError(error), true));
});
$("queue-grid").addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
    "button[data-action='select-queue']",
  );
  if (!button) return;
  selectedQueue = button.dataset.queue;
  document.querySelectorAll(".queue").forEach((card) => {
    const queueButton = card.querySelector<HTMLButtonElement>(
      "button[data-action='select-queue']",
    );
    card.classList.toggle("selected", queueButton?.dataset.queue === selectedQueue);
  });
  $("selected-queue").textContent = selectedQueue ?? "Select a queue";
  void refreshMessages(selectedQueue!).catch((error) =>
    showToast(actionableError(error), true),
  );
  $("messages-list").scrollIntoView({ behavior: "smooth", block: "start" });
});
$("messages-list").addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
    "button[data-action]",
  );
  if (button) void handleMessageAction(button);
});

window.setInterval(() => {
  if ($<HTMLInputElement>("auto-refresh").checked) void refresh();
}, 5000);

void connect().catch((error) => showToast(actionableError(error), true));
