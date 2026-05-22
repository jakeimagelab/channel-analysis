import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "포토클리닉 — 병원 채널 분석",
  description: "인스타그램·홈페이지·네이버플레이스·블로그 4개 채널을 포토클리닉 기준으로 분석합니다."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
