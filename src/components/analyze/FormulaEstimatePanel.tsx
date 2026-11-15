"use client";

import type { FormulaEstimate } from "@/lib/analyze/formula/estimateFormula";
import type { FormulaSearchResult } from "@/lib/analyze/formula/formulasFromInput";

const SHOW_COUNT = 5;

const LEVEL_NOTE: Record<FormulaEstimate["level"], string> = {
  strict: "MSの質量・¹³Cピーク数・¹H積分値・¹³Cのsp2炭素から見積もった不飽和度の下限のすべてと矛盾しない分子式です。",
  symmetry:
    "炭素数がピーク数+2以内の分子式が見つからなかったため、対称性で等価な炭素がある(ピーク数より炭素数が多い)と仮定して探しました。",
  massOnly:
    "¹³Cピーク数・¹H積分値と両立する分子式が見つからなかったため、質量のみで選んでいます。積分値やピークの入力を確認してください。",
};

function massNote(result: FormulaSearchResult): string {
  if (result.reinterpretedExactMassAsAverage) {
    return `Exact Mass欄の ${result.targetMass} を精密質量として探すとNMRと両立する分子式が無かったため、平均分子量(Molecular Weight)として計算しました。精密質量のつもりであれば、入力値を確認してください。`;
  }
  return result.massKind === "average"
    ? `分子量 ${result.targetMass}(平均分子量)から計算しています。`
    : `精密質量 ${result.targetMass.toFixed(4)}(モノアイソトピック)から計算しています。`;
}

export default function FormulaEstimatePanel({ result }: { result: FormulaSearchResult }) {
  const estimate = result.estimate;
  const top = estimate.formulas.slice(0, SHOW_COUNT);
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-4">
      <h3 className="text-xs font-semibold tracking-wide text-stone-600 uppercase">推定分子式</h3>
      <p
        className={`mt-1 text-xs ${result.reinterpretedExactMassAsAverage ? "text-amber-700" : "text-stone-600"}`}
      >
        {massNote(result)}
      </p>
      <p
        className={`mt-1 text-xs ${estimate.level === "strict" ? "text-stone-600" : "text-amber-700"}`}
      >
        {LEVEL_NOTE[estimate.level]}
        {estimate.formulas.length > 0 &&
          ` 該当${estimate.formulas.length}件のうち上位から順にPubChemを検索しています。`}
      </p>
      {top.length === 0 ? (
        <p className="mt-2 text-sm text-stone-500">質量に合う分子式がありませんでした。</p>
      ) : (
        <table className="mt-2 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-stone-200 text-left text-xs text-stone-600">
              <th className="py-1">分子式</th>
              <th className="py-1">不飽和度</th>
              <th className="py-1">質量誤差</th>
              <th className="py-1">C − ¹³C本数</th>
              <th className="py-1">H − ¹H積分</th>
            </tr>
          </thead>
          <tbody>
            {top.map((f) => (
              <tr key={f.formula} className="border-b border-stone-100 font-mono">
                <td className="py-1 text-stone-900">{f.formula}</td>
                <td className="py-1 text-stone-600">{f.degreeOfUnsaturation}</td>
                <td className="py-1 text-stone-600">
                  {result.massKind === "average"
                    ? `${(f.exactMass - result.targetMass).toFixed(3)} Da`
                    : `${f.massErrorPpm} ppm`}
                </td>
                <td className="py-1 text-stone-600">{f.carbonExcess == null ? "—" : `+${f.carbonExcess}`}</td>
                <td className="py-1 text-stone-600">
                  {f.hydrogenDiff == null ? "—" : f.hydrogenDiff > 0 ? `+${f.hydrogenDiff}` : f.hydrogenDiff}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="mt-2 text-xs text-stone-500">
        H − ¹H積分 がプラスの分は、OH/NHなど¹H NMRで観測されにくい水素として扱っています。
      </p>
    </div>
  );
}
