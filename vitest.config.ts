import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node", // use node for data provider tests (fetch mock)
    include: ["__tests__/**/*.test.ts"],
  },
});
