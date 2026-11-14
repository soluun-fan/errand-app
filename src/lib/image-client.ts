"use client";

import { dhashFromGray, grayFromRgba } from "@/lib/proof-hash";

/** Browser-side image helpers shared by proof upload and chat photos. */
export const MAX_IMAGE_SIDE = 1600;

/** Downscale + re-encode as JPEG (small uploads on mobile data). */
export async function compressImage(file: File): Promise<{ blob: Blob; bitmap: ImageBitmap }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob>((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error("encode"))), "image/jpeg", 0.82));
  return { blob, bitmap };
}

export function dhashOfBitmap(bitmap: ImageBitmap): string {
  const c = document.createElement("canvas");
  c.width = 9;
  c.height = 8;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) return "";
  ctx.drawImage(bitmap, 0, 0, 9, 8);
  return dhashFromGray(grayFromRgba(ctx.getImageData(0, 0, 9, 8).data));
}

export async function sha256Hex(blob: Blob): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}
