import { authClient } from "./auth";
import { Dashboard } from "./Dashboard";
import { SignIn } from "./SignIn";

export function App() {
  const session = authClient.useSession();

  if (session.isPending) return <main className="center muted">Loading…</main>;
  if (!session.data) return <SignIn />;
  // Keyed by user so switching accounts tears down the Realtime client.
  return <Dashboard key={session.data.user.id} email={session.data.user.email} />;
}
