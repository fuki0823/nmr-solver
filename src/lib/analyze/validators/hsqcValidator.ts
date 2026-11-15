import { maxBipartiteMatching } from "../shiftRanges";
import { hsqcExplains, peakById, shiftModel } from "./twoDHelpers";
import type { ValidationContext, ValidationDetail, ValidationResult } from "./types";

/**
 * HSQC(¹JCH、直接結合)の検証。特定のピーク割当を仮定しない。
 *
 * 各相関(¹H δH ↔ ¹³C δC)は「Hを持つ炭素で、炭素のシフト範囲にδCが入り、
 * その炭素上のHのシフト範囲にδHが入る」原子で説明できなければならない。
 *
 *  - ハード制約: 範囲を広げても(¹³C ±8 ppm、¹H ±0.8 ppm)説明できる炭素が
 *    1つも無い相関。構造中にその環境のCHが存在しないことを意味する。
 *  - ソフトスコア: HSQCで相関している¹³Cピーク(異なるピークは異なる炭素)を、
 *    すべて同時に別々のCH炭素へ割り当てられる割合(2部グラフの最大マッチング)。
 * 観測されなかった相関は評価しない。
 */
export function hsqcValidator(context: ValidationContext): ValidationResult {
  const { input, candidateGraph } = context;
  const pairs = input.correlations
    .filter((c) => c.kind === "HSQC")
    .map((c) => {
      const a = peakById(input, c.from);
      const b = peakById(input, c.to);
      const h = a?.nucleus === "1H" ? a : b?.nucleus === "1H" ? b : undefined;
      const cp = a?.nucleus === "13C" ? a : b?.nucleus === "13C" ? b : undefined;
      return { corr: c, h, c: cp };
    });
  if (pairs.length === 0) return { method: "HSQC", status: "not_evaluated", score: 0, details: [] };

  const model = shiftModel(candidateGraph);
  const atoms = candidateGraph.atoms.map((_, i) => i);
  const details: ValidationDetail[] = [];
  const valid = pairs.filter((p) => p.h && p.c);

  for (const p of pairs) {
    if (!p.h || !p.c) {
      details.push({ status: "not_evaluated", summary: `${p.corr.from} ↔ ${p.corr.to}: ¹H/¹³Cのペアとして解釈できません` });
      continue;
    }
    const strict = atoms.filter((i) => hsqcExplains(model, i, p.h!.shift, p.c!.shift));
    if (strict.length > 0) continue;
    const wide = atoms.filter((i) => hsqcExplains(model, i, p.h!.shift, p.c!.shift, true));
    details.push(
      wide.length === 0
        ? {
            status: "mismatch",
            hardConstraint: true,
            summary: `${p.h.id}(δ${p.h.shift}) ↔ ${p.c.id}(δ${p.c.shift}): この組み合わせのCH(炭素・水素ともこのシフトになりうるHを持つ炭素)が候補構造に存在しません`,
          }
        : {
            status: "partial",
            summary: `${p.h.id}(δ${p.h.shift}) ↔ ${p.c.id}(δ${p.c.shift}): 典型的な範囲から少し外れるCHでのみ説明できます`,
          },
    );
  }

  // 同時に成り立つか: HSQCで相関する¹³Cピーク(重複除去)→ CH炭素 の最大マッチング
  const carbonPeaks = [...new Map(valid.map((p) => [p.c!.id, p])).values()];
  const match = maxBipartiteMatching(carbonPeaks.length, atoms.length, (i, j) => {
    const p = carbonPeaks[i];
    // 同じ¹³Cピークに複数の¹H(ジアステレオトピックなCH2等)がある場合は、すべて説明できること
    return valid.filter((q) => q.c!.id === p.c!.id).every((q) => hsqcExplains(model, j, q.h!.shift, q.c!.shift));
  });
  const matched = match.filter((j) => j >= 0).length;
  const score = carbonPeaks.length > 0 ? matched / carbonPeaks.length : 0;
  details.unshift({
    status: matched === carbonPeaks.length ? "match" : carbonPeaks.length - matched <= 1 ? "partial" : "mismatch",
    summary: `HSQC: 相関のある¹³C ${carbonPeaks.length}本中${matched}本を、同時に別々のCH炭素(シフト範囲が合うもの)へ割り当てられます`,
  });

  const status = score >= 0.8 ? "match" : score >= 0.4 ? "partial" : "mismatch";
  return { method: "HSQC", status, score, details };
}
