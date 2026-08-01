import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 🌟 1. 허용 IP 설정은 experimental 내부의 serverActions 안으로 이동해야 합니다.
  experimental: {
    serverActions: {
      allowedOrigins: ["192.168.0.112"],
    },
  },

  // 🌟 2. Turbopack/Next.js 번들링 과정에서 발생하는 모듈 누락 에러 방지 (기존 코드 유지)
  // (이 패키지들 때문에 NFT 경고가 뜰 수 있으나, 정상적인 현상이니 무시하셔도 됩니다.)
  serverExternalPackages: ["@sparticuz/chromium-min", "puppeteer-core"],
};

export default nextConfig;