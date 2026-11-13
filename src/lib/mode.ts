import "server-only";
import { cookies } from "next/headers";
import { MODE_COOKIE, parseMode, type AppMode } from "./mode-cookie";

export async function getMode(): Promise<AppMode> {
  return parseMode((await cookies()).get(MODE_COOKIE)?.value);
}
