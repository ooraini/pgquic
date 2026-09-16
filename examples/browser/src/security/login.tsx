import { useState, type FormEvent } from "react";
import type { DatabaseConfig } from "../shared/react-pg";

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

export function Login({
  connect,
}: {
  connect: (config: DatabaseConfig) => void;
}) {
  const [user, setUser] = useState("ava_employee");
  const [password, setPassword] = useState("ava-vacation-demo");
  const [url, setUrl] = useState("https://localhost:4433/v1/session");
  const [token, setToken] = useState("");

  function choose(chosen: (typeof personas)[number]) {
    setUser(chosen.user);
    setPassword(chosen.password);
  }

  // The selected persona changes the actual PostgreSQL login. No employee or
  // tenant id is sent later to simulate identity in application queries.
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
              onChange={(event) => setUser(event.target.value)}
              autoComplete="username"
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
            />
          </label>
          <details>
            <summary>Connection settings</summary>
            <label>
              Gateway URL
              <input
                value={url}
                onChange={(event) => setUrl(event.target.value)}
              />
            </label>
            <label>
              JWT <small>optional</small>
              <input
                type="password"
                value={token}
                onChange={(event) => setToken(event.target.value)}
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
