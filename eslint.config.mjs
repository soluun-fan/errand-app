import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import { createRequire } from "node:module";

// The full jsx-a11y recommended set (Next enables only 6 of its rules). Loaded from the copy that
// eslint-config-next already ships, so it is the same plugin instance — no extra dependency.
const a11y = createRequire(import.meta.resolve("eslint-config-next"))("eslint-plugin-jsx-a11y");

export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  {
    files: ["**/*.tsx"],
    rules: {
      ...a11y.flatConfigs.recommended.rules,
      // a checkbox or input nested inside its <label> is a valid association
      "jsx-a11y/label-has-associated-control": ["error", { assert: "either", depth: 3 }],
    },
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    // These are async Server Components: their request-time clock is not client render state.
    files: ["src/app/**/page.tsx"],
    rules: { "react-hooks/purity": "off" },
  },
  globalIgnores([
    ".next/**",
    "public/**",
    "prototype/**",
    "archive/**",
    "playwright-report/**",
    "test-results/**",
    "next-env.d.ts",
    "src/lib/db/database.types.ts",
  ]),
]);
