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
  build: {
    // Split the heavy vendor deps into their own cacheable chunks so the
    // app bundle stays small and a code change doesn't re-download recharts.
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: "vendor-charts", test: /node_modules[\\/](recharts|d3-|victory-vendor)/ },
            { name: "vendor-react", test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
          ],
        },
      },
    },
  },
  server: {
    host: true,
    port: 5173,
    // Allow any *.ts.net host so this works when fronted by
    // `tailscale serve` (URL: https://<machine>.<tailnet>.ts.net/).
    // Vite blocks unknown Host headers by default to prevent DNS rebinding.
    allowedHosts: [".ts.net", "localhost", "127.0.0.1"],
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      },
    },
  },
});
