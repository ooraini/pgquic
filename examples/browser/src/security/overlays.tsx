import { useState } from "react";
import type { Persona, SecurityInfo } from "./types";

export function RequestDialog({
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
      onMouseDown={(event) => event.target === event.currentTarget && close()}
    >
      <form
        className="modal"
        onSubmit={(event) => {
          event.preventDefault();
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
              onChange={(event) => setStart(event.target.value)}
              required
            />
          </label>
          <label>
            Last day
            <input
              type="date"
              value={end}
              onChange={(event) => setEnd(event.target.value)}
              required
            />
          </label>
        </div>
        <label>
          Reason
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
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

export function SecurityDrawer({
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
      onMouseDown={(event) => event.target === event.currentTarget && close()}
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
