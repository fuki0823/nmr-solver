/**
 * 分子式の元素比による妥当性判定。
 *
 * Kind T., Fiehn O. "Seven Golden Rules for heuristic filtering of molecular
 * formulas obtained by accurate mass spectrometry", BMC Bioinformatics 8:105 (2007)
 * の Rule 4(元素比)に基づく。既知化合物データベースの分布から決められた範囲で、
 *  - common  : 既知化合物の約99.7%が入る範囲
 *  - extended: 約99.99%が入る範囲(これを外れる組成は事実上存在しない)
 * extended を外れる分子式は候補から除外し、common を外れるもの(例: C2H2N4O の
 * N/C = 2)は除外はせず評価を下げる(尿素 CH4N2O のように少数の実在例があるため)。
 */

export type RatioLevel = "common" | "extended" | "implausible";

const RANGES: Record<string, { common: [number, number]; extended: [number, number] }> = {
  H: { common: [0.2, 3.1], extended: [0.1, 6] },
  N: { common: [0, 1.3], extended: [0, 4] },
  O: { common: [0, 1.2], extended: [0, 3] },
  S: { common: [0, 0.8], extended: [0, 3] },
  P: { common: [0, 0.3], extended: [0, 2] },
};

export interface RatioCheck {
  level: RatioLevel;
  /** common範囲を外れた元素比の説明 */
  reasons: string[];
}

export function checkElementRatios(counts: Record<string, number | undefined>): RatioCheck {
  const c = counts.C ?? 0;
  if (c === 0) return { level: "common", reasons: [] };
  let level: RatioLevel = "common";
  const reasons: string[] = [];
  for (const [el, range] of Object.entries(RANGES)) {
    const n = counts[el] ?? 0;
    if (el !== "H" && n === 0) continue;
    const ratio = n / c;
    const [elo, ehi] = range.extended;
    const [clo, chi] = range.common;
    if (ratio < elo || ratio > ehi) {
      level = "implausible";
      reasons.push(`${el}/C = ${ratio.toFixed(2)}(既知化合物ではほぼ見られない範囲 ${elo}–${ehi} の外)`);
    } else if (ratio < clo || ratio > chi) {
      if (level === "common") level = "extended";
      reasons.push(`${el}/C = ${ratio.toFixed(2)}(一般的な範囲 ${clo}–${chi} の外)`);
    }
  }
  return { level, reasons };
}
