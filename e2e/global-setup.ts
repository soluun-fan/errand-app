import { closeLeftovers } from "./support";

/** Before every run: close "[verify]" tasks an earlier, interrupted run left running. */
export default async function globalSetup(): Promise<void> {
  const n = await closeLeftovers();
  if (n) console.log(`e2e: closed ${n} leftover test task(s)`);
}
