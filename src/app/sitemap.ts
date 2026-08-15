import type { MetadataRoute } from "next";
import { questions } from "@/data/questions";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: siteUrl, priority: 1 },
    ...questions.map((q) => ({
      url: `${siteUrl}/quiz/${q.id}`,
      priority: 0.5,
    })),
  ];
}
