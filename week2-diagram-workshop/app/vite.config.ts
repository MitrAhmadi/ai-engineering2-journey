import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";

// Two runtimes, one dev server. `react()` builds the browser bundle;
// `cloudflare()` runs src/worker.ts inside workerd — the same runtime
// Cloudflare runs in production — and proxies /agents/* to it.
export default defineConfig({
  plugins: [react(), cloudflare()],
});
