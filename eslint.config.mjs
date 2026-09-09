import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Report output of "npm run test:coverage" (gitignored, not our source).
    "coverage/**",
    // Agent worktrees (Claude Code) carry their own node_modules/.next.
    ".claude/worktrees/**",
  ]),
]);

export default eslintConfig;
