import { Pool, PgWebTransport } from "@pgquic/client";
import "./pg-cron.css";

type Job = {
  jobid: string;
  jobname: string | null;
  schedule: string;
  command: string;
  database: string;
  username: string;
  active: boolean;
  last_status: string | null;
  last_start: Date | string | null;
};

type Run = {
  jobid: string;
  runid: string;
  job_pid: number | null;
  jobname: string | null;
  status: string;
  return_message: string | null;
  start_time: Date | string | null;
  end_time: Date | string | null;
};

type Setting = {
  name: string;
  setting: string;
  unit: string | null;
  context: string;
  pending_restart: boolean;
};

const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const fileMode = location.protocol === "file:";
const encodedHash = import.meta.env.VITE_PGQUIC_CERT_HASH as string | undefined;
const dialog = $<HTMLDialogElement>("job-dialog");
let transport: PgWebTransport | undefined;
let pool: InstanceType<typeof Pool> | undefined;
let jobs: Job[] = [];
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
    if (!transport) return;
    setConnectionState(transport.state.status);
  });
  await refresh();
}

async function refresh() {
  if (!pool || refreshing) return;
  refreshing = true;
  $<HTMLButtonElement>("refresh").disabled = true;
  try {
    const [jobResult, runResult, settingResult] = await Promise.all([
      pool.query(`
        select j.jobid::text, j.jobname, j.schedule, j.command,
               j.database, j.username, j.active,
               recent.status as last_status, recent.start_time as last_start
        from cron.job j
        left join lateral (
          select status, start_time
          from cron.job_run_details r
          where r.jobid = j.jobid
          order by r.start_time desc nulls last, r.runid desc
          limit 1
        ) recent on true
        order by j.jobid
      `),
      pool.query(`
        select r.jobid::text, r.runid::text, r.job_pid, j.jobname,
               r.status, r.return_message, r.start_time, r.end_time
        from cron.job_run_details r
        left join cron.job j on j.jobid = r.jobid
        order by r.start_time desc nulls last, r.runid desc
        limit 100
      `),
      pool.query(`
        select name, setting, unit, context, pending_restart
        from pg_settings
        where name like 'cron.%'
        order by name
      `),
    ]);
    jobs = jobResult.rows as Job[];
    const runs = runResult.rows as Run[];
    renderJobs(jobs);
    renderRuns(runs);
    renderSettings(settingResult.rows as Setting[]);
    renderMetrics(jobs, runs);
    $("jobs-updated").textContent = `updated ${formatClock(new Date())}`;
    setConnectionState("connected");
  } catch (error) {
    setConnectionState("error");
    showToast(actionableError(error), true);
  } finally {
    refreshing = false;
    $<HTMLButtonElement>("refresh").disabled = false;
  }
}

function renderJobs(rows: Job[]) {
  const body = $("jobs-body");
  body.replaceChildren();
  $("jobs-empty").hidden = rows.length !== 0;
  for (const job of rows) {
    const row = document.createElement("tr");
    row.append(
      cellWithJob(job),
      textCell(job.schedule, "schedule"),
      textCell(job.last_start ? relativeTime(job.last_start) : "Never"),
      badgeCell(job.active ? (job.last_status ?? "active") : "inactive"),
      actionCell(job),
    );
    body.append(row);
  }
}

function cellWithJob(job: Job) {
  const cell = document.createElement("td");
  const title = document.createElement("span");
  title.className = "job-title";
  title.textContent = job.jobname || `Untitled job`;
  const id = document.createElement("span");
  id.className = "job-id";
  id.textContent = ` #${job.jobid} · ${job.database} · ${job.username}`;
  const command = document.createElement("span");
  command.className = "command-preview";
  command.textContent = job.command;
  cell.append(title, id, command);
  return cell;
}

function actionCell(job: Job) {
  const cell = document.createElement("td");
  const actions = document.createElement("div");
  actions.className = "row-actions";
  actions.append(
    actionButton("Edit", "edit", job.jobid),
    actionButton(job.active ? "Pause" : "Resume", "toggle", job.jobid),
    actionButton("Delete", "delete", job.jobid, true),
  );
  cell.append(actions);
  return cell;
}

function renderRuns(rows: Run[]) {
  const body = $("runs-body");
  body.replaceChildren();
  $("runs-empty").hidden = rows.length !== 0;
  for (const run of rows) {
    const row = document.createElement("tr");
    row.append(
      textCell(`#${run.runid}`, "job-id"),
      textCell(run.jobname || `Job #${run.jobid}`),
      badgeCell(run.status),
      textCell(run.start_time ? formatDate(run.start_time) : "—"),
      textCell(duration(run.start_time, run.end_time)),
      textCell(run.return_message || "—"),
    );
    const action = document.createElement("td");
    action.className = "row-actions";
    if (run.status === "running" && run.job_pid) {
      action.append(
        actionButton("Cancel", "cancel-run", String(run.job_pid), true),
      );
    } else {
      action.append(actionButton("Clear", "clear-run", run.runid, true));
    }
    row.append(action);
    body.append(row);
  }
}

function renderSettings(rows: Setting[]) {
  const list = $("settings-list");
  list.replaceChildren();
  for (const setting of rows) {
    const wrapper = document.createElement("div");
    wrapper.className = "setting";
    const term = document.createElement("dt");
    term.textContent = setting.name.replace("cron.", "");
    const value = document.createElement("dd");
    const renderedValue = document.createElement("span");
    renderedValue.textContent = `${setting.setting}${setting.unit ?? ""}`;
    const context = document.createElement("span");
    context.className = "setting-context";
    context.textContent = setting.pending_restart
      ? "restart pending"
      : setting.context;
    value.append(renderedValue, context);
    wrapper.append(term, value);
    list.append(wrapper);
  }
}

function renderMetrics(jobRows: Job[], runRows: Run[]) {
  $("job-count").textContent = String(jobRows.length);
  $("active-count").textContent = String(
    jobRows.filter((job) => job.active).length,
  );
  $("running-count").textContent = String(
    runRows.filter((run) => run.status === "running").length,
  );
  const yesterday = Date.now() - 86_400_000;
  $("failed-count").textContent = String(
    runRows.filter(
      (run) =>
        run.status === "failed" &&
        run.start_time &&
        new Date(run.start_time).getTime() >= yesterday,
    ).length,
  );
}

function openCreateDialog() {
  $<HTMLFormElement>("job-form").reset();
  $("job-id").setAttribute("value", "");
  $<HTMLInputElement>("job-id").value = "";
  $<HTMLInputElement>("job-schedule").value = "*/5 * * * *";
  $<HTMLTextAreaElement>("job-command").value = "SELECT now();";
  $<HTMLInputElement>("job-database").value = "app";
  $<HTMLInputElement>("job-username").value = "browser_user";
  $<HTMLInputElement>("job-active").checked = true;
  $("job-dialog-kicker").textContent = "NEW SCHEDULE";
  $("job-dialog-title").textContent = "Create a job";
  $("save-job").textContent = "Create job";
  $("job-name").removeAttribute("disabled");
  $("cross-database-label").hidden = false;
  dialog.showModal();
}

function openEditDialog(job: Job) {
  $<HTMLInputElement>("job-id").value = job.jobid;
  $<HTMLInputElement>("job-name").value = job.jobname ?? "";
  $<HTMLInputElement>("job-name").disabled = true;
  $<HTMLInputElement>("job-schedule").value = job.schedule;
  $<HTMLTextAreaElement>("job-command").value = job.command;
  $<HTMLInputElement>("job-database").value = job.database;
  $<HTMLInputElement>("job-username").value = job.username;
  $<HTMLInputElement>("original-database").value = job.database;
  $<HTMLInputElement>("original-username").value = job.username;
  $<HTMLInputElement>("job-active").checked = job.active;
  $("job-dialog-kicker").textContent = `JOB #${job.jobid}`;
  $("job-dialog-title").textContent = "Edit job";
  $("save-job").textContent = "Save changes";
  $("cross-database-label").hidden = true;
  dialog.showModal();
}

async function saveJob(event: SubmitEvent) {
  event.preventDefault();
  if (!pool) return showToast("Connect to PostgreSQL first.", true);
  const button = $<HTMLButtonElement>("save-job");
  button.disabled = true;
  try {
    const id = $<HTMLInputElement>("job-id").value;
    const name = $<HTMLInputElement>("job-name").value.trim();
    const schedule = $<HTMLInputElement>("job-schedule").value.trim();
    const command = $<HTMLTextAreaElement>("job-command").value.trim();
    const database = $<HTMLInputElement>("job-database").value.trim();
    const username = $<HTMLInputElement>("job-username").value.trim();
    const active = $<HTMLInputElement>("job-active").checked;

    if (id) {
      const originalDatabase = $<HTMLInputElement>("original-database").value;
      const originalUsername = $<HTMLInputElement>("original-username").value;
      await pool.query(
        `select cron.alter_job(
          $1::bigint, $2::text, $3::text, $4::text, $5::text, $6::boolean
        )`,
        [
          id,
          schedule,
          command,
          database === originalDatabase ? null : database,
          username === originalUsername ? null : username,
          active,
        ],
      );
      showToast(`Job #${id} updated.`);
    } else {
      const crossDatabase = $<HTMLInputElement>("cross-database").checked;
      let result;
      if (crossDatabase) {
        if (!name) throw new Error("Cross-database jobs require a name.");
        result = await pool.query(
          `select cron.schedule_in_database(
            $1::text, $2::text, $3::text, $4::text, $5::text, $6::boolean
          ) as jobid`,
          [
            name,
            schedule,
            command,
            database,
            username === "browser_user" ? null : username || null,
            active,
          ],
        );
      } else if (name) {
        result = await pool.query(
          "select cron.schedule($1::text, $2::text, $3::text) as jobid",
          [name, schedule, command],
        );
      } else {
        result = await pool.query(
          "select cron.schedule($1::text, $2::text) as jobid",
          [schedule, command],
        );
      }
      const jobid = String(result.rows[0]?.jobid ?? "");
      if (!active && !crossDatabase) {
        await pool.query("select cron.alter_job($1::bigint, active => false)", [
          jobid,
        ]);
      }
      showToast(`Job #${jobid} scheduled.`);
    }
    dialog.close();
    await refresh();
  } catch (error) {
    showToast(actionableError(error), true);
  } finally {
    button.disabled = false;
  }
}

async function handleJobAction(button: HTMLButtonElement) {
  if (!pool) return;
  const action = button.dataset.action;
  const id = button.dataset.id!;
  const job = jobs.find((candidate) => candidate.jobid === id);
  if (!job) return;
  if (action === "edit") return openEditDialog(job);
  if (action === "delete" && !confirm(`Unschedule job #${id}?`)) return;
  button.disabled = true;
  try {
    if (action === "toggle") {
      await pool.query(
        "select cron.alter_job($1::bigint, active => $2::boolean)",
        [id, !job.active],
      );
      showToast(job.active ? `Job #${id} paused.` : `Job #${id} resumed.`);
    } else if (action === "delete") {
      if (job.jobname) {
        await pool.query("select cron.unschedule($1::text)", [job.jobname]);
      } else {
        await pool.query("select cron.unschedule($1::bigint)", [id]);
      }
      showToast(`Job #${id} unscheduled.`);
    }
    await refresh();
  } catch (error) {
    showToast(actionableError(error), true);
  } finally {
    button.disabled = false;
  }
}

async function handleRunAction(button: HTMLButtonElement) {
  if (!pool) return;
  button.disabled = true;
  try {
    if (button.dataset.action === "cancel-run") {
      await pool.query("select pg_cancel_backend($1::integer)", [
        button.dataset.id,
      ]);
      showToast(`Cancellation requested for backend ${button.dataset.id}.`);
    } else {
      await pool.query(
        "delete from cron.job_run_details where runid = $1::bigint",
        [button.dataset.id],
      );
      showToast(`Run #${button.dataset.id} cleared.`);
    }
    await refresh();
  } catch (error) {
    showToast(actionableError(error), true);
  } finally {
    button.disabled = false;
  }
}

function actionButton(
  label: string,
  action: string,
  id: string,
  danger = false,
) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.dataset.action = action;
  button.dataset.id = id;
  if (danger) button.classList.add("danger");
  return button;
}

function textCell(value: string, className?: string) {
  const cell = document.createElement("td");
  cell.textContent = value;
  if (className) cell.className = className;
  return cell;
}

function badgeCell(status: string) {
  const cell = document.createElement("td");
  const badge = document.createElement("span");
  const normalized = status.toLowerCase();
  badge.className = `badge ${normalized}`;
  badge.textContent = status;
  cell.append(badge);
  return cell;
}

function setConnectionState(state: string) {
  const dot = $("connection-dot");
  dot.className = "status-dot";
  const normalized = state === "ready" ? "connected" : state;
  if (normalized === "connected") dot.classList.add("online");
  if (normalized === "error" || normalized === "closed")
    dot.classList.add("error");
  $("connection-status").textContent = normalized;
}

function renderRuntimeNote() {
  const note = $("runtime-note");
  const messages: string[] = [];
  if (fileMode)
    messages.push(
      "Portable file mode active; the gateway must allow the opaque file origin.",
    );
  if (!window.isSecureContext)
    messages.push("This page needs a secure context.");
  if (!("WebTransport" in window))
    messages.push("This browser does not expose WebTransport.");
  note.textContent = messages.join(" ") || "WebTransport runtime available.";
  note.classList.toggle(
    "error",
    !window.isSecureContext || !("WebTransport" in window),
  );
  if (fileMode) $<HTMLDetailsElement>("connection-settings").open = true;
}

function actionableError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  if (lower.includes("cron") && lower.includes("does not exist"))
    return "pg_cron is not installed in the connected database.";
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

function relativeTime(value: Date | string) {
  const elapsed = Date.now() - new Date(value).getTime();
  if (elapsed < 60_000) return "just now";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m ago`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h ago`;
  return formatDate(value);
}

function duration(start: Date | string | null, end: Date | string | null) {
  if (!start) return "—";
  const milliseconds =
    (end ? new Date(end).getTime() : Date.now()) - new Date(start).getTime();
  if (milliseconds < 1000) return `${Math.max(0, milliseconds)}ms`;
  if (milliseconds < 60_000) return `${(milliseconds / 1000).toFixed(1)}s`;
  return `${Math.floor(milliseconds / 60_000)}m ${Math.floor((milliseconds % 60_000) / 1000)}s`;
}

$("new-job").addEventListener("click", openCreateDialog);
$("empty-new-job").addEventListener("click", openCreateDialog);
$("refresh").addEventListener("click", () => void refresh());
$("connection-form").addEventListener("submit", (event) => {
  event.preventDefault();
  void connect().catch((error) => showToast(actionableError(error), true));
});
$("job-form").addEventListener("submit", (event) => void saveJob(event));
document
  .querySelector("[data-close]")!
  .addEventListener("click", () => dialog.close());
$("jobs-body").addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
    "button[data-action]",
  );
  if (button) void handleJobAction(button);
});
$("runs-body").addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
    "button[data-action]",
  );
  if (button) void handleRunAction(button);
});
$("clear-history").addEventListener("click", async () => {
  if (
    !pool ||
    !confirm("Clear all completed run history visible to this role?")
  )
    return;
  try {
    await pool.query(
      "delete from cron.job_run_details where status <> 'running'",
    );
    showToast("Completed run history cleared.");
    await refresh();
  } catch (error) {
    showToast(actionableError(error), true);
  }
});

window.setInterval(() => {
  if (!document.hidden) void refresh();
}, 5000);

if (window.isSecureContext && "WebTransport" in window) {
  void connect().catch((error) => {
    setConnectionState("error");
    showToast(actionableError(error), true);
  });
} else {
  setConnectionState("unavailable");
}
