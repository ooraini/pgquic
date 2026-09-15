import { Pool, PgWebTransport } from "@pgquic/client";
import "./cursors.css";

type CursorKind = "join" | "move" | "heartbeat" | "leave";
type CursorMessage = {
  v: 1;
  kind: CursorKind;
  id: string;
  name: string;
  color: string;
  x: number;
  y: number;
  seq: number;
};
type Participant = CursorMessage & { seenAt: number; element: HTMLElement };

const CHANNEL = "pgquic_shared_cursors";
const MOVE_INTERVAL_MS = 50;
const HEARTBEAT_INTERVAL_MS = 8_000;
const STALE_AFTER_MS = 24_000;
const colors = [
  "#5868d9",
  "#dd6658",
  "#168678",
  "#bd722b",
  "#8c5db7",
  "#3977a8",
  "#c24f82",
];
const names = [
  "Quiet Badger",
  "Silver Finch",
  "Curious Otter",
  "Indigo Fox",
  "Swift Heron",
  "Clever Moth",
  "Golden Lynx",
];

const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const identity = {
  id: crypto.randomUUID(),
  name: localStorage.getItem("pgquic-cursor-name") || randomItem(names),
  color: randomItem(colors),
  x: 0.5,
  y: 0.58,
  seq: 0,
};
const participants = new Map<string, Participant>();
const encodedHash = import.meta.env.VITE_PGQUIC_CERT_HASH as string | undefined;
const fileMode = location.protocol === "file:";
let transport: PgWebTransport | undefined;
let pool: InstanceType<typeof Pool> | undefined;
let listener:
  | Awaited<ReturnType<InstanceType<typeof Pool>["connect"]>>
  | undefined;
let pendingKind: CursorKind | undefined;
let publishTimer = 0;
let publishing = false;
let lastPublish = 0;

$<HTMLInputElement>("display-name").value = identity.name;
$<HTMLInputElement>("certificate-hash").value = encodedHash ?? "";
$("identity-swatch").style.setProperty("--identity-color", identity.color);
$("runtime-note").textContent = fileMode
  ? "Portable file mode is active. The gateway must allow the opaque file origin."
  : "WebTransport requires a secure context and a browser with HTTP/3 support.";
renderParticipant(message("join"), true);
void connect();

function randomItem<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

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
  await disconnect();
  setConnectionState("connecting", "Connecting");
  setActivity("Opening a LISTEN connection to PostgreSQL…");
  if (!window.isSecureContext || !("WebTransport" in window)) {
    setConnectionState("error", "Unavailable");
    setActivity(
      "This browser needs a secure context with WebTransport support.",
    );
    return;
  }
  try {
    transport = new PgWebTransport({
      url: $<HTMLInputElement>("gateway-url").value.trim(),
      token: () => $<HTMLInputElement>("jwt").value.trim(),
      maxConnections: 3,
      serverCertificateHashes: certificateHashes(),
    });
    pool = new Pool({
      transport,
      max: 3,
      user: "browser_user",
      password: "development-only-password",
      database: "app",
      ssl: false,
      enableChannelBinding: false,
    } as never);
    transport.addEventListener("statechange", renderTransportState);
    listener = await pool.connect();
    listener.on(
      "notification",
      (notification: { channel: string; payload?: string }) => {
        if (notification.channel === CHANNEL && notification.payload)
          receive(notification.payload);
      },
    );
    listener.on("error", (error: Error) => {
      setConnectionState("error", "Disconnected");
      setActivity(actionableError(error));
    });
    await listener.query(`LISTEN ${CHANNEL}`);
    setConnectionState("connected", "Live");
    setActivity("Listening on pgquic_shared_cursors");
    queuePublish("join", true);
  } catch (error) {
    setConnectionState("error", "Connection failed");
    setActivity(actionableError(error));
  }
}

async function disconnect() {
  pendingKind = undefined;
  window.clearTimeout(publishTimer);
  publishTimer = 0;
  if (listener) {
    listener.removeAllListeners();
    listener.release(true);
    listener = undefined;
  }
  if (pool) await pool.end().catch(() => undefined);
  if (transport) await transport.close().catch(() => undefined);
  pool = undefined;
  transport = undefined;
}

function message(kind: CursorKind): CursorMessage {
  return {
    v: 1,
    kind,
    id: identity.id,
    name: identity.name,
    color: identity.color,
    x: identity.x,
    y: identity.y,
    seq: ++identity.seq,
  };
}

function queuePublish(kind: CursorKind, immediate = false) {
  pendingKind = kind;
  if (!pool || publishing) return;
  const delay = immediate
    ? 0
    : Math.max(0, MOVE_INTERVAL_MS - (performance.now() - lastPublish));
  if (publishTimer) return;
  publishTimer = window.setTimeout(() => void flushPublish(), delay);
}

async function flushPublish() {
  publishTimer = 0;
  if (!pool || !pendingKind || publishing) return;
  const kind = pendingKind;
  pendingKind = undefined;
  const update = message(kind);
  publishing = true;
  lastPublish = performance.now();
  try {
    await pool.query("select pg_notify($1, $2)", [
      CHANNEL,
      JSON.stringify(update),
    ]);
    if (kind === "move")
      setActivity("Cursor update delivered through PostgreSQL");
  } catch (error) {
    setConnectionState("error", "Publish failed");
    setActivity(actionableError(error));
  } finally {
    publishing = false;
    if (pendingKind) queuePublish(pendingKind);
  }
}

function receive(payload: string) {
  try {
    const update = JSON.parse(payload) as Partial<CursorMessage>;
    if (!validMessage(update)) return;
    if (update.kind === "leave") {
      removeParticipant(update.id);
      return;
    }
    const isNew = !participants.has(update.id);
    renderParticipant(update, update.id === identity.id);
    if (isNew && update.id !== identity.id) queuePublish("heartbeat", true);
  } catch {
    // A shared PostgreSQL channel is untrusted input; malformed payloads are ignored.
  }
}

function validMessage(value: Partial<CursorMessage>): value is CursorMessage {
  return (
    value.v === 1 &&
    typeof value.id === "string" &&
    value.id.length <= 64 &&
    typeof value.name === "string" &&
    value.name.length > 0 &&
    value.name.length <= 24 &&
    typeof value.color === "string" &&
    colors.includes(value.color) &&
    typeof value.x === "number" &&
    value.x >= 0 &&
    value.x <= 1 &&
    typeof value.y === "number" &&
    value.y >= 0 &&
    value.y <= 1 &&
    typeof value.seq === "number" &&
    ["join", "move", "heartbeat", "leave"].includes(value.kind ?? "")
  );
}

function renderParticipant(update: CursorMessage, local = false) {
  let participant = participants.get(update.id);
  if (participant && update.seq < participant.seq) return;
  if (!participant) {
    const fragment = $<HTMLTemplateElement>(
      "cursor-template",
    ).content.cloneNode(true) as DocumentFragment;
    const element = fragment.firstElementChild as HTMLElement;
    element.dataset.participant = update.id;
    if (local) element.classList.add("local");
    $("cursor-layer").append(element);
    participant = { ...update, seenAt: Date.now(), element };
  }
  Object.assign(participant, update, { seenAt: Date.now() });
  participant.element.classList.remove("away");
  participant.element.style.setProperty("--cursor-color", update.color);
  participant.element.style.setProperty(
    "--x",
    `${update.x * window.innerWidth}px`,
  );
  participant.element.style.setProperty(
    "--y",
    `${update.y * window.innerHeight}px`,
  );
  const label = participant.element.querySelector("span");
  if (label) label.textContent = local ? `${update.name} · you` : update.name;
  participants.set(update.id, participant);
  renderPresence();
}

function removeParticipant(id: string) {
  if (id === identity.id) return;
  participants.get(id)?.element.remove();
  participants.delete(id);
  renderPresence();
}

function renderPresence() {
  const current = [...participants.values()];
  $("presence-count").textContent =
    `${current.length} ${current.length === 1 ? "person" : "people"}`;
  const faces = $("presence-faces");
  faces.replaceChildren();
  for (const person of current.slice(0, 5)) {
    const face = document.createElement("span");
    face.className = "presence-face";
    face.style.background = person.color;
    face.textContent = person.name.charAt(0);
    face.title = person.name;
    faces.append(face);
  }
}

function renderTransportState() {
  if (!transport) return;
  const status = transport.state.status;
  if (status === "ready") setConnectionState("connected", "Live");
  else if (status === "closed") setConnectionState("error", "Closed");
  else setConnectionState("connecting", status);
}

function setConnectionState(state: string, label: string) {
  $("connection-dot").className = `connection-dot ${state}`;
  $("connection-status").textContent = label;
}
function setActivity(text: string) {
  $("activity").textContent = text;
}

function actionableError(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error);
  const lower = raw.toLowerCase();
  if (lower.includes("authentication failed"))
    return "Authentication failed — check the gateway JWT and PostgreSQL credentials.";
  if (lower.includes("certificate") || lower.includes("tls"))
    return "Certificate rejected — trust it locally or add its SHA-256 hash in settings.";
  if (lower.includes("origin") || lower.includes("403"))
    return "Origin rejected — allow this origin in the pgquic gateway.";
  return raw;
}

$("canvas").addEventListener("pointermove", (event) => {
  if ((event.target as HTMLElement).closest("button, input, a, dialog")) return;
  identity.x = Math.min(1, Math.max(0, event.clientX / window.innerWidth));
  identity.y = Math.min(1, Math.max(0, event.clientY / window.innerHeight));
  renderParticipant(message("move"), true);
  queuePublish("move");
});
window.addEventListener("resize", () => {
  for (const participant of participants.values())
    renderParticipant(participant, participant.id === identity.id);
});
$<HTMLInputElement>("display-name").addEventListener("change", (event) => {
  const input = event.currentTarget as HTMLInputElement;
  identity.name = input.value.trim().slice(0, 24) || randomItem(names);
  input.value = identity.name;
  localStorage.setItem("pgquic-cursor-name", identity.name);
  renderParticipant(message("heartbeat"), true);
  queuePublish("heartbeat", true);
});
$("open-settings").addEventListener("click", () =>
  $<HTMLDialogElement>("settings-dialog").showModal(),
);
$("close-settings").addEventListener("click", () =>
  $<HTMLDialogElement>("settings-dialog").close(),
);
$<HTMLFormElement>("settings-form").addEventListener("submit", (event) => {
  event.preventDefault();
  $<HTMLDialogElement>("settings-dialog").close();
  void connect();
});

window.setInterval(() => queuePublish("heartbeat"), HEARTBEAT_INTERVAL_MS);
window.setInterval(() => {
  const now = Date.now();
  for (const participant of participants.values()) {
    if (participant.id === identity.id) continue;
    if (now - participant.seenAt > STALE_AFTER_MS)
      removeParticipant(participant.id);
    else if (now - participant.seenAt > HEARTBEAT_INTERVAL_MS * 1.5)
      participant.element.classList.add("away");
  }
}, 2_000);
window.addEventListener("pagehide", () => {
  pendingKind = "leave";
  void flushPublish();
});
