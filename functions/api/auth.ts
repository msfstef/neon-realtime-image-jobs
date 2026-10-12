import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { createRemoteJWKSet, jwtVerify } from "jose";

import { env } from "./env.js";

// Neon Auth signs EdDSA JWTs with the auth server's origin as the issuer.
const jwks = createRemoteJWKSet(new URL(env.authJwksUrl));
const issuer = new URL(env.authBaseUrl).origin;

export interface AuthUser {
  id: string;
  email: string | null;
}

export type AuthEnv = { Variables: { user: AuthUser } };

export const requireUser = createMiddleware<AuthEnv>(async (c, next) => {
  const header = c.req.header("authorization");
  if (!header?.toLowerCase().startsWith("bearer ")) {
    throw new HTTPException(401, { message: "Missing bearer token" });
  }
  try {
    const { payload } = await jwtVerify(header.slice(7), jwks, { issuer });
    if (typeof payload.sub !== "string") throw new Error("Token has no subject");
    c.set("user", {
      id: payload.sub,
      email: typeof payload.email === "string" ? payload.email : null,
    });
  } catch {
    throw new HTTPException(401, { message: "Invalid or expired token" });
  }
  await next();
});
