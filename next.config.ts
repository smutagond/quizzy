import type { NextConfig } from "next";

const realtimeUrl = process.env.REALTIME_SERVER_URL || "http://127.0.0.1:4001";

const nextConfig: NextConfig = {
  devIndicators: false,
  cacheComponents: true,
  partialPrefetching: true,
  allowedDevOrigins: [
    "localhost",
    "127.0.0.1",
  ],
  async rewrites() {
    return [
      {
        source: "/socket.io",
        destination: `${realtimeUrl}/socket.io/`,
      },
      {
        source: "/socket.io/:path*",
        destination: `${realtimeUrl}/socket.io/:path*`,
      },
    ];
  },
};

export default nextConfig;
