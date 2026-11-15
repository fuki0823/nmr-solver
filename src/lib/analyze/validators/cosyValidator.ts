import { peakById, protonHostsWithHsqc, shiftModel } from "./twoDHelpers";
import type { ValidationContext, ValidationDetail, ValidationResult } from "./types";

/**
 * COSY(主に³JHH vicinal、²JHH geminal)の検証。特定のピーク割当を仮定しない。
 *
 * 相関 δH1 ↔ δH2 は、δH1・δH2を持ちうるHの原子A・B(HSQCがあればその炭素に
 * 限定)で、次のいずれかを満たす組があれば説明できるとする。
 *  - AとBが直接結合している(H–A–B–H、³J)
 *  - A=B かつAにHが2個以上ある(ジアステレオトピックなCH2の²J)
 * AとBが2結合離れている組(⁴J、アリル位・W型等)だけなら部分点(0.4)。
 * COSYは測定条件で見え方が大きく変わるため、ハード制約にはしない。
 */
export function cosyValidator(context: ValidationContext): ValidationResult {
  const { input, candidateGraph } = context;
  const correlations = input.correlations.filter((c) => c.kind === "COSY");
  if (correlations.length === 0) return { method: "COSY", status: "not_evaluated", score: 0, details: [] };

  const model = shiftModel(candidateGraph);
  const details: ValidationDetail[] = [];
  let scoreSum = 0;
  let evaluated = 0;

  for (const corr of correlations) {
    const p1 = peakById(input, corr.from);
    const p2 = peakById(input, corr.to);
    if (p1?.nucleus !== "1H" || p2?.nucleus !== "1H") {
      details.push({ status: "not_evaluated", summary: `${corr.from} ↔ ${corr.to}: ¹H同士のペアとして解釈できません` });
      continue;
    }
    evaluated++;
    const hostsA = protonHostsWithHsqc(model, input, p1);
    const hostsB = protonHostsWithHsqc(model, input, p2);
    let best = 0;
    for (const a of hostsA) {
      for (const b of hostsB) {
        const d = model.distance[a][b];
        if (d === 1 || (a === b && (candidateGraph.atoms[a].attachedH ?? 0) >= 2 && p1.id !== p2.id)) {
          best = 1;
          break;
        }
        if (d === 2) best = Math.max(best, 0.4);
      }
      if (best === 1) break;
    }
    scoreSum += best;
    const label = `${p1.id}(δ${p1.shift}) ↔ ${p2.id}(δ${p2.shift})`;
    if (best < 1) {
      details.push(
        best > 0
          ? { status: "partial", summary: `${label}: ³Jでは説明できず、⁴J(アリル位・W型等)でのみ説明できます` }
          : { status: "mismatch", summary: `${label}: 隣接する(または同じ)炭素上のHの組として説明できません` },
      );
    }
  }

  const score = evaluated > 0 ? scoreSum / evaluated : 0;
  details.unshift({
    status: score >= 0.999 ? "match" : score >= 0.6 ? "partial" : "mismatch",
    summary: `COSY: ${evaluated}件中${Math.round(scoreSum * 10) / 10}件分を、隣接する炭素上のH(³J)等で説明できます`,
  });
  const status = evaluated === 0 ? "not_evaluated" : score >= 0.8 ? "match" : score >= 0.4 ? "partial" : "mismatch";
  return { method: "COSY", status, score, details };
}
