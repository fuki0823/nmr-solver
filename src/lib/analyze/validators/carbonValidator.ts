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
  let hardReject = false;

  // 1. 炭素原子数のハード制約。
  //
  // 観測される¹³Cシグナルの本数は、対称性(等価な炭素環境の重なり)や
  // シグナルの偶然の重なりによって、候補の炭素原子数より「少なく」
  // なることは常にあり得る(例: 無水マレイン酸 C4、対称性によりシグナル
  // 2本)。逆に、候補の炭素原子数より「多い」シグナル数が観測されることは
  // 物理的にあり得ない(1個の炭素原子が複数のシグナルを生むことはない)。
  // そのため、非対称に扱う: 超過のみをハード制約違反とする。
  const totalCarbonAtoms = candidateGraph.atoms.filter((a) => a.element === "C").length;
  const uniqueEnvironments = countDistinctCarbonEnvironments(candidateGraph);
  let countScore = 0.5;

  if (peaks.length > totalCarbonAtoms) {
    hardReject = true;
    countScore = 0;
    details.push({
      status: "mismatch",
      hardConstraint: true,
      summary: `¹³Cシグナル数(${peaks.length}本)が候補構造の炭素原子数(${totalCarbonAtoms}個)を超えています。1個の炭素原子から複数のシグナルが生じることはないため、対称性を考慮してもこの候補ではあり得ません。`,
    });
  } else if (uniqueEnvironments != null) {
    if (peaks.length >= uniqueEnvironments) {
      // uniqueEnvironments <= 観測本数 <= 全炭素数: 対称性や偶然の重なりで
      // 矛盾なく説明できる範囲。ハード制約としては通過させる。
      countScore = 1;
      details.push({
        status: "match",
        summary:
          peaks.length === totalCarbonAtoms
            ? `¹³Cシグナル数(${peaks.length}本)は候補構造の炭素原子数(${totalCarbonAtoms}個)と一致します`
            : `¹³Cシグナル数(${peaks.length}本)は候補構造の炭素原子数(${totalCarbonAtoms}個、対称性を考慮した最少${uniqueEnvironments}種類の環境)の範囲内で矛盾しません(対称性やシグナルの重なりで説明可能)`,
      });
    } else {
      // 観測本数がこちらの対称性モデルが見積もる最少環境数より少ない。
      // 判定モデルの粗さやシグナルの偶然の重なりの可能性もあるため、
      // ハード制約にはせず、差が大きいほどソフトスコアを下げるに留める。
      const diff = uniqueEnvironments - peaks.length;
      countScore = Math.max(0, 1 - diff / Math.max(uniqueEnvironments, 1));
      details.push({
        status: diff <= 1 ? "partial" : "mismatch",
        summary: `¹³Cシグナル数(${peaks.length}本)が、候補構造で対称性を考慮しても見積もられる最少種類数(${uniqueEnvironments}種類)より少ないです。シグナルの偶然の重なりの可能性はありますが、差が大きいほど整合性は低くなります。`,
      });
    }
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

  const score = hardReject ? 0 : (countScore + bucketScore) / 2;
  const status = hardReject ? "mismatch" : score >= 0.8 ? "match" : score >= 0.4 ? "partial" : "mismatch";

  return { method: "13C", status, score, details };
}
