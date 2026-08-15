"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function ErrorPage({
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
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center gap-4 px-6 py-24 text-center">
      <p className="text-sm font-medium tracking-wide text-stone-600 uppercase">
        エラー
      </p>
      <h1 className="text-xl font-semibold text-stone-900">
        予期しないエラーが発生しました
      </h1>
      <p className="text-sm text-stone-700">
        お手数ですが、もう一度お試しください。問題が解決しない場合はページを再読み込みしてください。
      </p>
      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="rounded-md bg-stone-900 px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-stone-700"
        >
          もう一度試す
        </button>
        <Link
          href="/"
          className="rounded-md border border-stone-300 bg-white px-6 py-2.5 text-sm font-medium text-stone-700 transition-colors hover:bg-stone-50"
        >
          問題一覧に戻る
        </Link>
      </div>
    </div>
  );
}
