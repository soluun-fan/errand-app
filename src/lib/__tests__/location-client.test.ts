import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { startLocationUpdates } from "../location-client";

let stop: (() => void) | undefined;
let documentMock: EventTarget & { visibilityState: string };
let locate: ReturnType<typeof vi.fn>;
const position = () => ({ coords: { latitude: 47.92, longitude: 106.92 }, timestamp: Date.now() });

beforeEach(() => {
  vi.useFakeTimers();
  documentMock = Object.assign(new EventTarget(), { visibilityState: "visible" });
  locate = vi.fn((ok: (p: unknown) => void) => ok(position()));
  vi.stubGlobal("document", documentMock);
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("navigator", { geolocation: { getCurrentPosition: locate } });
});

afterEach(() => { stop?.(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it("sends regular samples even when the helper remains stationary", async () => {
  const send = vi.fn().mockResolvedValue(undefined);
  const status = vi.fn();
  stop = startLocationUpdates(send, status);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(send).toHaveBeenCalledTimes(3);
  expect(send).toHaveBeenLastCalledWith(47.92, 106.92);
  expect(status).toHaveBeenLastCalledWith("live");
});

it("pauses while hidden and samples immediately on returning to the app", async () => {
  const send = vi.fn().mockResolvedValue(undefined);
  documentMock.visibilityState = "hidden";
  stop = startLocationUpdates(send, vi.fn());
  await vi.advanceTimersByTimeAsync(30_000);
  expect(locate).not.toHaveBeenCalled();
  documentMock.visibilityState = "visible";
  documentMock.dispatchEvent(new Event("visibilitychange"));
  await vi.advanceTimersByTimeAsync(0);
  expect(send).toHaveBeenCalledTimes(1);
});

it("does not send a position that arrives after sharing was stopped", async () => {
  let deliver!: (p: unknown) => void;
  locate.mockImplementation((ok) => { deliver = ok; });
  const send = vi.fn();
  stop = startLocationUpdates(send, vi.fn());
  stop();
  deliver(position());
  await vi.advanceTimersByTimeAsync(60_000);
  expect(send).not.toHaveBeenCalled();
  expect(locate).toHaveBeenCalledTimes(1);
});

it("does not overlap network writes, and recovers after a failed write", async () => {
  let fail!: (reason: Error) => void;
  const send = vi.fn().mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; })).mockResolvedValue(undefined);
  const status = vi.fn();
  stop = startLocationUpdates(send, status);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(send).toHaveBeenCalledTimes(1);
  fail(new Error("offline"));
  await vi.advanceTimersByTimeAsync(0);
  expect(status).toHaveBeenLastCalledWith("unavailable");
  window.dispatchEvent(new Event("online"));
  await vi.advanceTimersByTimeAsync(0);
  expect(send).toHaveBeenCalledTimes(2);
  expect(status).toHaveBeenLastCalledWith("live");
});

it("reports denied permission and never sends cached, stale coordinates", async () => {
  const send = vi.fn();
  const status = vi.fn();
  locate.mockImplementationOnce((_ok, error) => error({ code: 1 }));
  stop = startLocationUpdates(send, status);
  await vi.advanceTimersByTimeAsync(0);
  expect(status).toHaveBeenLastCalledWith("denied");
  locate.mockImplementation(ok => ok({ ...position(), timestamp: Date.now() - 60_000 }));
  await vi.advanceTimersByTimeAsync(15_000);
  expect(send).not.toHaveBeenCalled();
  expect(status).toHaveBeenLastCalledWith("unavailable");
});
