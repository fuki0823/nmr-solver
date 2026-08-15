import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center gap-4 px-6 py-24 text-center">
      <p className="text-sm font-medium tracking-wide text-stone-600 uppercase">
        404
      </p>
      <h1 className="text-xl font-semibold text-stone-900">
        ページが見つかりませんでした
      </h1>
      <p className="text-sm text-stone-700">
        指定された問題は存在しないか、削除された可能性があります。
      </p>
      <Link
        href="/"
        className="mt-2 rounded-md bg-stone-900 px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-stone-700"
      >
        問題一覧に戻る
      </Link>
    </div>
  );
}
