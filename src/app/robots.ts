import type { MetadataRoute } from "next";

export const dynamic = "force-static";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/privacy"],
        disallow: ["/mini", "/s", "/offline"],
      },
    ],
    sitemap: "https://tethernotes.me/sitemap.xml",
    host: "https://tethernotes.me",
  };
}
