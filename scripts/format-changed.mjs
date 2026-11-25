/** Adopt formatting incrementally: check every changed source/config file, including new files. */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { check, format, getFileInfo, resolveConfig } from "prettier";
import { readFile, writeFile } from "node:fs/promises";

const write = process.argv.includes("--write");
const base = process.env.FORMAT_BASE?.replace(/^0+$/, "") || "HEAD";
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).split("\0").filter(Boolean);
const files = [
  ...new Set([
    ...git("diff", "--name-only", "--diff-filter=ACMR", "-z", base, "--"),
    ...git("ls-files", "--others", "--exclude-standard", "-z"),
  ]),
].filter((file) => existsSync(file) && /\.(?:[cm]?[jt]sx?|json|ya?ml|css)$/.test(file));
let checked = 0;
const failures = [];
for (const file of files) {
  const info = await getFileInfo(file, { ignorePath: ".prettierignore" });
  if (info.ignored || !info.inferredParser) continue;
  const input = await readFile(file, "utf8");
  const options = { ...(await resolveConfig(file)), filepath: file };
  if (write) await writeFile(file, await format(input, options));
  else if (!(await check(input, options))) failures.push(file);
  checked++;
}
if (failures.length) {
  console.error(`Run npm run format for:\n${failures.join("\n")}`);
  process.exitCode = 1;
} else {
  console.log(`${write ? "Formatted" : "Checked"} ${checked} changed files.`);
}
