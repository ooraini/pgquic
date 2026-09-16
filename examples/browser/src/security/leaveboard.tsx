import { useState } from "react";
import {
  useConnectionStatus,
  useDatabase,
  usePgLiveQuery,
} from "../shared/react-pg";
import { RequestDialog, SecurityDrawer } from "./overlays";
import { RequestPanel } from "./request-panel";
import type {
  AuditRow,
  DatabaseCommand,
  Profile,
  RequestRow,
  SecurityInfo,
} from "./types";

export function Leaveboard({ logout }: { logout: () => void }) {
  const status = useConnectionStatus();
  const { pool } = useDatabase();
  const [showCreate, setShowCreate] = useState(false);
  const [showSecurity, setShowSecurity] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{
    kind: "ok" | "error";
    text: string;
  } | null>(null);

  // All personas issue the same reads. Row-level security and role membership
  // decide which request and audit rows PostgreSQL returns for the session.
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

  const command: DatabaseCommand = async (key, text, values, success) => {
    setBusy(key);
    setMessage(null);
    try {
      // Mutations call narrow SECURITY DEFINER functions; table writes are not
      // granted to browser roles, so policy checks stay inside PostgreSQL.
      await pool.query(text, values);
      await refresh();
      setMessage({ kind: "ok", text: success });
    } catch (value) {
      setMessage({ kind: "error", text: cleanError(value) });
    } finally {
      setBusy(null);
    }
  };

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
          <RequestPanel
            actor={actor}
            rows={requests.rows}
            loading={requests.loading}
            busy={busy}
            command={command}
          />
          <AuditPanel rows={audits.rows} />
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

function AuditPanel({ rows }: { rows: AuditRow[] }) {
  return (
    <aside className="audit-panel" id="activity">
      <div className="section-heading">
        <div>
          <p className="kicker">APPEND-ONLY</p>
          <h2>Audit trail</h2>
        </div>
      </div>
      <div className="timeline">
        {rows.length === 0 && (
          <div className="empty compact">
            Actions taken in this demo appear here.
          </div>
        )}
        {rows.map((audit) => (
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
