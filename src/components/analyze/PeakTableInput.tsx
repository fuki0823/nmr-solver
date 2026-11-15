"use client";

import { useState } from "react";
import type { Nucleus, SpectralPeak } from "@/lib/analyze/types";
import { parseCarbonList, parseProtonList } from "@/lib/analyze/parsePeakList";

interface PeakTableInputProps {
  nucleus: Nucleus;
  peaks: SpectralPeak[];
  onChange: (peaks: SpectralPeak[]) => void;
}

/**
 * そのnucleusで現在使われていない最小の番号を採番する。モジュール全体で
 * 増え続けるカウンタにすると、全部削除してから追加したときに番号が
 * 1に戻らず分かりにくいため、常に「今表示されている行」から計算する。
 */
function nextPeakId(nucleus: Nucleus, existingPeaks: SpectralPeak[]): string {
  const prefix = nucleus === "1H" ? "H" : "C";
  const used = new Set(
    existingPeaks
      .filter((p) => p.nucleus === nucleus)
      .map((p) => parseInt(p.id.slice(prefix.length), 10))
      .filter((n) => !Number.isNaN(n)),
  );
  let n = 1;
  while (used.has(n)) n++;
  return `${prefix}${n}`;
}

export default function PeakTableInput({
  nucleus,
  peaks,
  onChange,
}: PeakTableInputProps) {
  const [pasteText, setPasteText] = useState("");
  const [pasteMessage, setPasteMessage] = useState<string | null>(null);
  // 行の<input>はdefaultValueの非制御入力なので、貼り付けで同じidの行に
  // 別の値が入っても表示が更新されない。取り込みのたびにkeyを変えて
  // 行を作り直す。
  const [generation, setGeneration] = useState(0);

  const importPasted = (mode: "replace" | "append") => {
    const parsed =
      nucleus === "1H" ? parseProtonList(pasteText) : parseCarbonList(pasteText);
    if (parsed.length === 0) {
      setPasteMessage("数値を読み取れませんでした。");
      return;
    }
    const base = mode === "replace" ? [] : [...peaks];
    for (const p of parsed) {
      base.push({
        id: nextPeakId(nucleus, base),
        nucleus,
        shift: p.shift,
        integration: nucleus === "1H" ? (p.integration ?? 1) : undefined,
      });
    }
    onChange(base);
    setGeneration((g) => g + 1);
    setPasteText("");
    setPasteMessage(`${parsed.length} 本のピークを取り込みました。`);
  };

  const addRow = () => {
    onChange([
      ...peaks,
      {
        id: nextPeakId(nucleus, peaks),
        nucleus,
        shift: 0,
        integration: nucleus === "1H" ? 1 : undefined,
      },
    ]);
  };

  const updateRow = (id: string, patch: Partial<SpectralPeak>) => {
    onChange(peaks.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  };

  const removeRow = (id: string) => {
    onChange(peaks.filter((p) => p.id !== id));
  };

  return (
    <div className="flex flex-col gap-2">
      <details className="rounded-md border border-stone-200 bg-stone-50 p-3" open={peaks.length === 0}>
        <summary className="cursor-pointer text-xs font-medium text-stone-700">
          まとめて貼り付け
        </summary>
        <p className="mt-2 text-xs text-stone-600">
          {nucleus === "1H"
            ? "1行に1ピーク。「7.26」「7.26 2」「7.26 (2H, d, J = 8.0 Hz)」などの形式に対応(積分を省略すると1H)。"
            : "化学シフトを改行・カンマ・空白区切りで貼り付けてください(例: 1行に1つずつ)。"}
        </p>
        <textarea
          value={pasteText}
          onChange={(e) => {
            setPasteText(e.target.value);
            setPasteMessage(null);
          }}
          rows={6}
          placeholder={nucleus === "1H" ? "7.26 2\n6.80 1\n3.85 3" : "211.95\n186.58\n160.83"}
          className="mt-2 w-full rounded border border-stone-300 bg-white px-2 py-1 font-mono text-sm"
          aria-label={`${nucleus} ピークの一括入力`}
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => importPasted("replace")}
            disabled={pasteText.trim() === ""}
            className="rounded-md bg-stone-900 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-stone-700 disabled:opacity-40"
          >
            取り込む(置き換え)
          </button>
          {peaks.length > 0 && (
            <button
              type="button"
              onClick={() => importPasted("append")}
              disabled={pasteText.trim() === ""}
              className="rounded-md border border-stone-300 px-3 py-1 text-xs font-medium text-stone-600 transition-colors hover:bg-white disabled:opacity-40"
            >
              末尾に追加
            </button>
          )}
          {pasteMessage && <span className="text-xs text-stone-600">{pasteMessage}</span>}
        </div>
      </details>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-stone-200 text-left text-xs text-stone-600">
            <th className="w-16 py-1">id</th>
            <th className="py-1">δ (ppm)</th>
            {nucleus === "1H" && <th className="py-1">積分</th>}
            <th className="w-10 py-1" />
          </tr>
        </thead>
        <tbody>
          {peaks.map((peak) => (
            <tr key={`${generation}-${peak.id}`} className="border-b border-stone-100">
              <td className="py-1 font-mono text-stone-500">{peak.id}</td>
              <td className="py-1 pr-2">
                {/*
                  value/onChangeで毎キー入力ごとに数値へ丸めてしまうと、
                  空にして打ち直そうとしたときに直後に0へ戻され、
                  Backspaceで消せない/打ち直した値が反映されない、という
                  問題が起きる。defaultValue+onBlurの非制御入力にして、
                  フォーカスが外れた時点(次へ/Analyzeボタン押下時を含む)
                  でだけ確定させる。
                */}
                <input
                  type="number"
                  step="0.01"
                  defaultValue={peak.shift}
                  onBlur={(e) => {
                    const parsed = parseFloat(e.target.value);
                    updateRow(peak.id, { shift: Number.isNaN(parsed) ? 0 : parsed });
                  }}
                  className="w-24 rounded border border-stone-300 px-2 py-1"
                  aria-label={`${peak.id} の化学シフト`}
                />
              </td>
              {nucleus === "1H" && (
                <td className="py-1 pr-2">
                  <input
                    type="number"
                    defaultValue={peak.integration ?? ""}
                    onBlur={(e) => {
                      const parsed = parseInt(e.target.value, 10);
                      updateRow(peak.id, {
                        integration: Number.isNaN(parsed) ? undefined : parsed,
                      });
                    }}
                    className="w-16 rounded border border-stone-300 px-2 py-1"
                    aria-label={`${peak.id} の積分値`}
                  />
                </td>
              )}
              <td className="py-1">
                <button
                  type="button"
                  onClick={() => removeRow(peak.id)}
                  aria-label={`${peak.id} を削除`}
                  className="text-stone-400 hover:text-red-600"
                >
                  ×
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        type="button"
        onClick={addRow}
        className="self-start rounded-md border border-stone-300 px-3 py-1 text-xs font-medium text-stone-600 transition-colors hover:bg-stone-50"
      >
        + ピークを追加
      </button>
    </div>
  );
}
