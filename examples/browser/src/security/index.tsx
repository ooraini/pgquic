import { useState } from "react";
import { createRoot } from "react-dom/client";
import { DatabaseProvider, type DatabaseConfig } from "../shared/react-pg";
import { Leaveboard } from "./leaveboard";
import { Login } from "./login";
import "./style.css";

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

createRoot(document.getElementById("root")!).render(<App />);
