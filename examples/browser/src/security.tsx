import { useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import {
  DatabaseProvider,
  useConnectionStatus,
  useDatabase,
  usePgLiveQuery,
  type DatabaseConfig,
} from "./react-pg";
import "./security.css";

type Persona = "employee" | "manager" | "hr";
type Profile = {
  id: string;
  display_name: string;
  title: string;
  persona: Persona;
  allowance_days: number;
  visible_requests: string;
};
type RequestRow = {
  id: string;
  employee_id: string;
  employee_name: string;
  employee_title: string;
  starts_on: string;
  ends_on: string;
  days: number;
  reason: string;
  status: "draft" | "submitted" | "approved" | "rejected" | "cancelled";
  manager_note: string | null;
  updated_at: string;
  is_mine: boolean;
  is_direct_report: boolean;
};
type AuditRow = {
  id: string;
  request_id: string;
  actor: string;
  actor_name: string | null;
  action: string;
  from_status: string | null;
  to_status: string;
  occurred_at: string;
};
type SecurityInfo = {
  current_user: string;
  session_user: string;
  is_employee: boolean;
  is_manager: boolean;
  is_hr: boolean;
  row_security: string;
};

const personas = [
  {
    user: "ava_employee",
    password: "ava-vacation-demo",
    name: "Ava",
    role: "Employee",
    note: "Own requests only",
  },
  {
    user: "noah_employee",
    password: "noah-vacation-demo",
    name: "Noah",
    role: "Employee",
    note: "A different row set",
  },
  {
    user: "maya_manager",
    password: "maya-vacation-demo",
    name: "Maya",
    role: "Manager",
    note: "Direct reports + approvals",
  },
  {
    user: "finn_hr",
    password: "finn-vacation-demo",
    name: "Finn",
    role: "HR auditor",
    note: "All requests, read only",
  },
] as const;

const encodedHash = import.meta.env.VITE_PGQUIC_CERT_HASH as string | undefined;

function App() {
  const [session, setSession] = useState<DatabaseConfig | null>(null);
  return session ? (
    <DatabaseProvider config={session}>
      <Leaveboard logout={() => setSession(null)} />
    </DatabaseProvider>
  ) : (
    <Login connect={setSession} />
  );
}

function Login({ connect }: { connect: (config: DatabaseConfig) => void }) {
  const [user, setUser] = useState("ava_employee");
  const [password, setPassword] = useState("ava-vacation-demo");
  const [url, setUrl] = useState("https://localhost:4433/v1/session");
  const [token, setToken] = useState("");

  function choose(chosen: (typeof personas)[number]) {
    setUser(chosen.user);
    setPassword(chosen.password);
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    connect({
      url,
      token,
      certificateHash: encodedHash,
      user,
      password,
      database: "app",
      notificationChannels: ["vacation_requests"],
    });
    setPassword("");
  }

  return (
    <main className="login-shell">
      <section className="login-story">
        <a className="brand" href="/">
          pgquic / leaveboard
        </a>
        <p className="kicker">POSTGRESQL IS THE BACKEND</p>
        <h1>
          Your login
          <br />
          changes the view.
        </h1>
        <p className="login-lede">
          The browser connects with your PostgreSQL credentials. Row-level
          security decides what appears; grants and functions decide what
          changes.
        </p>
        <div className="policy-lines" aria-label="Security properties">
          <span>SCRAM authentication</span>
          <span>Row-level security</span>
          <span>Audited state changes</span>
          <span>Live database events</span>
        </div>
      </section>
      <section className="login-card">
        <div>
          <p className="kicker">CHOOSE A DATABASE PERSONA</p>
          <h2>Sign in to Leaveboard</h2>
        </div>
        <div className="persona-grid">
          {personas.map((persona) => (
            <button
              type="button"
              className={user === persona.user ? "persona selected" : "persona"}
              key={persona.user}
              onClick={() => choose(persona)}
            >
              <span className="persona-avatar">{persona.name[0]}</span>
              <span>
                <strong>{persona.name}</strong>
                <small>{persona.role}</small>
              </span>
              <em>{persona.note}</em>
            </button>
          ))}
        </div>
        <form onSubmit={submit}>
          <label>
            PostgreSQL role
            <input
              value={user}
              onChange={(e) => setUser(e.target.value)}
              autoComplete="username"
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </label>
          <details>
            <summary>Connection settings</summary>
            <label>
              Gateway URL
              <input value={url} onChange={(e) => setUrl(e.target.value)} />
            </label>
            <label>
              JWT <small>optional</small>
              <input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
              />
            </label>
          </details>
          <button className="primary" type="submit">
            Connect directly to PostgreSQL <span>→</span>
          </button>
        </form>
        <p className="credential-note">
          Demo credentials only. The password stays in memory and is discarded
          on logout.
        </p>
      </section>
    </main>
  );
}

function Leaveboard({ logout }: { logout: () => void }) {
  const status = useConnectionStatus();
  const { pool } = useDatabase();
  const [showCreate, setShowCreate] = useState(false);
  const [showSecurity, setShowSecurity] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{
    kind: "ok" | "error";
    text: string;
  } | null>(null);

  const profile = usePgLiveQuery<Profile>(
    "vacation-profile",
    "select * from vacation.current_profile()",
    ["vacation_requests"],
  );
  const requests = usePgLiveQuery<RequestRow>(
    "vacation-requests",
    `select r.id, r.employee_id, e.display_name as employee_name,
       e.title as employee_title, r.starts_on::text, r.ends_on::text,
       (r.ends_on - r.starts_on + 1)::integer as days, r.reason, r.status,
       r.manager_note, r.updated_at::text,
       r.employee_id = vacation.actor_employee_id() as is_mine,
       e.manager_id = vacation.actor_employee_id() as is_direct_report
     from vacation.requests r
     join vacation.employees e on e.id = r.employee_id
     order by case r.status when 'submitted' then 0 when 'draft' then 1 else 2 end,
       r.starts_on`,
    ["vacation_requests"],
  );
  const audits = usePgLiveQuery<AuditRow>(
    "vacation-audit",
    `select a.id::text, a.request_id, a.actor::text,
       e.display_name as actor_name, a.action, a.from_status, a.to_status,
       a.occurred_at::text
     from vacation.request_audit a
     left join vacation.employees e on e.database_role = a.actor
     order by a.occurred_at desc limit 12`,
    ["vacation_requests"],
  );
  const security = usePgLiveQuery<SecurityInfo>(
    "vacation-security",
    `select current_user::text, session_user::text,
       pg_has_role(current_user, 'vacation_employee', 'member') as is_employee,
       pg_has_role(current_user, 'vacation_manager', 'member') as is_manager,
       pg_has_role(current_user, 'vacation_hr', 'member') as is_hr,
       current_setting('row_security') as row_security`,
    [],
  );

  const actor = profile.rows[0];
  const securityInfo = security.rows[0];
  const ownApproved = requests.rows
    .filter((request) => request.is_mine && request.status === "approved")
    .reduce((sum, request) => sum + request.days, 0);
  const pending = requests.rows.filter(
    (request) => request.status === "submitted",
  ).length;
  const refresh = async () =>
    Promise.all([profile.refresh(), requests.refresh(), audits.refresh()]);

  async function command(
    key: string,
    text: string,
    values: unknown[],
    success: string,
  ) {
    setBusy(key);
    setMessage(null);
    try {
      await pool.query(text, values);
      await refresh();
      setMessage({ kind: "ok", text: success });
    } catch (value) {
      setMessage({ kind: "error", text: cleanError(value) });
    } finally {
      setBusy(null);
    }
  }

  const fatalError = profile.error ?? requests.error ?? security.error;
  if (fatalError && !actor) {
    return (
      <main className="connection-failed">
        <p className="kicker">POSTGRESQL REJECTED THE SESSION</p>
        <h1>Sign-in failed.</h1>
        <p>{cleanError(fatalError)}</p>
        <button className="primary" onClick={logout}>
          Return to login
        </button>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <aside className="app-nav">
        <a className="brand" href="#top">
          leaveboard
        </a>
        <nav>
          <a className="active" href="#requests">
            Requests
          </a>
          <a href="#activity">Audit trail</a>
        </nav>
        <div className="nav-bottom">
          <button
            className="security-button"
            onClick={() => setShowSecurity(true)}
          >
            ◉ Security inspector
          </button>
          <div className="identity">
            <span>{actor?.display_name?.[0] ?? "…"}</span>
            <div>
              <strong>{actor?.display_name ?? "Authenticating"}</strong>
              <small>{securityInfo?.current_user ?? "PostgreSQL"}</small>
            </div>
          </div>
          <button className="logout" onClick={logout}>
            Disconnect
          </button>
        </div>
      </aside>
      <main className="workspace" id="top">
        <header className="workspace-header">
          <div>
            <p className="kicker">
              {actor?.persona === "manager"
                ? "TEAM APPROVALS"
                : actor?.persona === "hr"
                  ? "ORGANIZATION AUDIT"
                  : "MY TIME AWAY"}
            </p>
            <h1>Vacation requests</h1>
          </div>
          <div className="header-actions">
            <span className={`connection ${status}`}>
              <i />
              {status}
            </span>
            {actor?.persona === "employee" && (
              <button className="primary" onClick={() => setShowCreate(true)}>
                + New request
              </button>
            )}
          </div>
        </header>

        {message && (
          <div className={`flash ${message.kind}`}>
            {message.text}
            <button onClick={() => setMessage(null)}>×</button>
          </div>
        )}
        <section className="metrics">
          <Metric
            label="Visible to this login"
            value={actor?.visible_requests ?? "—"}
            note="RLS-filtered rows"
          />
          <Metric
            label={
              actor?.persona === "employee"
                ? "Days approved"
                : "Awaiting decision"
            }
            value={
              actor?.persona === "employee"
                ? String(ownApproved)
                : String(pending)
            }
            note={
              actor?.persona === "employee"
                ? `of ${actor?.allowance_days ?? "—"} allowance`
                : "submitted requests"
            }
            accent
          />
          <Metric
            label="Database identity"
            value={securityInfo?.current_user?.split("_")[0] ?? "—"}
            note="session_user, not an app token"
            mono
          />
        </section>

        <section className="content-grid" id="requests">
          <div className="request-panel">
            <div className="section-heading">
              <div>
                <p className="kicker">POLICY-CONTROLLED RESULT SET</p>
                <h2>
                  {actor?.persona === "employee"
                    ? "Your requests"
                    : actor?.persona === "manager"
                      ? "Your team and requests"
                      : "All employee requests"}
                </h2>
              </div>
              <span>{requests.rows.length} rows returned</span>
            </div>
            <div className="request-list">
              {requests.loading && (
                <div className="empty">Asking PostgreSQL what you may see…</div>
              )}
              {!requests.loading && requests.rows.length === 0 && (
                <div className="empty">
                  No requests are visible to this role.
                </div>
              )}
              {requests.rows.map((request) => (
                <article className="request" key={request.id}>
                  <div className="date-block">
                    <strong>{datePart(request.starts_on, "day")}</strong>
                    <span>{datePart(request.starts_on, "month")}</span>
                  </div>
                  <div className="request-copy">
                    <div className="request-title">
                      <strong>{request.employee_name}</strong>
                      <Status value={request.status} />
                    </div>
                    <p>{request.reason}</p>
                    <small>
                      {formatRange(request.starts_on, request.ends_on)} ·{" "}
                      {request.days} {request.days === 1 ? "day" : "days"}
                      {request.manager_note
                        ? ` · “${request.manager_note}”`
                        : ""}
                    </small>
                  </div>
                  <div className="request-actions">
                    {actor?.persona === "employee" &&
                      request.is_mine &&
                      request.status === "draft" && (
                        <button
                          disabled={busy === request.id}
                          onClick={() =>
                            void command(
                              request.id,
                              "select vacation.submit_request($1)",
                              [request.id],
                              "Request submitted to your manager.",
                            )
                          }
                        >
                          Submit
                        </button>
                      )}
                    {actor?.persona === "employee" &&
                      request.is_mine &&
                      ["draft", "submitted"].includes(request.status) && (
                        <button
                          className="quiet danger"
                          disabled={busy === request.id}
                          onClick={() =>
                            void command(
                              request.id,
                              "select vacation.cancel_request($1)",
                              [request.id],
                              "Request cancelled.",
                            )
                          }
                        >
                          Cancel
                        </button>
                      )}
                    {actor?.persona === "manager" &&
                      request.is_direct_report &&
                      request.status === "submitted" && (
                        <>
                          <button
                            disabled={busy === request.id}
                            onClick={() =>
                              void command(
                                request.id,
                                "select vacation.decide_request($1, 'approved', $2)",
                                [
                                  request.id,
                                  "Approved — enjoy your time away.",
                                ],
                                `${request.employee_name}'s request was approved.`,
                              )
                            }
                          >
                            Approve
                          </button>
                          <button
                            className="quiet danger"
                            disabled={busy === request.id}
                            onClick={() =>
                              void command(
                                request.id,
                                "select vacation.decide_request($1, 'rejected', $2)",
                                [request.id, "Please choose another week."],
                                `${request.employee_name}'s request was declined.`,
                              )
                            }
                          >
                            Decline
                          </button>
                        </>
                      )}
                  </div>
                </article>
              ))}
            </div>
          </div>
          <aside className="audit-panel" id="activity">
            <div className="section-heading">
              <div>
                <p className="kicker">APPEND-ONLY</p>
                <h2>Audit trail</h2>
              </div>
            </div>
            <div className="timeline">
              {audits.rows.length === 0 && (
                <div className="empty compact">
                  Actions taken in this demo appear here.
                </div>
              )}
              {audits.rows.map((audit) => (
                <div className="audit" key={audit.id}>
                  <i />
                  <div>
                    <strong>{audit.actor_name ?? audit.actor}</strong>
                    <p>{audit.action} a request</p>
                    <small>
                      {relativeTime(audit.occurred_at)} · as {audit.actor}
                    </small>
                  </div>
                </div>
              ))}
            </div>
          </aside>
        </section>
      </main>

      {showCreate && (
        <RequestDialog
          close={() => setShowCreate(false)}
          create={async (start, end, reason) => {
            await command(
              "create",
              "select vacation.create_request($1, $2, $3)",
              [start, end, reason],
              "Draft vacation request created.",
            );
            setShowCreate(false);
          }}
          busy={busy === "create"}
        />
      )}
      {showSecurity && (
        <SecurityDrawer
          close={() => setShowSecurity(false)}
          info={securityInfo}
          persona={actor?.persona}
          visible={requests.rows.length}
        />
      )}
    </div>
  );
}

function RequestDialog({
  close,
  create,
  busy,
}: {
  close: () => void;
  create: (start: string, end: string, reason: string) => Promise<void>;
  busy: boolean;
}) {
  const soon = new Date(Date.now() + 14 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const later = new Date(Date.now() + 16 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const [start, setStart] = useState(soon);
  const [end, setEnd] = useState(later);
  const [reason, setReason] = useState("A well-earned break");
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <form
        className="modal"
        onSubmit={(e) => {
          e.preventDefault();
          void create(start, end, reason);
        }}
      >
        <button type="button" className="modal-close" onClick={close}>
          ×
        </button>
        <p className="kicker">NEW DRAFT</p>
        <h2>Request time away</h2>
        <div className="date-fields">
          <label>
            First day
            <input
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              required
            />
          </label>
          <label>
            Last day
            <input
              type="date"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              required
            />
          </label>
        </div>
        <label>
          Reason
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            minLength={3}
            maxLength={240}
            required
          />
        </label>
        <p className="form-note">
          PostgreSQL checks dates, overlaps, ownership, and state transitions.
        </p>
        <button className="primary full" disabled={busy}>
          {busy ? "Creating…" : "Save draft"}
        </button>
      </form>
    </div>
  );
}

function SecurityDrawer({
  close,
  info,
  persona,
  visible,
}: {
  close: () => void;
  info?: SecurityInfo;
  persona?: Persona;
  visible: number;
}) {
  return (
    <div
      className="drawer-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <aside className="security-drawer">
        <button className="modal-close" onClick={close}>
          ×
        </button>
        <p className="kicker">LIVE SESSION FACTS</p>
        <h2>Security inspector</h2>
        <p className="drawer-lede">
          These values come from the active PostgreSQL connection, not frontend
          claims.
        </p>
        <dl>
          <div>
            <dt>current_user</dt>
            <dd>{info?.current_user ?? "—"}</dd>
          </div>
          <div>
            <dt>session_user</dt>
            <dd>{info?.session_user ?? "—"}</dd>
          </div>
          <div>
            <dt>row_security</dt>
            <dd>{info?.row_security ?? "—"}</dd>
          </div>
          <div>
            <dt>rows returned</dt>
            <dd>{visible}</dd>
          </div>
        </dl>
        <h3>Inherited database roles</h3>
        <div className="role-list">
          <Role active={info?.is_employee}>vacation_employee</Role>
          <Role active={info?.is_manager}>vacation_manager</Role>
          <Role active={info?.is_hr}>vacation_hr</Role>
        </div>
        <div className="policy-card">
          <strong>Active policy</strong>
          <code>vacation.can_see_request(employee_id)</code>
          <p>
            {persona === "employee"
              ? "Matches only rows owned by this database login."
              : persona === "manager"
                ? "Matches the manager's own rows and direct reports."
                : "HR membership permits organization-wide SELECT only."}
          </p>
        </div>
        <button className="primary full" onClick={close}>
          Done
        </button>
      </aside>
    </div>
  );
}

function Role({ active, children }: { active?: boolean; children: string }) {
  return (
    <div className={active ? "role active" : "role"}>
      <i>{active ? "✓" : "–"}</i>
      <code>{children}</code>
      <span>{active ? "member" : "not granted"}</span>
    </div>
  );
}
function Metric({
  label,
  value,
  note,
  accent,
  mono,
}: {
  label: string;
  value: string;
  note: string;
  accent?: boolean;
  mono?: boolean;
}) {
  return (
    <article className={accent ? "metric accent" : "metric"}>
      <small>{label}</small>
      <strong className={mono ? "mono" : ""}>{value}</strong>
      <span>{note}</span>
    </article>
  );
}
function Status({ value }: { value: RequestRow["status"] }) {
  return <span className={`status ${value}`}>{value}</span>;
}
function datePart(value: string, part: "day" | "month") {
  return new Intl.DateTimeFormat(
    "en",
    part === "day" ? { day: "2-digit" } : { month: "short" },
  ).format(new Date(`${value}T12:00:00`));
}
function formatRange(start: string, end: string) {
  const format = new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return `${format.format(new Date(`${start}T12:00:00`))} – ${format.format(new Date(`${end}T12:00:00`))}`;
}
function relativeTime(value: string) {
  const minutes = Math.max(
    0,
    Math.round((Date.now() - new Date(value).getTime()) / 60_000),
  );
  return minutes < 1
    ? "just now"
    : minutes < 60
      ? `${minutes}m ago`
      : minutes < 1440
        ? `${Math.floor(minutes / 60)}h ago`
        : `${Math.floor(minutes / 1440)}d ago`;
}
function cleanError(value: unknown) {
  const message = value instanceof Error ? value.message : String(value);
  return message.replace(/^error:\s*/i, "");
}

createRoot(document.getElementById("root")!).render(<App />);
