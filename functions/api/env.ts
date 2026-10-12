// Postgres, Neon Auth, Object Storage, and AI Gateway variables are injected by
// the Neon Functions runtime. Realtime values are not (as of Oct 2026), so neon.ts
// forwards them through the function's `env` at deploy time.
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

export const env = {
  databaseUrl: required("DATABASE_URL"),
  authBaseUrl: required("NEON_AUTH_BASE_URL"),
  authJwksUrl: required("NEON_AUTH_JWKS_URL"),
  realtimeUrl: required("NEON_REALTIME_URL"),
  realtimeSecret: required("NEON_REALTIME_SECRET"),
  realtimeDatabase: required("NEON_DATABASE_NAME"),
  bucket: process.env.IMAGES_BUCKET ?? "images",
  classifierModel: process.env.CLASSIFIER_MODEL ?? "gpt-5-nano",
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? "http://localhost:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
};
