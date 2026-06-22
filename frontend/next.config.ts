import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_ENVIRONMENT:
      process.env.ENVIRONMENT ?? process.env.NEXT_PUBLIC_ENVIRONMENT ?? "production",
  },
  async rewrites() {
    if (process.env.ENVIRONMENT !== "development") return [];

    return [
      {
        source: "/api/:path*",
        destination: "http://container-engine:8001/:path*",
      },
    ];
  },
};

export default nextConfig;
