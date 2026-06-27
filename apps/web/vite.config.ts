import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // In ontwikkeling stuurt Vite /api door naar de Express-server.
      "/api": "http://localhost:3000",
    },
  },
  build: {
    outDir: "dist",
  },
});
