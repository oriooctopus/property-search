import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  images: {
    // Vercel's Image Optimization pipeline — converts to AVIF/WebP on the fly
    // and serves width-appropriate variants for each rendered size.
    //
    // Photo hostnames we rewrite/serve from:
    //   - photos.zillowstatic.com        StreetEasy-sourced listings
    //   - images.craigslist.org          Craigslist-sourced listings
    //   - *.supabase.co                  Self-hosted (FB re-uploads, avatars)
    //   - lh3.googleusercontent.com      Google OAuth avatars (Supabase Auth)
    //   - avatars.githubusercontent.com  GitHub OAuth avatars
    remotePatterns: [
      { protocol: "https", hostname: "photos.zillowstatic.com" },
      { protocol: "https", hostname: "images.craigslist.org" },
      { protocol: "https", hostname: "*.craigslist.org" },
      { protocol: "https", hostname: "**.supabase.co" },
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
      { protocol: "https", hostname: "avatars.githubusercontent.com" },
    ],
    // Negotiate AVIF first, then WebP, then fall back to original.
    formats: ["image/avif", "image/webp"],
    // Sizes the optimizer is allowed to generate. Card thumbs land around 320–640px,
    // detail-modal photos up to ~960–1200px at 2x DPR.
    deviceSizes: [320, 480, 640, 960, 1200, 1600],
    imageSizes: [64, 96, 140, 200, 300, 400],
    // Cache optimized responses for 30 days at the Vercel edge.
    minimumCacheTTL: 60 * 60 * 24 * 30,
  },
};

// Conditionally wrap with bundle analyzer when ANALYZE=true.
// Uses require so this stays a no-op when the package isn't installed.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const withBundleAnalyzer = process.env.ANALYZE === "true"
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  ? require("@next/bundle-analyzer")({ enabled: true, openAnalyzer: false })
  : (cfg: NextConfig) => cfg;

export default withBundleAnalyzer(nextConfig);
