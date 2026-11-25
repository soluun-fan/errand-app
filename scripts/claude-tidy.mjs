#!/usr/bin/env node
/**
 * Claude Code PostToolUse hook (.claude/settings.json): after Claude edits a file, format it with
 * Prettier and apply ESLint's safe auto-fixes — the same tools as `npm run format` / `npm run lint:fix`.
 * Owner, 2026-11-25: "make sure the codes are sleek clean and professional".
 *
 * Reads the hook payload on stdin; only touches files inside this project that Prettier/ESLint handle
 * (and not .prettierignore'd). Never blocks Claude: any problem is reported on stderr and exits 0.
 */
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(import.meta.url), "../..");

let input = "";
for await (const chunk of process.stdin) input += chunk;

try {
  const payload = JSON.parse(input || "{}");
  const raw = payload.tool_response?.filePath ?? payload.tool_input?.file_path;
  if (!raw) process.exit(0);
  const file = resolve(raw);
  const rel = relative(root, file);
  if (rel.startsWith("..") || rel.startsWith(`node_modules${sep}`) || !existsSync(file)) process.exit(0);

  const { format, getFileInfo, resolveConfig } = await import("prettier");
  const info = await getFileInfo(file, { ignorePath: resolve(root, ".prettierignore") });
  if (!info.ignored && info.inferredParser) {
    const before = await readFile(file, "utf8");
    const after = await format(before, { ...(await resolveConfig(file)), filepath: file });
    if (after !== before) await writeFile(file, after);
  }

  if (/\.(?:[cm]?[jt]sx?)$/.test(file)) {
    const { ESLint } = await import("eslint");
    const eslint = new ESLint({ cwd: root, fix: true });
    if (!(await eslint.isPathIgnored(file))) {
      const results = await eslint.lintFiles([file]);
      await ESLint.outputFixes(results);
      const left = results.flatMap((r) => r.messages.filter((m) => m.severity === 2).map((m) => `${rel}:${m.line}:${m.column} ${m.message} (${m.ruleId})`));
      // reported, not blocking: Claude sees it and fixes it in its next edit
      if (left.length) console.error(`ESLint errors left after auto-fix:\n${left.join("\n")}`);
    }
  }
} catch (e) {
  console.error(`tidy hook skipped: ${e instanceof Error ? e.message : String(e)}`);
}
process.exit(0);
