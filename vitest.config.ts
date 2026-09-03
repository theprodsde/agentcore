import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts", "tools/**/*.ts"],
      exclude: ["src/server/db/schema.ts", "src/main.tsx", "src/App.tsx", "src/pages/**"],
    },
    globals: true,
  },
});
