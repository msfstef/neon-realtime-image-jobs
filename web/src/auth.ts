import { createAuthClient } from "@neondatabase/auth";
import { BetterAuthReactAdapter } from "@neondatabase/auth/react/adapters";

// The app and Neon Auth live on different origins, so the session cookie must
// be sent on cross-origin requests.
export const authClient = createAuthClient(__NEON_AUTH_URL__, {
  adapter: BetterAuthReactAdapter({ fetchOptions: { credentials: "include" } }),
});

/**
 * A short-lived (15 min) Neon Auth JWT for calling the function. The adapter
 * puts the `set-auth-jwt` response header into `session.token` and refreshes
 * it with the session, so this is cheap to call before every request.
 */
export async function getToken(): Promise<string> {
  const { data } = await authClient.getSession();
  const token = data?.session?.token;
  if (!token || token.split(".").length !== 3) throw new Error("Your session has expired. Sign in again.");
  return token;
}
