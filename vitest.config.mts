import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // PGlite boots a real Postgres in WASM; give the DB tests room.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
