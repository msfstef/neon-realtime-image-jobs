import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  // Only these two public URLs reach the browser bundle. The Realtime secret
  // and storage credentials in .env.local stay with the function.
  const env = loadEnv(mode, process.cwd(), "");
  const authUrl = env.VITE_NEON_AUTH_URL || env.NEON_AUTH_BASE_URL;
  const apiUrl = env.VITE_API_URL || env.NEON_FUNCTION_API_BASE_URL;
  if (!authUrl || !apiUrl) {
    throw new Error("Missing NEON_AUTH_BASE_URL or NEON_FUNCTION_API_BASE_URL. Run `npm run deploy` first.");
  }

  return {
    root: "web",
    plugins: [react()],
    define: {
      __NEON_AUTH_URL__: JSON.stringify(authUrl),
      __API_URL__: JSON.stringify(apiUrl),
    },
    server: { port: 5173, strictPort: true },
    preview: { port: 5173, strictPort: true },
    build: { outDir: "../dist", emptyOutDir: true },
  };
});
