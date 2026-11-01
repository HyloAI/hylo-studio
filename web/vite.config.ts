import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev: `npm run dev` proxies /api to a running `hylo-playground` (default port 8765).
// Build: output goes into the Python package, which serves it.
export default defineConfig({
  plugins: [react()],
  build: { outDir: "../packages/hylo-playground/src/hylo/playground/static", emptyOutDir: true },
  server: { proxy: { "/api": { target: "http://127.0.0.1:8765", ws: true } } },
});
