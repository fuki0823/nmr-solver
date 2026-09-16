"use client";

import { useState } from "react";
import type {
  AnalysisInput,
  Correlation2D,
  MassSpecData,
  SpectralPeak,
} from "@/lib/analyze/types";
import {
  generateFormulaCandidates,
  neutralMassFromAdduct,
} from "@/lib/analyze/formula/massToFormulaCandidates";
import { localCandidateProvider } from "@/lib/analyze/candidates/localProvider";
import { pubchemCandidateProvider } from "@/lib/analyze/candidates/pubchemProvider";
import type { CandidateProvider } from "@/lib/analyze/candidates/CandidateProvider";
import type { CandidateStructure } from "@/lib/analyze/types";
import {
  evaluateCandidate,
  rankCandidates,
  type CandidateEvaluation,
} from "@/lib/analyze/scoring/rankCandidates";

const PROVIDERS: CandidateProvider[] = [localCandidateProvider, pubchemCandidateProvider];

// 開発/テスト用フック: 本番ビルドではNODE_ENVチェックによりdead-code
// eliminationで消える。ハード制約ロジック(¹³C数/HSQC/HMBC)を、
// PubChemへの実ネットワーク呼び出しやウィザードUIの手操作なしに、
// Playwrightから決定論的に検証するために window に公開している。
// (scripts/analyze-hard-constraints.test.mjs から使用)
if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
  (window as unknown as { __nmrAnalyzeDebug?: unknown }).__nmrAnalyzeDebug = {
    evaluateCandidate,
  };
}
import MassSpecInput from "./MassSpecInput";
import PeakTableInput from "./PeakTableInput";
import CorrelationInput from "./CorrelationInput";
import CandidateCard from "./CandidateCard";

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

      let formulaCandidates: string[] | undefined;
      let targetMass: number | null = null;
      if (ms.exactMass != null) targetMass = ms.exactMass;
      else if (ms.measuredMz != null && ms.ionAdduct) {
        targetMass = neutralMassFromAdduct(ms.measuredMz, ms.ionAdduct);
      }
      if (targetMass != null) {
        formulaCandidates = generateFormulaCandidates(
          targetMass,
          ms.massTolerancePpm ?? 10,
        ).map((f) => f.formula);
      }

      setSearchedPubchem((formulaCandidates?.length ?? 0) > 0);

      // 各プロバイダは順番に問い合わせる(PubChemのレート制限に配慮し、
      // かつ候補プールが十分あれば途中で打ち切れるようにするため)。
      const seenSmiles = new Set<string>();
      const candidates: CandidateStructure[] = [];
      for (const provider of PROVIDERS) {
        const found = await provider.search({ formulaCandidates, limit: 30 });
        for (const c of found) {
          if (seenSmiles.has(c.smiles)) continue;
          seenSmiles.add(c.smiles);
          candidates.push(c);
        }
      }

      const results = await rankCandidates(input, candidates);
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
          MS・¹H NMR・¹³C NMR(・COSY/HSQC/HMBC/NOESY)を入力すると、既存クイズの正解構造とPubChem(MSの分子式候補で検索)を候補プールとして、一致度をランキングします。化学的な一致判定はすべて決定論的なロジックで行い、AIは使用していません。
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
              MSデータ(測定m/z+アダクト、またはExact Mass)が未入力のため、今回はPubChemを検索していません(既存クイズの正解構造のみを候補プールとしています)。
            </p>
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
