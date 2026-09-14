import { bondDistance } from "../../moleculeGraph";
import type { ValidationContext, ValidationDetail, ValidationResult } from "./types";

/**
 * COSY(主に³J vicinal coupling)の検証。
 * 各相関について、入力ピークを候補構造の原子へ割り当てた結果(assignment)を
 * もとに、対応する炭素同士が直接結合しているか(bond distance = 1)を見る。
 * 割当の確信度が低い場合は断定を避け "partial" までに留める。
 */
export function cosyValidator(context: ValidationContext): ValidationResult {
  const { input, candidateGraph, assignment } = context;
  const cosyCorrelations = input.correlations.filter((c) => c.kind === "COSY");
  if (cosyCorrelations.length === 0) {
    return { method: "COSY", status: "not_evaluated", score: 0, details: [] };
  }

  const details: ValidationDetail[] = [];
  let matchCount = 0;
  let evaluatedCount = 0;

  for (const corr of cosyCorrelations) {
    const a = assignment.byPeakId.get(corr.from);
    const b = assignment.byPeakId.get(corr.to);
    if (!a || !b) {
      details.push({
        status: "not_evaluated",
        summary: `${corr.from} ↔ ${corr.to}: 候補構造への割当ができず評価できません`,
      });
      continue;
    }
    const distance = bondDistance(candidateGraph, a.atomIndex, b.atomIndex);
    const lowConfidence = a.confidence === "low" || b.confidence === "low";
    evaluatedCount++;
    if (distance === 1) {
      matchCount++;
      details.push({
        status: lowConfidence ? "partial" : "match",
        summary: `${corr.from} ↔ ${corr.to}: 候補構造で隣接する炭素同士に割当可能`,
      });
    } else {
      details.push({
        status: lowConfidence ? "partial" : "mismatch",
        summary: `${corr.from} ↔ ${corr.to}: 割り当てた炭素同士が隣接していません(結合数${distance ?? "不明"})`,
      });
    }
  }

  const score = evaluatedCount > 0 ? matchCount / evaluatedCount : 0;
  const status = evaluatedCount === 0 ? "not_evaluated" : score >= 0.8 ? "match" : score >= 0.4 ? "partial" : "mismatch";

  return { method: "COSY", status, score, details };
}
