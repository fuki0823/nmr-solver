"use client";

import { useState } from "react";
import type { Correlation2D, CorrelationKind, SpectralPeak } from "@/lib/analyze/types";

interface CorrelationInputProps {
  kind: CorrelationKind;
  peaks: SpectralPeak[];
  correlations: Correlation2D[];
  onChange: (correlations: Correlation2D[]) => void;
}

const KIND_LABEL: Record<CorrelationKind, string> = {
  COSY: "COSY (¹H-¹H)",
  HSQC: "HSQC (¹H-¹³C 直接)",
  HMBC: "HMBC (¹H-¹³C 長距離)",
  NOESY: "NOESY (¹H-¹H 空間近接)",
};

export default function CorrelationInput({
  kind,
  peaks,
  correlations,
  onChange,
}: CorrelationInputProps) {
  const fromNucleus = "1H" as const;
  const toNucleus = kind === "HSQC" || kind === "HMBC" ? ("13C" as const) : ("1H" as const);
  const fromOptions = peaks.filter((p) => p.nucleus === fromNucleus);
  const toOptions = peaks.filter((p) => p.nucleus === toNucleus);

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const kindCorrelations = correlations.filter((c) => c.kind === kind);

  const addCorrelation = () => {
    if (!from || !to) return;
    onChange([...correlations, { kind, from, to }]);
    setFrom("");
    setTo("");
  };

  const removeCorrelation = (index: number) => {
    const target = kindCorrelations[index];
    const globalIndex = correlations.indexOf(target);
    onChange(correlations.filter((_, i) => i !== globalIndex));
  };

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-semibold tracking-wide text-stone-600 uppercase">
        {KIND_LABEL[kind]}
      </p>
      <ul className="flex flex-col gap-1 text-sm text-stone-800">
        {kindCorrelations.map((c, i) => (
          <li key={i} className="flex items-center gap-2">
            <span className="font-mono">
              {c.from} {kind === "NOESY" ? "↔" : kind === "COSY" ? "↔" : "→"} {c.to}
            </span>
            <button
              type="button"
              onClick={() => removeCorrelation(i)}
              aria-label={`${c.from} ${c.to} の相関を削除`}
              className="text-stone-400 hover:text-red-600"
            >
              ×
            </button>
          </li>
        ))}
        {kindCorrelations.length === 0 && (
          <li className="text-stone-400">まだ相関がありません。</li>
        )}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className="rounded border border-stone-300 px-2 py-1 text-sm"
          aria-label="相関元のピーク"
        >
          <option value="">(選択)</option>
          {fromOptions.map((p) => (
            <option key={p.id} value={p.id}>
              {p.id} (δ{p.shift})
            </option>
          ))}
        </select>
        <span className="text-stone-400">{kind === "HSQC" || kind === "HMBC" ? "→" : "↔"}</span>
        <select
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className="rounded border border-stone-300 px-2 py-1 text-sm"
          aria-label="相関先のピーク"
        >
          <option value="">(選択)</option>
          {toOptions.map((p) => (
            <option key={p.id} value={p.id}>
              {p.id} (δ{p.shift})
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={addCorrelation}
          disabled={!from || !to}
          className="rounded-md border border-stone-300 px-3 py-1 text-xs font-medium text-stone-600 transition-colors hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          + 相関を追加
        </button>
      </div>
    </div>
  );
}
