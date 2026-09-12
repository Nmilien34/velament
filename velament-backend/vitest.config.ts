import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    // Each database suite creates collections/indexes in its own database.
    // Bound concurrent setup load without serializing requests inside tests.
    maxWorkers: 2,
  },
});
