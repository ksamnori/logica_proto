// src/app/(hq)/layout.tsx
import React from "react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { HqHostProvider } from "@/lib/hq/hqRoutes";
import { isHqSubdomainHost } from "@/lib/hq/hqRouteUtils";

export const metadata: Metadata = {
  title: {
    template: "%s | HQ",
    default: "HQ | 천종현수학연구소 본부",
  },
  description: "(주)천종현수학연구소 출판·연구 본부 통합 관리 시스템",
  icons: {
    icon: [
      { url: "/favicon-hq.svg", type: "image/svg+xml" },
      { url: "/favicon-hq.png", type: "image/png", sizes: "64x64" },
      { url: "/favicon-hq.ico", sizes: "any" },
    ],
    shortcut: "/favicon-hq.ico",
    apple: "/favicon-hq.png",
  },
};

export default async function HqRouteGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const hdrs = await headers();
  const host = hdrs.get("x-forwarded-host") || hdrs.get("host") || "";
  const isSubdomain = isHqSubdomainHost(host);

  return <HqHostProvider isSubdomain={isSubdomain}>{children}</HqHostProvider>;
}
