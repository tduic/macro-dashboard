import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Proxy /api -> FastAPI backend so the frontend can use same-origin requests.
//
// `host: true` makes Vite listen on 0.0.0.0 so other devices on the same
// network — including peers on your Tailscale tailnet — can reach the dev
// server at http://<mac-tailscale-ip>:5173/. The backend stays bound to
// 127.0.0.1 (Makefile / `make dev`); browser traffic comes through Vite,
// which proxies /api to the local FastAPI process. Net result: only the
// dashboard URL is exposed across interfaces, not the raw API.
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      },
    },
  },
});
