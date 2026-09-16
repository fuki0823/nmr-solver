import Link from "next/link";

export default function Home() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-10 px-6 py-16">
      <header className="flex flex-col gap-3">
        <h1 className="text-3xl font-semibold text-stone-900">NMR Solver</h1>
        <p className="text-base text-stone-700">
          NMR(核磁気共鳴)スペクトルから有機化合物の構造を決定する、無料のWebアプリです。化学的な判定はすべて決定論的なロジックで行い、AIによる印象評価には依存していません。
        </p>
      </header>

      <div className="grid gap-6 sm:grid-cols-2">
        <Link
          href="/learn"
          className="flex flex-col gap-3 rounded-lg border border-stone-200 bg-white p-6 transition-colors hover:border-stone-400 hover:bg-stone-50"
        >
          <span className="text-xs font-semibold tracking-wide text-stone-500 uppercase">
            Learn
          </span>
          <h2 className="text-lg font-semibold text-stone-900">構造決定クイズ</h2>
          <p className="text-sm text-stone-700">
            分子式と¹H・¹³C・DEPT・COSY・HSQC・HMBCなどのNMRデータから構造式を推定し、構造エディタで描いて回答する全25問のクイズです。間違えた場合は、どのデータと矛盾しているかを具体的にフィードバックします。
          </p>
          <span className="mt-auto text-sm font-medium text-stone-900">クイズを始める →</span>
        </Link>

        <Link
          href="/analyze"
          className="flex flex-col gap-3 rounded-lg border border-stone-200 bg-white p-6 transition-colors hover:border-stone-400 hover:bg-stone-50"
        >
          <span className="text-xs font-semibold tracking-wide text-stone-500 uppercase">
            Analyze
          </span>
          <h2 className="text-lg font-semibold text-stone-900">候補構造の解析・ランキング</h2>
          <p className="text-sm text-stone-700">
            実測(またはシミュレーション)のMS・NMRデータを入力すると、候補構造を¹³C炭素数・HSQC・HMBCなどの化学的制約で評価します。明らかに矛盾する候補は除外した上で、残った候補を一致度でランキングします。
          </p>
          <span className="mt-auto text-sm font-medium text-stone-900">解析を試す →</span>
        </Link>
      </div>
    </div>
  );
}
