import { bondDistance } from "../../moleculeGraph";
import type { ValidationContext, ValidationDetail, ValidationResult } from "./types";

/**
 * HMBC(主に2JCH/3JCH)の検証。
 *
 * 割当済みの「プロトンが結合している炭素」から「対象炭素」までの結合数
 * (炭素-炭素間のbond distance)を求め、そこに+1して初めてH起点のnJCH
 * (プロトンから対象炭素までの結合数)になる点に注意(例: プロトンの
 * 属する炭素と対象炭素が直接結合=炭素間距離1 の場合、H-C-C'で2JCHになる)。
 *
 * nJCH=2,3ならmatch、1や4はしばしば観測されうるためpartial、それ以上
 * 離れている場合のみmismatchとする。実際のHMBCは理論上の相関が必ずしも
 * 全て観測されるわけではないため、「観測されない/一致しない = 構造が
 * 間違い」と断定する表現はしない(「この候補構造とは整合しません」に
 * 留める)。
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
    const protonPeakId =
      fromPeak?.nucleus === "1H" ? corr.from : toPeak?.nucleus === "1H" ? corr.to : undefined;
    const carbonPeakId =
      fromPeak?.nucleus === "13C" ? corr.from : toPeak?.nucleus === "13C" ? corr.to : undefined;
    if (!protonPeakId || !carbonPeakId) {
      details.push({
        status: "not_evaluated",
        summary: `${corr.from} → ${corr.to}: ¹H/¹³Cのペアとして解釈できません`,
      });
      continue;
    }

    const protonAssignment = assignment.byPeakId.get(protonPeakId);
    const carbonAssignment = assignment.byPeakId.get(carbonPeakId);
    if (!protonAssignment || !carbonAssignment) {
      details.push({
        status: "not_evaluated",
        summary: `${protonPeakId} → ${carbonPeakId}: 候補構造への割当ができず評価できません`,
      });
      continue;
    }

    const carbonToCarbonDistance = bondDistance(
      candidateGraph,
      protonAssignment.atomIndex,
      carbonAssignment.atomIndex,
    );
    // H-C(自分の炭素)-...-C(対象炭素) なので、nJCH = 炭素間距離 + 1
    const nJCH = carbonToCarbonDistance === null ? null : carbonToCarbonDistance + 1;
    const lowConfidence =
      protonAssignment.confidence === "low" || carbonAssignment.confidence === "low";
    evaluatedCount++;

    if (nJCH === 2 || nJCH === 3) {
      matchScore += 1;
      details.push({
        status: lowConfidence ? "partial" : "match",
        summary: `${protonPeakId} → ${carbonPeakId}: ${nJCH}JCH相当(2-3結合の範囲内)`,
      });
    } else if (nJCH === 1 || nJCH === 4) {
      matchScore += 0.4;
      details.push({
        status: "partial",
        summary: `${protonPeakId} → ${carbonPeakId}: ${nJCH}JCH相当(HMBCとして典型的な2-3結合からは外れますが、稀に観測されうる範囲です)`,
      });
    } else {
      details.push({
        status: "mismatch",
        summary: `${protonPeakId} → ${carbonPeakId}: ${nJCH ? `${nJCH}JCH相当` : "到達不能"}で、この候補構造とは整合しません`,
      });
    }
  }

  const score = evaluatedCount > 0 ? matchScore / evaluatedCount : 0;
  const status = evaluatedCount === 0 ? "not_evaluated" : score >= 0.8 ? "match" : score >= 0.4 ? "partial" : "mismatch";

  return { method: "HMBC", status, score, details };
}
