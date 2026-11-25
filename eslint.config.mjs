import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
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
