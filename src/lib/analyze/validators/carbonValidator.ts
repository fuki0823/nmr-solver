import { countDistinctCarbonEnvironments } from "../../moleculeGraph";
import { carbonBucketFromShift, classifyCarbonBucket, type CarbonBucket } from "../chemicalEnvironment";
import type { ValidationContext, ValidationDetail, ValidationResult } from "./types";

const BUCKET_LABEL: Record<CarbonBucket, string> = {
  carbonyl: "カルボニル(δ190+)",
  carboxylOrAmide: "エステル/酸/アミド(δ155-190)",
  aromaticOrAlkene: "芳香族/アルケン(δ95-155)",
  oxygenatedSp3: "ヘテロ原子隣接sp3(δ50-95)",
  aliphatic: "脂肪族(δ0-50)",
};

export function carbonValidator(context: ValidationContext): ValidationResult {
  const { input, candidateGraph } = context;
  const peaks = input.peaks.filter((p) => p.nucleus === "13C");
  if (peaks.length === 0) {
    return { method: "13C", status: "not_evaluated", score: 0, details: [] };
  }

  const details: ValidationDetail[] = [];

  // 1. 炭素環境の総数(対称性を考慮)の比較
  const candidateCount = countDistinctCarbonEnvironments(candidateGraph);
  let countScore = 0.5;
  if (candidateCount != null) {
    const diff = Math.abs(candidateCount - peaks.length);
    countScore = Math.max(0, 1 - diff / Math.max(peaks.length, 1));
    details.push({
      status: diff === 0 ? "match" : diff <= 1 ? "partial" : "mismatch",
      summary: `炭素シグナル数: 候補は約${candidateCount}種類の環境、入力は${peaks.length}本`,
    });
  }

  // 2. 化学シフト領域(バケット)ごとの分布比較
  const candidateBucketCounts: Record<CarbonBucket, number> = {
    carbonyl: 0,
    carboxylOrAmide: 0,
    aromaticOrAlkene: 0,
    oxygenatedSp3: 0,
    aliphatic: 0,
  };
  for (const atom of candidateGraph.atoms) {
    if (atom.element !== "C") continue;
    candidateBucketCounts[classifyCarbonBucket(candidateGraph, atom)]++;
  }
  const peakBucketCounts: Record<CarbonBucket, number> = {
    carbonyl: 0,
    carboxylOrAmide: 0,
    aromaticOrAlkene: 0,
    oxygenatedSp3: 0,
    aliphatic: 0,
  };
  for (const peak of peaks) {
    peakBucketCounts[carbonBucketFromShift(peak.shift)]++;
  }

  let bucketMismatches = 0;
  for (const bucket of Object.keys(BUCKET_LABEL) as CarbonBucket[]) {
    const expected = peakBucketCounts[bucket];
    const actual = candidateBucketCounts[bucket];
    if (expected === 0 && actual === 0) continue;
    const bucketStatus =
      expected === actual ? "match" : Math.abs(expected - actual) === 1 ? "partial" : "mismatch";
    if (bucketStatus !== "match") bucketMismatches++;
    details.push({
      status: bucketStatus,
      summary: `${BUCKET_LABEL[bucket]}: 入力${expected}本 / 候補は炭素${actual}個`,
    });
  }
  const bucketScore = Math.max(0, 1 - bucketMismatches / 5);

  const score = (countScore + bucketScore) / 2;
  const status = score >= 0.8 ? "match" : score >= 0.4 ? "partial" : "mismatch";

  return { method: "13C", status, score, details };
}
