import type { MetadataRoute } from "next";

// Required so the Tauri static export can emit this route as a file.
export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Tether Notes",
    short_name: "Tether",
    description: "A local-first notes workspace that keeps writing available offline.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#eaf0f2",
    theme_color: "#eaf0f2",
    orientation: "any",
    categories: ["productivity", "utilities"],
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/icon-maskable.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
  };
}
