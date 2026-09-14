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

  return { candidate, results, totalScore, confidence, structureImageSmiles: candidate.smiles };
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
  return evaluations.sort((a, b) => b.totalScore - a.totalScore);
}
