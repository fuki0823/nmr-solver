import { carbonBucketFromShift, hasProtonatedCarbonInBucket } from "../chemicalEnvironment";
import type { ValidationContext, ValidationDetail, ValidationResult } from "./types";

/**
 * HSQC(¹J, 直接結合)の検証。
 *
 * 「第四級炭素はHSQCに出ない」という常に成り立つ化学的事実を使い、
 * 相関先の¹³Cピークが候補構造で第四級炭素(H非結合)に割り当てられて
 * いないかを確認する。
 *
 * ハード制約として扱うのは、以下の「候補構造として原理的にあり得ない」
 * ケースのみ:
 *   (a) 観測¹³Cシフトの領域に該当するプロトン化炭素が候補中に1つも
 *       存在しない(割当の曖昧さの問題ではなく、そもそも構造上存在しない)
 *   (b) 一意に割り当てられた炭素が、候補構造上どうしても第四級炭素になる
 * 「割当先の候補が複数あって一意に決まらない」(assignPeaksが他のピークに
 * 使用済みで割当できなかった等)場合はハード制約にしない(曖昧=除外しない)。
 */
export function hsqcValidator(context: ValidationContext): ValidationResult {
  const { input, candidateGraph, assignment } = context;
  const hsqcCorrelations = input.correlations.filter((c) => c.kind === "HSQC");
  if (hsqcCorrelations.length === 0) {
    return { method: "HSQC", status: "not_evaluated", score: 0, details: [] };
  }

  const details: ValidationDetail[] = [];
  let matchCount = 0;
  let evaluatedCount = 0;

  for (const corr of hsqcCorrelations) {
    const fromPeak = input.peaks.find((p) => p.id === corr.from);
    const toPeak = input.peaks.find((p) => p.id === corr.to);
    const carbonPeak =
      fromPeak?.nucleus === "13C" ? fromPeak : toPeak?.nucleus === "13C" ? toPeak : undefined;
    const protonPeakId =
      fromPeak?.nucleus === "1H" ? corr.from : toPeak?.nucleus === "1H" ? corr.to : undefined;
    if (!carbonPeak || !protonPeakId) {
      details.push({
        status: "not_evaluated",
        summary: `${corr.from} ↔ ${corr.to}: ¹H/¹³Cのペアとして解釈できません`,
      });
      continue;
    }
    const carbonPeakId = carbonPeak.id;

    const carbonAssignment = assignment.byPeakId.get(carbonPeakId);
    if (!carbonAssignment) {
      const bucket = carbonBucketFromShift(carbonPeak.shift);
      const bucketEmpty = !hasProtonatedCarbonInBucket(candidateGraph, bucket);
      if (bucketEmpty) {
        evaluatedCount++;
        details.push({
          status: "mismatch",
          hardConstraint: true,
          summary: `${protonPeakId} ↔ ${carbonPeakId}: 候補構造にはこの¹³Cシフト領域に該当するプロトン化炭素が存在しません`,
        });
      } else {
        details.push({
          status: "not_evaluated",
          summary: `${protonPeakId} ↔ ${carbonPeakId}: 候補構造中に候補となる炭素は複数あり、一意に割当できないため評価できません`,
        });
      }
      continue;
    }

    const atom = candidateGraph.atoms[carbonAssignment.atomIndex];
    const attachedH = atom?.attachedH ?? 0;
    evaluatedCount++;
    if (attachedH > 0) {
      matchCount++;
      details.push({
        status: carbonAssignment.confidence === "low" ? "partial" : "match",
        summary: `${protonPeakId} ↔ ${carbonPeakId}: 割り当てた炭素はH${attachedH}個を持ち、HSQCと矛盾しません`,
      });
    } else if (carbonAssignment.confidence === "high") {
      // 割当が一意(バケット内の候補数が観測ピーク数と一致)の場合のみ、
      // 「この炭素は第四級」という結論を確信でき、ハード制約にできる。
      // 割当が低信頼度(バケット内に複数候補があり位置的に仮決めした)
      // 場合は、別の炭素を指している可能性が残るため除外しない。
      details.push({
        status: "mismatch",
        hardConstraint: true,
        summary: `${protonPeakId} ↔ ${carbonPeakId}: 割り当てた炭素は候補構造では第四級炭素(H非結合)で、HSQCとは矛盾します`,
      });
    } else {
      details.push({
        status: "partial",
        summary: `${protonPeakId} ↔ ${carbonPeakId}: 候補構造中の同シフト領域の炭素には第四級炭素も含まれ、割当が曖昧なため確定的な矛盾とは判定しません`,
      });
    }
  }

  const score = evaluatedCount > 0 ? matchCount / evaluatedCount : 0;
  const status = evaluatedCount === 0 ? "not_evaluated" : score >= 0.8 ? "match" : score >= 0.4 ? "partial" : "mismatch";

  return { method: "HSQC", status, score, details };
}
