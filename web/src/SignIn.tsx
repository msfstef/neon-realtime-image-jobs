import { type FormEvent, useState } from "react";

import { authClient } from "./auth";

export function SignIn() {
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email"));
    const password = String(form.get("password"));
    setPending(true);
    setError(undefined);
    const result =
      mode === "sign-up"
        ? await authClient.signUp.email({ email, password, name: email.split("@")[0] ?? email })
        : await authClient.signIn.email({ email, password });
    setPending(false);
    if (result.error) setError(result.error.message ?? "Authentication failed");
  }

  return (
    <main className="center">
      <form className="card auth" onSubmit={submit}>
        <p className="eyebrow">Neon Realtime demo</p>
        <h1>Image jobs</h1>
        <p className="muted">
          Upload images to a Neon Function and watch it store, resize, and classify them live.
        </p>
        <label>
          Email
          <input name="email" type="email" autoComplete="email" required />
        </label>
        <label>
          Password
          <input
            name="password"
            type="password"
            minLength={8}
            autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
            required
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="primary" disabled={pending} type="submit">
          {pending ? "…" : mode === "sign-up" ? "Create account" : "Sign in"}
        </button>
        <button
          className="link"
          type="button"
          onClick={() => setMode(mode === "sign-up" ? "sign-in" : "sign-up")}
        >
          {mode === "sign-up" ? "Have an account? Sign in" : "New here? Create an account"}
        </button>
      </form>
    </main>
  );
}
