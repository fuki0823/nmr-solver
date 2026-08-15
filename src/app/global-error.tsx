"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="ja">
      <body className="flex min-h-screen flex-col items-center justify-center gap-4 bg-stone-50 px-6 text-center text-stone-900">
        <p className="text-sm font-medium tracking-wide text-stone-600 uppercase">
          エラー
        </p>
        <h1 className="text-xl font-semibold">
          アプリケーションでエラーが発生しました
        </h1>
        <p className="text-sm text-stone-700">
          お手数ですが、ページを再読み込みしてください。
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-2 rounded-md bg-stone-900 px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-stone-700"
        >
          もう一度試す
        </button>
      </body>
    </html>
  );
}
