import { analyzeSmiles } from "../ketcherService";
import { assignPeaks } from "../assignment/assignPeaks";
import type { AnalysisInput, CandidateStructure, Confidence } from "../types";
import { carbonValidator } from "../validators/carbonValidator";
import { cosyValidator } from "../validators/cosyValidator";
import { hmbcValidator } from "../validators/hmbcValidator";
import { hsqcValidator } from "../validators/hsqcValidator";
import { msValidator } from "../validators/msValidator";
import { noesyValidator } from "../validators/noesyValidator";
import { protonValidator } from "../validators/protonValidator";
import type { ValidationContext, ValidationResult, Validator } from "../validators/types";

/**
 * 各手法の重み。COSY/HSQC/HMBCはデータが与えられた場合、構造決定への
 * 寄与が大きいため相対的に重くしている。存在しない手法(not_evaluated)は
 * 分母から除外する(§9の方針通り、データが少ないことを「悪いスコア」に
 * しない。その代わりconfidenceを下げる)。
 */
const METHOD_WEIGHT: Record<ValidationResult["method"], number> = {
  MS: 1.5,
  "1H": 1,
  "13C": 1,
  COSY: 1.2,
  HSQC: 1,
  HMBC: 1.5,
  NOESY: 0.5,
};

const VALIDATORS: Validator[] = [
  msValidator,
  protonValidator,
  carbonValidator,
  cosyValidator,
  hsqcValidator,
  hmbcValidator,
  noesyValidator,
];

export interface CandidateEvaluation {
  candidate: CandidateStructure;
  results: ValidationResult[];
  /** 0-100。あくまで内部的な指標であり確率ではない("Match Score"として表示する) */
  totalScore: number;
  confidence: Confidence;
  structureImageSmiles: string;
  /**
   * true の場合、¹³C炭素数・HSQC・HMBCなどのハード制約(hardConstraint:
   * true の ValidationDetail)に明らかに矛盾しており、Stage 1(ハード
   * フィルタリング)で除外された候補。ranking結果からは取り除かず、
   * 「なぜ除外されたか」をユーザーが確認できるよう保持する。
   */
  excluded: boolean;
  /** excluded=true の場合の除外理由(hardConstraint違反のsummary一覧) */
  exclusionReasons: string[];
}

export async function evaluateCandidate(
  input: AnalysisInput,
  candidate: CandidateStructure,
): Promise<CandidateEvaluation | null> {
  let candidateGraph;
  try {
    candidateGraph = await analyzeSmiles(candidate.smiles);
  } catch {
    return null;
  }
  if (candidateGraph.hasUnsupportedElement) return null;

  const assignment = assignPeaks(input, candidateGraph);
  const context: ValidationContext = { input, candidate, candidateGraph, assignment };

  const results = VALIDATORS.map((v) => v(context));

  let weightedSum = 0;
  let weightTotal = 0;
  let evaluatedMethods = 0;
  for (const r of results) {
    if (r.status === "not_evaluated") continue;
    const weight = METHOD_WEIGHT[r.method];
    weightedSum += r.score * weight;
    weightTotal += weight;
    evaluatedMethods++;
  }
  const totalScore = weightTotal > 0 ? Math.round((weightedSum / weightTotal) * 100) : 0;

  const confidence: Confidence =
    evaluatedMethods >= 4 ? "high" : evaluatedMethods >= 2 ? "medium" : "low";

  // Stage 1: ハードフィルタリング。分子式・質量・¹³C炭素数・HSQC・HMBC等の
  // validatorが hardConstraint: true を立てた detail が1つでもあれば、
  // AIの印象評価ではなく構造化された化学的制約のみに基づき「明らかに
  // 矛盾する」候補として excluded とする。除外してもリストからは
  // 落とさず、理由と共にそのまま返す(ユーザーが後から検証できるように)。
  const exclusionReasons: string[] = [];
  for (const r of results) {
    for (const d of r.details) {
      if (d.hardConstraint && d.status === "mismatch") {
        exclusionReasons.push(`[${r.method}] ${d.summary}`);
      }
    }
  }
  const excluded = exclusionReasons.length > 0;

  if (process.env.NODE_ENV !== "production") {
    const carbonAtomCount = candidateGraph.atoms.filter((a) => a.element === "C").length;
    const observed13CCount = input.peaks.filter((p) => p.nucleus === "13C").length;
    const hsqcResult = results.find((r) => r.method === "HSQC");
    const hmbcResult = results.find((r) => r.method === "HMBC");
    const countByStatus = (r: ValidationResult | undefined, status: string) =>
      r?.details.filter((d) => d.status === status).length ?? 0;
    console.debug("[analyze/evaluateCandidate]", {
      candidateId: candidate.id,
      formula: candidate.molecularFormula,
      smiles: candidate.smiles,
      carbonAtomCount,
      observed13CCount,
      carbonCountStatus: observed13CCount > carbonAtomCount ? "impossible" : "ok",
      hsqcMatched: countByStatus(hsqcResult, "match"),
      hsqcFailed: countByStatus(hsqcResult, "mismatch"),
      hmbcMatched: countByStatus(hmbcResult, "match"),
      hmbcFailed: countByStatus(hmbcResult, "mismatch"),
      excluded,
      exclusionReasons,
      totalScore,
      finalStatus: excluded ? "excluded" : "ranked",
    });
  }

  return {
    candidate,
    results,
    totalScore,
    confidence,
    structureImageSmiles: candidate.smiles,
    excluded,
    exclusionReasons,
  };
}

export async function rankCandidates(
  input: AnalysisInput,
  candidates: CandidateStructure[],
): Promise<CandidateEvaluation[]> {
  // ヘッドレスstructServiceは単一のWASM workerを共有しているため、
  // Promise.allで一斉にconvertを呼ぶとリクエストが詰まり極端に遅くなる
  // (実測で確認済み)。1件ずつ順番に評価する。
  const evaluations: CandidateEvaluation[] = [];
  for (const c of candidates) {
    const evaluation = await evaluateCandidate(input, c);
    if (evaluation) evaluations.push(evaluation);
  }
  // Stage 1で除外された候補はリストの末尾にまとめ、除外されなかった候補を
  // totalScoreで降順ランキングする(除外候補も非表示にはせず、常に確認
  // できる状態を保つ)。
  return evaluations.sort((a, b) => {
    if (a.excluded !== b.excluded) return a.excluded ? 1 : -1;
    return b.totalScore - a.totalScore;
  });
}
