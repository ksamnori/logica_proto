import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

// 🌟 방금 만든 권한 전환 스위치 컴포넌트를 불러옵니다.
// (저장하신 폴더 구조에 따라 경로가 다를 경우 "@/components/RoleToggleBtn" 부분을 수정해 주세요)
import RoleToggleBtn from "@/components/RoleToggleBtn";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "LOGICA. 깊고 단단한 심화 수학.",
  description: "logicaclass.com은 로지카 학원 관리 포탈입니다.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ko" // 🌟 한국어 사이트에 맞게 'en'에서 'ko'로 변경했습니다.
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        
        {/* 🌟 권한 전환 플로팅 버튼을 레이아웃 최상단에 배치합니다. */}
        <RoleToggleBtn />
      </body>
    </html>
  );
}