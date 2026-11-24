import { describe, expect, it } from "vitest";
import { modeCookieValue, modeForPath, parseMode } from "../mode-cookie";

describe("account-specific home mode", () => {
  it("keeps the selected worker home only for the same account", () => {
    const cookie = modeCookieValue("worker-a", "helper");
    expect(parseMode(cookie, "worker-a")).toBe("helper");
    expect(parseMode(cookie, "customer-b")).toBe("customer");
    expect(parseMode(cookie, null)).toBe("customer");
  });

  it.each([undefined, null, "helper", "customer", "worker-a:helper:extra", "worker-a:"])("ignores old or invalid cookie %s", (cookie) => {
    expect(parseMode(cookie, "worker-a")).toBe("customer");
  });

  it.each(["/jobs", "/jobs/task-id", "/earnings", "/helper/bank"])("shows worker navigation for %s regardless of home preference", (path) => {
    expect(modeForPath(path, "customer")).toBe("helper");
  });

  it.each(["/tasks", "/tasks/task-id", "/post"])("lets workers use customer screens at %s", (path) => {
    expect(modeForPath(path, "helper")).toBe("customer");
  });

  it.each(["/profile", "/helpers", "/helpers/worker-id", "/requests", "/"])("respects the preference on shared screen %s", (path) => {
    expect(modeForPath(path, "helper")).toBe("helper");
    expect(modeForPath(path, "customer")).toBe("customer");
  });
});
