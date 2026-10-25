import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Episodio",
    short_name: "Episodio",
    description: "Трекер сериалов, аниме, фильмов, книг и манги",
    lang: "ru",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0F172A",
    theme_color: "#0F172A",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
    shortcuts: [{ name: "Добавить тайтл", url: "/title/new", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] }],
  };
}
