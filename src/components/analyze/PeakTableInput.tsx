"use client";

import type { Nucleus, SpectralPeak } from "@/lib/analyze/types";

interface PeakTableInputProps {
  nucleus: Nucleus;
  peaks: SpectralPeak[];
  onChange: (peaks: SpectralPeak[]) => void;
}

const peakIdCounters: Record<Nucleus, number> = { "1H": 0, "13C": 0 };
function nextPeakId(nucleus: Nucleus): string {
  peakIdCounters[nucleus]++;
  return `${nucleus === "1H" ? "H" : "C"}${peakIdCounters[nucleus]}`;
}

export default function PeakTableInput({
  nucleus,
  peaks,
  onChange,
}: PeakTableInputProps) {
  const addRow = () => {
    onChange([
      ...peaks,
      { id: nextPeakId(nucleus), nucleus, shift: 0, integration: nucleus === "1H" ? 1 : undefined },
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
                <input
                  type="number"
                  step="0.01"
                  value={peak.shift}
                  onChange={(e) =>
                    updateRow(peak.id, { shift: parseFloat(e.target.value) || 0 })
                  }
                  className="w-24 rounded border border-stone-300 px-2 py-1"
                  aria-label={`${peak.id} の化学シフト`}
                />
              </td>
              {nucleus === "1H" && (
                <td className="py-1 pr-2">
                  <input
                    type="number"
                    value={peak.integration ?? ""}
                    onChange={(e) =>
                      updateRow(peak.id, {
                        integration: parseInt(e.target.value, 10) || undefined,
                      })
                    }
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
