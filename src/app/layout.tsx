import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const description =
  "分子式とNMRデータ(¹H・¹³C・DEPT・COSY・HSQC・HMBCなど)をもとに構造式を推定する、NMR構造解析の学習用Webアプリ。";

// 本番URLが未設定(NEXT_PUBLIC_SITE_URL未設定)でもビルドが壊れないよう、
// ローカル用のフォールバックを用意する。Vercelにデプロイする際は
// NEXT_PUBLIC_SITE_URLに実際の公開URLを設定することを推奨(README参照)。
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  alternates: {
    canonical: "/",
  },
  title: {
    default: "NMR Solver",
    template: "%s | NMR Solver",
  },
  description,
  applicationName: "NMR Solver",
  openGraph: {
    title: "NMR Solver",
    description,
    type: "website",
    locale: "ja_JP",
    siteName: "NMR Solver",
  },
  twitter: {
    card: "summary",
    title: "NMR Solver",
    description,
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="ja"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-stone-50 text-stone-900">
        <header className="border-b border-stone-200 bg-white">
          <div className="mx-auto flex max-w-5xl items-center px-6 py-3">
            <Link
              href="/"
              className="text-sm font-semibold tracking-tight text-stone-900"
            >
              NMR Solver
            </Link>
          </div>
        </header>
        <main className="flex flex-1 flex-col">{children}</main>
        <Analytics />
      </body>
    </html>
  );
}
