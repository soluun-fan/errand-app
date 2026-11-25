import type { Json } from "./database.types";

/** Serialize application values at a JSON database boundary, matching the HTTP client's wire format. */
export function toJson(value: unknown): Json {
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new TypeError("Expected a JSON value");
  return JSON.parse(encoded) as Json;
}
