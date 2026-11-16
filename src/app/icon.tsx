import { ImageResponse } from "next/og";

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

/** App icon: the brand "T" (generated, no image files to keep in sync). */
export default function Icon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#ea580c", color: "#ffffff", fontSize: 320, fontWeight: 700 }}>
        T
      </div>
    ),
    size,
  );
}
