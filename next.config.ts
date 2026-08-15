import type { NextConfig } from "next";

// このアプリは外部API・外部スクリプト・外部フォントを一切使用せず、すべて
// 同一オリジンで完結する(構造エディタのWASMも自己ホスト)。そのためCSPは
// 比較的厳しく設定できるが、Next.js自体がハイドレーション用のインライン
// scriptタグを埋め込むため(nonce対応にはmiddlewareでの追加実装が必要)、
// script-srcにも'unsafe-inline'が必要だった(nonceなしでは動作せず確認済み)。
// Ketcher(canvas/SVGベースのエディタ)もインラインスタイルとWASM実行を要する。
// 開発時のみ、React DevのデバッグでReactが使うeval()を許可する(本番では
// Reactはeval()を使わないため不要。`next dev`のFast Refresh/エラー表示が
// CSPでブロックされるのを避けるための開発体験上の措置で、本番の安全性は
// 下げない)。
const scriptSrc =
  process.env.NODE_ENV === "development"
    ? "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'"
    : "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'";

const csp = [
  "default-src 'self'",
  scriptSrc,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
