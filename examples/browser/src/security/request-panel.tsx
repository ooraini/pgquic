import type { DatabaseCommand, Profile, RequestRow } from "./types";

export function RequestPanel({
  actor,
  rows,
  loading,
  busy,
  command,
}: {
  actor?: Profile;
  rows: RequestRow[];
  loading: boolean;
  busy: string | null;
  command: DatabaseCommand;
}) {
  return (
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
        <span>{rows.length} rows returned</span>
      </div>
      <div className="request-list">
        {loading && (
          <div className="empty">Asking PostgreSQL what you may see…</div>
        )}
        {!loading && rows.length === 0 && (
          <div className="empty">No requests are visible to this role.</div>
        )}
        {rows.map((request) => (
          <article className="request" key={request.id}>
            <div className="date-block">
              <strong>{datePart(request.starts_on, "day")}</strong>
              <span>{datePart(request.starts_on, "month")}</span>
            </div>
            <div className="request-copy">
              <div className="request-title">
                <strong>{request.employee_name}</strong>
                <span className={`status ${request.status}`}>
                  {request.status}
                </span>
              </div>
              <p>{request.reason}</p>
              <small>
                {formatRange(request.starts_on, request.ends_on)} ·{" "}
                {request.days} {request.days === 1 ? "day" : "days"}
                {request.manager_note ? ` · “${request.manager_note}”` : ""}
              </small>
            </div>
            <RequestActions
              actor={actor}
              request={request}
              busy={busy === request.id}
              command={command}
            />
          </article>
        ))}
      </div>
    </div>
  );
}

function RequestActions({
  actor,
  request,
  busy,
  command,
}: {
  actor?: Profile;
  request: RequestRow;
  busy: boolean;
  command: DatabaseCommand;
}) {
  const isEmployee = actor?.persona === "employee" && request.is_mine;
  const isManager =
    actor?.persona === "manager" &&
    request.is_direct_report &&
    request.status === "submitted";

  return (
    <div className="request-actions">
      {isEmployee && request.status === "draft" && (
        <button
          disabled={busy}
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
      {isEmployee && ["draft", "submitted"].includes(request.status) && (
        <button
          className="quiet danger"
          disabled={busy}
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
      {isManager && (
        <>
          <button
            disabled={busy}
            onClick={() =>
              void command(
                request.id,
                "select vacation.decide_request($1, 'approved', $2)",
                [request.id, "Approved — enjoy your time away."],
                `${request.employee_name}'s request was approved.`,
              )
            }
          >
            Approve
          </button>
          <button
            className="quiet danger"
            disabled={busy}
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
  );
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
