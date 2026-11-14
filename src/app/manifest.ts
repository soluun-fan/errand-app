import type { MetadataRoute } from "next";

/** Installable web app ("Add to Home Screen") — on iPhone, web push only works once installed. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Tuslamj",
    short_name: "Tuslamj",
    description: "Errands and protected payments in Ulaanbaatar",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    lang: "mn",
    icons: [
      { src: "/icon", sizes: "512x512", type: "image/png" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
