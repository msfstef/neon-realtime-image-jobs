// Neon backend for this app, applied with `neon deploy --yes --env .env.local`.
//
// This is a plain object rather than `defineConfig(...)` because, as of Oct 2026,
// the published @neon/config does not know the `realtime` key; the CLI validates it.
//
// The Functions runtime injects credentials for each enabled service
// (DATABASE_URL, NEON_AUTH_*, AWS_* for storage, NEON_AI_GATEWAY_*).
// The AI Gateway needs a paid plan with AI Gateway credits.
export default {
  auth: true,
  aiGateway: true,
  realtime: true,
  buckets: {
    images: { access: "private" },
  },
  functions: {
    api: {
      name: "Image jobs API",
      source: "./functions/api/index.ts",
      // sharp ships a native binary, so it is staged for linux-arm64 rather than bundled.
      externalPackages: ["sharp"],
      // Realtime connection values are not injected into functions (as of Oct 2026);
      // forward them from .env.local (`neon deploy --env .env.local`).
      env: {
        NEON_REALTIME_URL: process.env.NEON_REALTIME_URL!,
        NEON_REALTIME_SECRET: process.env.NEON_REALTIME_SECRET!,
        NEON_DATABASE_NAME: process.env.NEON_DATABASE_NAME!,
        ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS ?? "http://localhost:5173",
        CLASSIFIER_MODEL: process.env.CLASSIFIER_MODEL ?? "gpt-5-nano",
      },
      dev: { port: 8787 },
    },
  },
};
