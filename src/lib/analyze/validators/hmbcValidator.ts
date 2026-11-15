import { carbonsFor, nJ, peakById, protonHostsWithHsqc, shiftModel } from "./twoDHelpers";
import type { ValidationContext, ValidationDetail, ValidationResult } from "./types";

/** allowedBondDistances未指定時のデフォルト(典型的な2-3結合) */
const DEFAULT_ALLOWED_BOND_DISTANCES = [2, 3];

/**
 * HMBC(主に²JCH/³JCH)の検証。特定のピーク割当を仮定しない。
 *
 * 相関 δH → δC は、「δHを持ちうるHの原子X(HSQCがあればその炭素に限定)」と
 * 「δCになりうる炭素Y」の組で、H–X…Y の結合数 nJCH が許容範囲(既定2–3)に
 * 入るものがあれば説明できるとする。
 *  - 許容範囲内の組がある → 1点
 *  - 許容範囲±1(⁴JCH、¹JCHの漏れ込み等)の組だけがある → 0.4点
 *  - ハード制約: 範囲を広げても、⁴JCH以内で説明できる組が1つも無い
 * 観測されなかった相関は評価しない。
 */
export function hmbcValidator(context: ValidationContext): ValidationResult {
  const { input, candidateGraph } = context;
  const correlations = input.correlations.filter((c) => c.kind === "HMBC");
  if (correlations.length === 0) return { method: "HMBC", status: "not_evaluated", score: 0, details: [] };

  const model = shiftModel(candidateGraph);
  const details: ValidationDetail[] = [];
  let scoreSum = 0;
  let evaluated = 0;

  for (const corr of correlations) {
    const a = peakById(input, corr.from);
    const b = peakById(input, corr.to);
    const h = a?.nucleus === "1H" ? a : b?.nucleus === "1H" ? b : undefined;
    const c = a?.nucleus === "13C" ? a : b?.nucleus === "13C" ? b : undefined;
    if (!h || !c) {
      details.push({ status: "not_evaluated", summary: `${corr.from} → ${corr.to}: ¹H/¹³Cのペアとして解釈できません` });
      continue;
    }
    evaluated++;
    const allowed = corr.allowedBondDistances ?? DEFAULT_ALLOWED_BOND_DISTANCES;
    const lo = Math.min(...allowed);
    const hi = Math.max(...allowed);

    const best = (wide: boolean) => {
      let bestN = Infinity;
      let inAllowed = false;
      for (const x of protonHostsWithHsqc(model, input, h, wide)) {
        for (const y of carbonsFor(model, c.shift, { widen: wide })) {
          if (x === y) continue;
          const n = nJ(model, x, y);
          if (allowed.includes(n)) inAllowed = true;
          const dist = n < lo ? lo - n : n > hi ? n - hi : 0;
          bestN = Math.min(bestN, dist);
        }
      }
      return { inAllowed, offBy: bestN };
    };

    const strict = best(false);
    const label = `${h.id}(δ${h.shift}) → ${c.id}(δ${c.shift})`;
    if (strict.inAllowed) {
      scoreSum += 1;
      continue;
    }
    if (strict.offBy === 1) {
      scoreSum += 0.4;
      details.push({ status: "partial", summary: `${label}: ${lo}–${hi}結合では説明できず、${hi + 1}JCH等(稀に観測される範囲)でのみ説明できます` });
      continue;
    }
    const wide = best(true);
    if (wide.inAllowed || wide.offBy <= 1) {
      scoreSum += 0.2;
      details.push({ status: "partial", summary: `${label}: 典型的なシフト範囲から外れる原子を仮定した場合にのみ説明できます` });
    } else {
      details.push({
        status: "mismatch",
        hardConstraint: true,
        summary: `${label}: このHとこの炭素を${hi + 1}結合以内で結ぶ組み合わせが候補構造にありません`,
      });
    }
  }

  const score = evaluated > 0 ? scoreSum / evaluated : 0;
  details.unshift({
    status: score >= 0.999 ? "match" : score >= 0.6 ? "partial" : "mismatch",
    summary: `HMBC: ${evaluated}件中${Math.round(scoreSum * 10) / 10}件分を、候補構造の2–3結合(相関ごとの指定があればその範囲)で説明できます`,
  });
  const status = evaluated === 0 ? "not_evaluated" : score >= 0.8 ? "match" : score >= 0.4 ? "partial" : "mismatch";
  return { method: "HMBC", status, score, details };
}
