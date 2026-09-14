import type { ValidationContext, ValidationDetail, ValidationResult } from "./types";

/**
 * HSQC(¹J, 直接結合)の検証。
 * 「第四級炭素はHSQCに出ない」という常に成り立つ化学的事実を使い、
 * 相関先の¹³Cピークが候補構造で第四級炭素(H非結合)に割り当てられて
 * いないかを確認する。
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
    const carbonPeakId =
      fromPeak?.nucleus === "13C" ? corr.from : toPeak?.nucleus === "13C" ? corr.to : undefined;
    const protonPeakId =
      fromPeak?.nucleus === "1H" ? corr.from : toPeak?.nucleus === "1H" ? corr.to : undefined;
    if (!carbonPeakId || !protonPeakId) {
      details.push({
        status: "not_evaluated",
        summary: `${corr.from} ↔ ${corr.to}: ¹H/¹³Cのペアとして解釈できません`,
      });
      continue;
    }

    const carbonAssignment = assignment.byPeakId.get(carbonPeakId);
    if (!carbonAssignment) {
      details.push({
        status: "not_evaluated",
        summary: `${protonPeakId} ↔ ${carbonPeakId}: 候補構造への割当ができず評価できません`,
      });
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
    } else {
      details.push({
        status: "mismatch",
        summary: `${protonPeakId} ↔ ${carbonPeakId}: 割り当てた炭素は候補構造では第四級炭素(H非結合)で、HSQCとは矛盾します`,
      });
    }
  }

  const score = evaluatedCount > 0 ? matchCount / evaluatedCount : 0;
  const status = evaluatedCount === 0 ? "not_evaluated" : score >= 0.8 ? "match" : score >= 0.4 ? "partial" : "mismatch";

  return { method: "HSQC", status, score, details };
}
