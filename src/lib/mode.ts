import "server-only";
import { cookies } from "next/headers";
import { getViewer } from "./auth";
import { MODE_COOKIE, parseMode, type AppMode } from "./mode-cookie";

export async function getMode(): Promise<AppMode> {
  const [jar, viewer] = await Promise.all([cookies(), getViewer()]);
  return parseMode(jar.get(MODE_COOKIE)?.value, viewer?.profile.id);
}
