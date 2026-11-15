import { expectedProtonRange, inRange, maxBipartiteMatching, type ShiftRange } from "../shiftRanges";
import type { ValidationContext, ValidationDetail, ValidationResult } from "./types";

export function protonValidator(context: ValidationContext): ValidationResult {
  const { input, candidateGraph } = context;
  const peaks = input.peaks.filter((p) => p.nucleus === "1H");
  if (peaks.length === 0) {
    return { method: "1H", status: "not_evaluated", score: 0, details: [] };
  }

  const details: ValidationDetail[] = [];

  // 候補構造の水素を1個ずつ「スロット」として列挙する(どの原子上のHか、
  // そのHが出うるシフト範囲)。
  const slots: ShiftRange[] = [];
  let carbonBoundH = 0;
  let heteroBoundH = 0;
  for (const atom of candidateGraph.atoms) {
    const range = expectedProtonRange(candidateGraph, atom);
    if (!range || !atom.attachedH) continue;
    for (let k = 0; k < atom.attachedH; k++) slots.push(range);
    if (atom.element === "C") carbonBoundH += atom.attachedH;
    else heteroBoundH += atom.attachedH;
  }
  const totalH = carbonBoundH + heteroBoundH;

  // 1. 積分値の合計 vs 候補の水素数。
  // OH/NHは重水交換やブロードニングで観測されないことが多いため、
  // 「炭素上のH数 〜 全H数」の範囲に入っていれば一致とみなす。
  const totalIntegration = peaks.reduce((sum, p) => sum + (p.integration ?? 0), 0);
  let integrationScore = 0.5;
  if (totalIntegration > 0) {
    const tol = Math.max(1, Math.round(totalIntegration * 0.05));
    const diff =
      totalIntegration < carbonBoundH
        ? carbonBoundH - totalIntegration
        : totalIntegration > totalH
          ? totalIntegration - totalH
          : 0;
    integrationScore = diff <= tol ? 1 : Math.max(0, 1 - (diff - tol) / Math.max(totalH, 1));
    details.push({
      status: diff === 0 ? "match" : diff <= tol ? "partial" : "mismatch",
      summary:
        heteroBoundH > 0
          ? `積分値の合計: 入力${totalIntegration}H / 候補は炭素上${carbonBoundH}H + OH・NH等${heteroBoundH}H(OH・NHは観測されなくてもよいとして判定)`
          : `積分値の合計: 入力${totalIntegration}H / 候補の総水素数${totalH}H`,
    });
  }

  // 2. 化学シフトの整合性。積分値の分だけ「Hの単位」に展開し、範囲内の
  // 水素スロットへ1対1で割り当てる(詳細は shiftRanges.ts)。
  const units: number[] = [];
  for (const p of peaks) {
    const n = Math.max(1, Math.round(p.integration ?? 1));
    for (let k = 0; k < n; k++) units.push(p.shift);
  }
  const matchLeft = maxBipartiteMatching(units.length, slots.length, (i, j) =>
    inRange(units[i], slots[j]),
  );
  const unmatchedShifts = Array.from(
    new Set(units.filter((_, i) => matchLeft[i] < 0)),
  ).sort((a, b) => b - a);
  const matchedUnits = matchLeft.filter((j) => j >= 0).length;
  const shiftScore = units.length > 0 ? matchedUnits / units.length : 0;
  details.push({
    status:
      matchedUnits === units.length ? "match" : units.length - matchedUnits <= 1 ? "partial" : "mismatch",
    summary:
      matchedUnits === units.length
        ? `¹H化学シフト: ${units.length}H分すべてを、局所構造から見て矛盾のない水素に割り当てられます`
        : `¹H化学シフト: ${units.length}H分中${matchedUnits}H分を割り当て可能。割り当て先のないピーク: ${unmatchedShifts
            .slice(0, 6)
            .map((s) => `δ${s}`)
            .join(", ")}${unmatchedShifts.length > 6 ? " ほか" : ""}`,
  });

  const score = (integrationScore + shiftScore) / 2;
  const status = score >= 0.8 ? "match" : score >= 0.4 ? "partial" : "mismatch";

  return { method: "1H", status, score, details };
}
