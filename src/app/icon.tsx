import { ImageResponse } from "next/og";

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

/** App icon: the brand "G" (Гүйгээрэй / Guigeeree; Latin: the icon font has no Cyrillic) (generated, no image files to keep in sync). */
export default function Icon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#cf4a0e", color: "#ffffff", fontSize: 320, fontWeight: 700 }}>
        G
      </div>
    ),
    size,
  );
}
