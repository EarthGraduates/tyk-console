/// <reference types="vitest" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Proxy Tyk Gateway API in dev
      "/tyk": {
        target: "http://localhost:8080",
        changeOrigin: true,
      },
      "/hello": {
        target: "http://localhost:8080",
        changeOrigin: true,
      },
      // Proxy PostgREST (PostgreSQL REST API)
      "/db": {
        target: "http://localhost:3001",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/db/, ''),
      },
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/vitest.setup.ts"],
    css: false,
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    testTimeout: 20000,
  },
});
