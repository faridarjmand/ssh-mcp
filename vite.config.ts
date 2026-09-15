import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  root: "src/ui",
  build: {
    outDir: "../../dist/ui",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": "http://127.0.0.1:3100",
      "/mcp": "http://127.0.0.1:3100",
      "/ws": {
        target: "ws://127.0.0.1:3100",
        ws: true,
      },
    },
  },
});
