"use client";

import type { Nucleus, SpectralPeak } from "@/lib/analyze/types";

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
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-stone-200 text-left text-xs text-stone-600">
            <th className="w-16 py-1">id</th>
            <th className="py-1">δ (ppm)</th>
            {nucleus === "1H" && <th className="py-1">積分</th>}
            {nucleus === "1H" && <th className="py-1">多重度</th>}
            {nucleus === "1H" && <th className="py-1">J (Hz)</th>}
            <th className="w-10 py-1" />
          </tr>
        </thead>
        <tbody>
          {peaks.map((peak) => (
            <tr key={peak.id} className="border-b border-stone-100">
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
              {nucleus === "1H" && (
                <td className="py-1 pr-2">
                  <input
                    type="text"
                    value={peak.multiplicity ?? ""}
                    onChange={(e) => updateRow(peak.id, { multiplicity: e.target.value })}
                    className="w-16 rounded border border-stone-300 px-2 py-1"
                    placeholder="s, d, m..."
                    aria-label={`${peak.id} の多重度`}
                  />
                </td>
              )}
              {nucleus === "1H" && (
                <td className="py-1 pr-2">
                  <input
                    type="text"
                    value={peak.jValues?.join(", ") ?? ""}
                    onChange={(e) =>
                      updateRow(peak.id, {
                        jValues: e.target.value
                          .split(",")
                          .map((v) => parseFloat(v.trim()))
                          .filter((v) => !Number.isNaN(v)),
                      })
                    }
                    className="w-24 rounded border border-stone-300 px-2 py-1"
                    placeholder="7.1"
                    aria-label={`${peak.id} のJ値`}
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
