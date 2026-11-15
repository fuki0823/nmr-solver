import type { AnalysisInput, CandidateStructure } from "./types";
import { estimateFormulasFromInput, type FormulaSearchResult } from "./formula/formulasFromInput";
import { localCandidateProvider } from "./candidates/localProvider";
import { pubchemCandidateProvider } from "./candidates/pubchemProvider";
import type { CandidateProvider } from "./candidates/CandidateProvider";
import { rankCandidates, type CandidateEvaluation } from "./scoring/rankCandidates";

/**
 * Analyzeモードの解析パイプライン全体(分子式推定 → 候補取得 → 評価・順位付け)。
 * 画面(AnalyzeView)と回帰テスト(scripts/analyze-regression.mjs)の両方から
 * 同じ処理を呼ぶために、UIから切り離している。
 */

export const DEFAULT_PROVIDERS: CandidateProvider[] = [
  localCandidateProvider,
  pubchemCandidateProvider,
];

/** 全プロバイダ合計で取得する候補数の上限 */
export const CANDIDATE_LIMIT = 30;
/** 補助候補(炭素数がピーク数より大きく多い分子式)を検索する分子式の数と候補数の上限 */
export const EXTRA_FORMULA_COUNT = 5;
export const EXTRA_CANDIDATE_LIMIT = 10;

export interface AnalysisRunResult {
  formulaEstimate: FormulaSearchResult | null;
  /** PubChemを検索したか(MSが無く分子式候補が無い場合はfalse) */
  searchedPubchem: boolean;
  /** 評価前の候補プール(重複除去済み) */
  candidates: CandidateStructure[];
  evaluations: CandidateEvaluation[];
  /** 候補検索の失敗など、結果の信頼性に影響する警告 */
  warnings: string[];
}

export async function runAnalysis(
  input: AnalysisInput,
  providers: CandidateProvider[] = DEFAULT_PROVIDERS,
): Promise<AnalysisRunResult> {
  // MS(m/z+アダクト or 分子量)の質量に合う分子式を、¹³Cピーク数(炭素数)・
  // ¹H積分合計(水素数)・sp2炭素数(不飽和度の下限)で絞り込み、その
  // 分子式でPubChemを検索する。詳細は formulasFromInput.ts /
  // estimateFormula.ts を参照。
  const formulaEstimate = estimateFormulasFromInput(input.ms ?? {}, input.peaks);
  const formulaCandidates = formulaEstimate?.estimate.formulas.map((f) => f.formula);

  // 各プロバイダは順番に問い合わせる(PubChemのレート制限に配慮するため)。
  const seenSmiles = new Set<string>();
  const candidates: CandidateStructure[] = [];
  const warnings: string[] = [];
  const collect = async (formulas: string[] | undefined, limit: number) => {
    for (const provider of providers) {
      const found = await provider.search({ formulaCandidates: formulas, limit }, (w) => warnings.push(w));
      for (const c of found) {
        if (seenSmiles.has(c.smiles)) continue;
        seenSmiles.add(c.smiles);
        candidates.push(c);
      }
    }
  };
  await collect(formulaCandidates, CANDIDATE_LIMIT);
  // 補助候補: 観測されない第四級炭素が多い場合に備え、主候補とは別枠で少数だけ検索する
  // (主候補の検索枠を減らさないため)。
  const extra = formulaEstimate?.estimate.extraFormulas.slice(0, EXTRA_FORMULA_COUNT).map((f) => f.formula) ?? [];
  if (extra.length > 0) await collect(extra, EXTRA_CANDIDATE_LIMIT);

  const evaluations = await rankCandidates(input, candidates);
  return {
    formulaEstimate,
    searchedPubchem: (formulaCandidates?.length ?? 0) > 0,
    candidates,
    evaluations,
    warnings,
  };
}
