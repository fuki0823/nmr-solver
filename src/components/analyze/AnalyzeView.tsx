"use client";

import { useState } from "react";
import type {
  AnalysisInput,
  Correlation2D,
  MassSpecData,
  SpectralPeak,
} from "@/lib/analyze/types";
import type { FormulaSearchResult } from "@/lib/analyze/formula/formulasFromInput";
import {
  evaluateCandidate,
  type CandidateEvaluation,
} from "@/lib/analyze/scoring/rankCandidates";
import { runAnalysis } from "@/lib/analyze/runAnalysis";
import { analyzeSmiles, inchiKeyOf } from "@/lib/analyze/ketcherService";
import { couplingPartners } from "@/lib/analyze/multiplicity";
import { expectedProtonRange } from "@/lib/analyze/shiftRanges";
import { predictAromaticCarbons } from "@/lib/analyze/prediction/aromaticIncrements";
import { predictAliphaticCarbons } from "@/lib/analyze/prediction/aliphaticIncrements";

// 開発/テスト用フック: 本番ビルドではNODE_ENVチェックによりdead-code
// eliminationで消える。Playwrightから解析処理を直接呼び出すために
// window に公開している。
//  - evaluateCandidate: 1候補の評価(scripts/analyze-hard-constraints.test.mjs)
//  - runAnalysis: パイプライン全体(scripts/analyze-regression.mjs)
//  - inchiKeyOf: 正解判定用のInChIKey計算(同上)
if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
  (window as unknown as { __nmrAnalyzeDebug?: unknown }).__nmrAnalyzeDebug = {
    evaluateCandidate,
    runAnalysis,
    inchiKeyOf,
    // 芳香環の炭素の予測シフト(置換基加成則の確認用)
    async predictCarbons(smiles: string) {
      const graph = await analyzeSmiles(smiles);
      const aro = predictAromaticCarbons(graph);
      const ali = predictAliphaticCarbons(graph);
      return graph.atoms
        .map((a, i) => ({ atom: i, element: a.element, h: a.attachedH, pred: aro[i] ?? ali[i], method: aro[i] != null ? "aromatic" : "aliphatic" }))
        .filter((x) => x.pred != null);
    },
    // 原子ごとのHのシフト範囲・カップリング相手の数(多重度判定の確認用)
    async protonModel(smiles: string) {
      const graph = await analyzeSmiles(smiles);
      const partners = couplingPartners(graph);
      return graph.atoms
        .filter((a) => a.element === "C" && (a.attachedH ?? 0) > 0)
        .map((a) => ({
          atom: a.index,
          h: a.attachedH,
          neighbors: a.heavyNeighbors.map(([n, o]) => `${graph.atoms[n].element}${n}(H${graph.atoms[n].attachedH ?? "?"},o${o})`).join(" "),
          range: expectedProtonRange(graph, a),
          ...partners[a.index],
        }));
    },
  };
}
import MassSpecInput from "./MassSpecInput";
import PeakTableInput from "./PeakTableInput";
import CorrelationInput from "./CorrelationInput";
import CandidateCard from "./CandidateCard";
import FormulaEstimatePanel from "./FormulaEstimatePanel";

const STEPS = ["MS", "¹H NMR", "¹³C NMR", "2D NMR", "結果"] as const;

export default function AnalyzeView() {
  const [step, setStep] = useState(0);
  const [ms, setMs] = useState<MassSpecData>({});
  const [peaks, setPeaks] = useState<SpectralPeak[]>([]);
  const [correlations, setCorrelations] = useState<Correlation2D[]>([]);
  const [evaluations, setEvaluations] = useState<CandidateEvaluation[] | null>(null);
  // 直近の解析に使われた入力(参照)を覚えておき、現在の入力と比較する
  // ことで「結果が古い(入力変更後に未再解析)」かどうかをレンダー時に
  // 導出する。effect内でsetStateして無効化する方式は、React 19の
  // purityルール(setState in effect)に反するため避けている。
  const [analyzedInput, setAnalyzedInput] = useState<AnalysisInput | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [searchedPubchem, setSearchedPubchem] = useState(false);
  const [formulaEstimate, setFormulaEstimate] = useState<FormulaSearchResult | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  const protonPeaks = peaks.filter((p) => p.nucleus === "1H");
  const carbonPeaks = peaks.filter((p) => p.nucleus === "13C");

  const isStale =
    evaluations != null &&
    analyzedInput != null &&
    (analyzedInput.ms !== ms ||
      analyzedInput.peaks !== peaks ||
      analyzedInput.correlations !== correlations);

  const setPeaksForNucleus = (nucleus: "1H" | "13C") => (updated: SpectralPeak[]) => {
    setPeaks([...peaks.filter((p) => p.nucleus !== nucleus), ...updated]);
  };

  const handleAnalyze = async () => {
    setAnalyzing(true);
    setAnalyzeError(null);
    try {
      const input: AnalysisInput = { ms, peaks, correlations };

      const result = await runAnalysis(input);
      setFormulaEstimate(result.formulaEstimate);
      setSearchedPubchem(result.searchedPubchem);
      setWarnings(result.warnings);
      const results = result.evaluations;
      setEvaluations(results);
      setAnalyzedInput(input);
      setStep(4);
    } catch {
      setAnalyzeError(
        "解析中にエラーが発生しました。入力内容を確認し、もう一度お試しください。",
      );
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-6 py-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold text-stone-900">Analyze</h1>
        <p className="text-sm text-stone-700">
          MS・¹H NMR・¹³C NMR(・COSY/HSQC/HMBC/NOESY)を入力すると、一致度をランキングします。化学的な一致判定はすべて決定論的なロジックで行います。
        </p>
      </header>

      <nav className="flex flex-wrap gap-2">
        {STEPS.map((label, i) => (
          <button
            key={label}
            type="button"
            onClick={() => setStep(i)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              step === i
                ? "bg-stone-900 text-white"
                : "bg-stone-100 text-stone-600 hover:bg-stone-200"
            }`}
          >
            Step {i + 1}: {label}
          </button>
        ))}
      </nav>

      {step === 0 && (
        <section className="rounded-lg border border-stone-200 bg-white p-5">
          <h2 className="mb-3 text-xs font-semibold tracking-wide text-stone-600 uppercase">
            MS
          </h2>
          <MassSpecInput value={ms} onChange={setMs} />
        </section>
      )}

      {step === 1 && (
        <section className="rounded-lg border border-stone-200 bg-white p-5">
          <h2 className="mb-3 text-xs font-semibold tracking-wide text-stone-600 uppercase">
            ¹H NMR
          </h2>
          <PeakTableInput
            nucleus="1H"
            peaks={protonPeaks}
            onChange={setPeaksForNucleus("1H")}
          />
        </section>
      )}

      {step === 2 && (
        <section className="rounded-lg border border-stone-200 bg-white p-5">
          <h2 className="mb-3 text-xs font-semibold tracking-wide text-stone-600 uppercase">
            ¹³C NMR
          </h2>
          <PeakTableInput
            nucleus="13C"
            peaks={carbonPeaks}
            onChange={setPeaksForNucleus("13C")}
          />
        </section>
      )}

      {step === 3 && (
        <section className="flex flex-col gap-5 rounded-lg border border-stone-200 bg-white p-5">
          <h2 className="text-xs font-semibold tracking-wide text-stone-600 uppercase">
            2D NMR(任意)
          </h2>
          {peaks.length === 0 ? (
            <p className="text-sm text-stone-500">
              先にStep2/Step3でピークを入力してください。
            </p>
          ) : (
            <>
              <CorrelationInput
                kind="COSY"
                peaks={peaks}
                correlations={correlations}
                onChange={setCorrelations}
              />
              <CorrelationInput
                kind="HSQC"
                peaks={peaks}
                correlations={correlations}
                onChange={setCorrelations}
              />
              <CorrelationInput
                kind="HMBC"
                peaks={peaks}
                correlations={correlations}
                onChange={setCorrelations}
              />
              <CorrelationInput
                kind="NOESY"
                peaks={peaks}
                correlations={correlations}
                onChange={setCorrelations}
              />
            </>
          )}
        </section>
      )}

      {step < 4 && (
        <div className="flex items-center gap-3">
          {step > 0 && (
            <button
              type="button"
              onClick={() => setStep((s) => s - 1)}
              className="rounded-md border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 transition-colors hover:bg-stone-50"
            >
              戻る
            </button>
          )}
          {step < 3 ? (
            <button
              type="button"
              onClick={() => setStep((s) => s + 1)}
              className="rounded-md bg-stone-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-stone-700"
            >
              次へ
            </button>
          ) : (
            <button
              type="button"
              onClick={handleAnalyze}
              disabled={analyzing || peaks.length === 0}
              className="rounded-md bg-stone-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-stone-700 disabled:cursor-not-allowed disabled:bg-stone-300"
            >
              {analyzing ? "解析中…" : "Analyze"}
            </button>
          )}
        </div>
      )}

      {analyzeError && (
        <p className="rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {analyzeError}
        </p>
      )}

      {step === 4 && (
        <section className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold tracking-wide text-stone-600 uppercase">
              Candidate structures
            </h2>
            <button
              type="button"
              onClick={() => setStep(0)}
              className="rounded-md border border-stone-300 px-3 py-1 text-xs font-medium text-stone-600 transition-colors hover:bg-stone-50"
            >
              入力からやり直す
            </button>
          </div>
          {!searchedPubchem && (
            <p className="rounded-md bg-stone-100 px-4 py-2 text-xs text-stone-600">
              MSデータ(測定m/z+アダクト、またはMolecular Weight)が未入力のため、今回はPubChemを検索していません(既存クイズの正解構造のみを候補プールとしています)。
            </p>
          )}
          {warnings.length > 0 && evaluations != null && !isStale && (
            <ul className="flex flex-col gap-1 rounded-md bg-amber-50 px-4 py-2 text-xs text-amber-800">
              {warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
          {formulaEstimate && evaluations != null && !isStale && (
            <FormulaEstimatePanel result={formulaEstimate} />
          )}
          {evaluations == null || isStale ? (
            <div className="flex flex-col items-start gap-3 rounded-lg border border-stone-200 bg-white p-5">
              <p className="text-sm text-stone-500">
                {isStale
                  ? "入力内容が変更されました。再解析してください。"
                  : "まだ解析していません。"}
              </p>
              <button
                type="button"
                onClick={handleAnalyze}
                disabled={analyzing || peaks.length === 0}
                className="rounded-md bg-stone-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-stone-700 disabled:cursor-not-allowed disabled:bg-stone-300"
              >
                {analyzing ? "解析中…" : isStale ? "再解析する (Analyze)" : "Analyze"}
              </button>
            </div>
          ) : evaluations.length === 0 ? (
            <p className="text-sm text-stone-500">
              条件に一致する候補が見つかりませんでした。
            </p>
          ) : (
            (() => {
              const included = evaluations.filter((e) => !e.excluded);
              const excluded = evaluations.filter((e) => e.excluded);
              return (
                <>
                  {included.map((evaluation, i) => (
                    <CandidateCard key={evaluation.candidate.id} rank={i + 1} evaluation={evaluation} />
                  ))}
                  {excluded.length > 0 && (
                    <>
                      <div className="mt-2 flex items-center gap-2">
                        <h3 className="text-xs font-semibold tracking-wide text-stone-500 uppercase">
                          除外された候補({excluded.length}件)
                        </h3>
                        <p className="text-xs text-stone-400">
                          ¹³C炭素数・HSQC・HMBCの観測データと明らかに矛盾するため除外されましたが、参考として確認できます。
                        </p>
                      </div>
                      {excluded.map((evaluation, i) => (
                        <CandidateCard
                          key={evaluation.candidate.id}
                          rank={included.length + i + 1}
                          evaluation={evaluation}
                        />
                      ))}
                    </>
                  )}
                </>
              );
            })()
          )}
        </section>
      )}
    </div>
  );
}
