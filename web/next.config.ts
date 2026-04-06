import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      {
        source: '/:path*',
        has: [{ type: 'host', value: 'web-seven-chi-63.vercel.app' }],
        destination: 'https://property-search-omega.vercel.app/:path*',
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
