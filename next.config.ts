import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 기존에 있던 다른 설정들은 그대로 유지하고,
  // allowedDevOrigins를 experimental 밖(최상단)에 배치합니다.
  allowedDevOrigins: ["192.168.0.112"],

  // 🌟 Turbopack/Next.js 번들링 과정에서 발생하는 모듈 누락 에러 방지
  serverExternalPackages: ["@sparticuz/chromium-min", "puppeteer-core"],
};

export default nextConfig;