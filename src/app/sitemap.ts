import type { MetadataRoute } from "next";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: "https://tethernotes.me",
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: "https://tethernotes.me/privacy",
      changeFrequency: "monthly",
      priority: 0.5,
    },
  ];
}
