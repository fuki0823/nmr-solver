import { classifyCarbonBucket, protonBucketForCarbonBucket, protonBucketFromShift, type ProtonBucket } from "../chemicalEnvironment";
import { parseFormula } from "../formulaUtils";
import type { ValidationContext, ValidationDetail, ValidationResult } from "./types";

const BUCKET_LABEL: Record<ProtonBucket, string> = {
  veryDeshielded: "強く低磁場シフト(δ9+, アルデヒド等)",
  aromaticOrAlkene: "芳香族/アルケン(δ4.5-9)",
  heteroatomAdjacent: "ヘテロ原子隣接(δ2.2-4.5)",
  aliphatic: "脂肪族(δ0-2.2)",
};

export function protonValidator(context: ValidationContext): ValidationResult {
  const { input, candidate, candidateGraph } = context;
  const peaks = input.peaks.filter((p) => p.nucleus === "1H");
  if (peaks.length === 0) {
    return { method: "1H", status: "not_evaluated", score: 0, details: [] };
  }

  const details: ValidationDetail[] = [];

  // 1. 総積分値 vs 候補の総H数
  const totalIntegration = peaks.reduce((sum, p) => sum + (p.integration ?? 0), 0);
  const candidateH = parseFormula(candidate.molecularFormula).H ?? 0;
  let integrationScore = 0.5;
  if (totalIntegration > 0) {
    const diff = Math.abs(totalIntegration - candidateH);
    integrationScore = Math.max(0, 1 - diff / Math.max(candidateH, 1));
    details.push({
      status: diff === 0 ? "match" : diff <= 1 ? "partial" : "mismatch",
      summary: `積分値の合計: 入力${totalIntegration}H / 候補の総水素数${candidateH}H`,
    });
  }

  // 2. シフト領域(バケット)ごとの分布(積分値で重み付け)
  const candidateBucketH: Record<ProtonBucket, number> = {
    veryDeshielded: 0,
    aromaticOrAlkene: 0,
    heteroatomAdjacent: 0,
    aliphatic: 0,
  };
  for (const atom of candidateGraph.atoms) {
    if (atom.element !== "C" || !atom.attachedH) continue;
    const bucket = protonBucketForCarbonBucket(classifyCarbonBucket(candidateGraph, atom));
    candidateBucketH[bucket] += atom.attachedH;
  }
  const peakBucketH: Record<ProtonBucket, number> = {
    veryDeshielded: 0,
    aromaticOrAlkene: 0,
    heteroatomAdjacent: 0,
    aliphatic: 0,
  };
  for (const peak of peaks) {
    peakBucketH[protonBucketFromShift(peak.shift)] += peak.integration ?? 0;
  }

  let bucketMismatches = 0;
  for (const bucket of Object.keys(BUCKET_LABEL) as ProtonBucket[]) {
    const expected = peakBucketH[bucket];
    const actual = candidateBucketH[bucket];
    if (expected === 0 && actual === 0) continue;
    const bucketStatus =
      expected === actual ? "match" : Math.abs(expected - actual) <= 1 ? "partial" : "mismatch";
    if (bucketStatus !== "match") bucketMismatches++;
    details.push({
      status: bucketStatus,
      summary: `${BUCKET_LABEL[bucket]}: 入力${expected}H / 候補は炭素上に${actual}H(酸素・窒素上のHは含まない概算)`,
    });
  }
  const bucketScore = Math.max(0, 1 - bucketMismatches / 4);

  const score = (integrationScore + bucketScore) / 2;
  const status = score >= 0.8 ? "match" : score >= 0.4 ? "partial" : "mismatch";

  return { method: "1H", status, score, details };
}
