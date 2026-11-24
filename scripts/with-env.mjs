// Runs a command with an env file loaded first (Next.js workers refuse `node --env-file`).
//   node scripts/with-env.mjs .env.staging.local next build
// Values from the file win over .env.local, which Next only fills in for unset variables.
import { spawnSync } from "node:child_process";

const [file, cmd, ...args] = process.argv.slice(2);
if (!file || !cmd) {
  console.error("usage: node scripts/with-env.mjs <env file> <command> [args…]");
  process.exit(2);
}
process.loadEnvFile(file);
const bin = cmd === "next" ? [process.execPath, "node_modules/next/dist/bin/next"] : [cmd];
const r = spawnSync(bin[0], [...bin.slice(1), ...args], { stdio: "inherit", env: process.env });
process.exit(r.status ?? 1);
