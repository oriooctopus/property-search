import type { MetadataRoute } from "next";

// Web App Manifest. Next.js 15 serves this from /manifest.webmanifest at the
// root, with the correct application/manifest+json content type.
//
// Color choices match the dark UI used in the rest of the app (see layout.tsx
// inline body background) so the splash and theme color don't flash a wrong
// shade when the PWA is launched standalone.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Dwelligence",
    short_name: "Dwelligence",
    description: "AI-powered NYC apartment search",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0f1117",
    theme_color: "#0f1117",
    categories: ["lifestyle", "utilities"],
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-maskable-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
