import { defineConfig } from "vitest/config";

import { CONFIG } from "./src/config";

const scope = CONFIG.TEST.SCOPE;
const includePatterns =
  scope === "unit"
    ? ["src/**/*.unit.test.ts"]
    : scope === "int"
      ? ["src/**/*.int.test.ts"]
      : ["src/**/*.unit.test.ts", "src/**/*.int.test.ts"];

export default defineConfig({
  test: {
    environment: "node",
    include: includePatterns,
    testTimeout: scope === "int" ? 20000 : 5000,
    hookTimeout: scope === "int" ? 20000 : 5000,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      reportsDirectory: "coverage",
      all: true,
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "**/*.d.ts",
        "dist/**",
        "src/index.ts",
        "src/types.ts",
        "src/**/*.test.ts",
        "src/**/*.spec.ts",
      ],
      ...(scope === "int"
        ? {}
        : {
            thresholds: {
              lines: 100,
              statements: 100,
              functions: 100,
              branches: 100,
            },
          }),
    },
  },
});
