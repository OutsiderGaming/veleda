import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Veleda",
    short_name: "Veleda",
    description: "The market of seers: call when it happens.",
    start_url: "/",
    display: "standalone",
    background_color: "#0d0f0e",
    theme_color: "#0d0f0e",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
