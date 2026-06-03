import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Proxy /api -> FastAPI backend so the frontend can use same-origin requests.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      },
    },
  },
});
