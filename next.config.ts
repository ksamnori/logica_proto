import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 🌟 1. Server Actions 용량 제한 해제 (experimental 안쪽으로 원상 복구)
  experimental: {
    serverActions: {
      allowedOrigins: ["192.168.0.112", "192.168.1.2"],
      bodySizeLimit: "10mb", // 🌟 이미지 업로드 용량을 10MB로 넉넉하게 늘려줍니다.
    },
  },

  // 🌟 2. Turbopack/Next.js 번들링 모듈 누락 방지
  serverExternalPackages: ["@sparticuz/chromium-min", "puppeteer-core"],
};

export default nextConfig;