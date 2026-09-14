"use client";

import dynamic from "next/dynamic";

// AnalyzeView(とその配下)はKetcher(ketcher-standalone、WASM)を必要とし、
// これをSSR対象に含めると `paper`(Node非対応の依存)経由でビルドが壊れる
// (StructureEditor.tsx と同じ理由)。next/dynamic の ssr:false はサーバー
// コンポーネントから直接は呼べないため、この薄いclientラッパーを介する。
const AnalyzeView = dynamic(() => import("./AnalyzeView"), {
  ssr: false,
  loading: () => (
    <div className="mx-auto flex w-full max-w-4xl flex-1 items-center justify-center px-6 py-24 text-sm text-stone-500">
      読み込んでいます…
    </div>
  ),
});

export default function AnalyzeViewLoader() {
  return <AnalyzeView />;
}
