import { bondDistance } from "../../moleculeGraph";
import {
  carbonBucketFromShift,
  hasCarbonInBucket,
  hasProtonatedCarbonForProtonBucket,
  protonBucketFromShift,
} from "../chemicalEnvironment";
import type { ValidationContext, ValidationDetail, ValidationResult } from "./types";

/** allowedBondDistances未指定時のデフォルト(典型的な2-3結合) */
const DEFAULT_ALLOWED_BOND_DISTANCES = [2, 3];

/**
 * HMBC(主に2JCH/3JCH)の検証。
 *
 * 割当済みの「プロトンが結合している炭素」から「対象炭素」までの結合数
 * (炭素-炭素間のbond distance)を求め、そこに+1して初めてH起点のnJCH
 * (プロトンから対象炭素までの結合数)になる点に注意(例: プロトンの
 * 属する炭素と対象炭素が直接結合=炭素間距離1 の場合、H-C-C'で2JCHになる)。
 *
 * 許容するnJCHは相関ごとに `allowedBondDistances` で指定可能(未指定時は
 * [2,3])。範囲のすぐ外側(min-1 / max+1)は稀に観測されるためsoftに
 * partial扱いとする。
 *
 * ハード制約として扱うのは、以下の「候補構造として原理的にあり得ない」
 * ケースのみ:
 *   (a) 相関の一方または両方に対応する炭素/プロトン化炭素が候補中に
 *       1つも存在しない(割当の曖昧さではなく構造上存在しない)
 *   (b) 両端とも高信頼度で一意に割当できているにもかかわらず、
 *       nJCHが許容範囲から明確に(±1の猶予を超えて)外れている
 * 「観測されるはずの相関が観測されなかった」ことは一切評価しない
 * (このバリデータは observed な相関のみを走査する)。また、割当の
 * 確信度が低い場合はハード制約にしない(曖昧=除外しない)。
 */
export function hmbcValidator(context: ValidationContext): ValidationResult {
  const { input, candidateGraph, assignment } = context;
  const hmbcCorrelations = input.correlations.filter((c) => c.kind === "HMBC");
  if (hmbcCorrelations.length === 0) {
    return { method: "HMBC", status: "not_evaluated", score: 0, details: [] };
  }

  const details: ValidationDetail[] = [];
  let matchScore = 0;
  let evaluatedCount = 0;

  for (const corr of hmbcCorrelations) {
    const fromPeak = input.peaks.find((p) => p.id === corr.from);
    const toPeak = input.peaks.find((p) => p.id === corr.to);
    const protonPeak =
      fromPeak?.nucleus === "1H" ? fromPeak : toPeak?.nucleus === "1H" ? toPeak : undefined;
    const carbonPeak =
      fromPeak?.nucleus === "13C" ? fromPeak : toPeak?.nucleus === "13C" ? toPeak : undefined;
    if (!protonPeak || !carbonPeak) {
      details.push({
        status: "not_evaluated",
        summary: `${corr.from} → ${corr.to}: ¹H/¹³Cのペアとして解釈できません`,
      });
      continue;
    }
    const protonPeakId = protonPeak.id;
    const carbonPeakId = carbonPeak.id;

    const protonAssignment = assignment.byPeakId.get(protonPeakId);
    const carbonAssignment = assignment.byPeakId.get(carbonPeakId);
    if (!protonAssignment || !carbonAssignment) {
      // 割当できなかった側が、候補構造中に該当する炭素環境自体を
      // 一つも持たないかを確認する。「複数候補があって一意に決まらない」
      // のと「そもそも存在しない」のを区別するため。
      let bucketEmpty = false;
      let emptySide = "";
      if (!protonAssignment) {
        const targetBucket = protonBucketFromShift(protonPeak.shift);
        if (!hasProtonatedCarbonForProtonBucket(candidateGraph, targetBucket)) {
          bucketEmpty = true;
          emptySide = `${protonPeakId}(該当するプロトン化炭素)`;
        }
      }
      if (!bucketEmpty && !carbonAssignment) {
        const bucket = carbonBucketFromShift(carbonPeak.shift);
        if (!hasCarbonInBucket(candidateGraph, bucket)) {
          bucketEmpty = true;
          emptySide = `${carbonPeakId}(該当する炭素)`;
        }
      }
      evaluatedCount += bucketEmpty ? 1 : 0;
      details.push(
        bucketEmpty
          ? {
              status: "mismatch",
              hardConstraint: true,
              summary: `${protonPeakId} → ${carbonPeakId}: 候補構造には${emptySide}が存在しません`,
            }
          : {
              status: "not_evaluated",
              summary: `${protonPeakId} → ${carbonPeakId}: 候補構造中に候補が複数あり、一意に割当できないため評価できません`,
            },
      );
      continue;
    }

    const carbonToCarbonDistance = bondDistance(
      candidateGraph,
      protonAssignment.atomIndex,
      carbonAssignment.atomIndex,
    );
    // H-C(自分の炭素)-...-C(対象炭素) なので、nJCH = 炭素間距離 + 1
    const nJCH = carbonToCarbonDistance === null ? null : carbonToCarbonDistance + 1;
    const highConfidence =
      protonAssignment.confidence === "high" && carbonAssignment.confidence === "high";
    const allowed = corr.allowedBondDistances ?? DEFAULT_ALLOWED_BOND_DISTANCES;
    const minAllowed = Math.min(...allowed);
    const maxAllowed = Math.max(...allowed);
    evaluatedCount++;

    if (nJCH !== null && allowed.includes(nJCH)) {
      matchScore += 1;
      details.push({
        status: highConfidence ? "match" : "partial",
        summary: `${protonPeakId} → ${carbonPeakId}: ${nJCH}JCH相当(許容範囲[${allowed.join(",")}]内)`,
      });
    } else if (nJCH !== null && (nJCH === minAllowed - 1 || nJCH === maxAllowed + 1)) {
      matchScore += 0.4;
      details.push({
        status: "partial",
        summary: `${protonPeakId} → ${carbonPeakId}: ${nJCH}JCH相当(許容範囲[${allowed.join(",")}]からは外れますが、稀に観測されうる範囲です)`,
      });
    } else if (highConfidence) {
      // 両端とも一意に割当できており、かつ許容範囲から明確に外れている
      // 場合のみハード制約とする。
      details.push({
        status: "mismatch",
        hardConstraint: true,
        summary: `${protonPeakId} → ${carbonPeakId}: ${nJCH !== null ? `${nJCH}JCH相当` : "到達不能"}で、許容範囲[${allowed.join(",")}]から大きく外れており、この候補構造とは整合しません`,
      });
    } else {
      details.push({
        status: "mismatch",
        summary: `${protonPeakId} → ${carbonPeakId}: ${nJCH !== null ? `${nJCH}JCH相当` : "到達不能"}で、この候補構造とは整合しません(割当の確信度が低いため確定的な矛盾とはしません)`,
      });
    }
  }

  const score = evaluatedCount > 0 ? matchScore / evaluatedCount : 0;
  const status = evaluatedCount === 0 ? "not_evaluated" : score >= 0.8 ? "match" : score >= 0.4 ? "partial" : "mismatch";

  return { method: "HMBC", status, score, details };
}
