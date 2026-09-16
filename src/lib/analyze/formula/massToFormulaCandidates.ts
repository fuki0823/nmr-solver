/**
 * 質量(MS)から分子式候補を生成するモジュール。完全にrule-based(AI不使用)。
 *
 * 手法: C/H/N/O/Sの妥当な範囲を総当たりし、
 *  - 目標質量との誤差が許容範囲内
 *  - DBE(不飽和度) = C - H/2 + N/2 + 1 が0以上の整数
 * を満たす組み合わせのみを候補として返す(質量分析の分子式決定で広く
 * 使われる古典的な手法の簡易版。DFTによるshift予測等とは無関係)。
 */

const MONOISOTOPIC_MASS = {
  H: 1.007825,
  C: 12.0,
  N: 14.003074,
  O: 15.994915,
  S: 31.972071,
} as const;

// 一般的な有機小分子・天然物を想定した既定の探索範囲。
export interface FormulaSearchBounds {
  maxCarbon: number;
  maxNitrogen: number;
  maxOxygen: number;
  maxSulfur: number;
}

export const DEFAULT_FORMULA_SEARCH_BOUNDS: FormulaSearchBounds = {
  maxCarbon: 60,
  maxNitrogen: 8,
  maxOxygen: 20,
  maxSulfur: 4,
};

export interface FormulaCandidate {
  formula: string;
  counts: { C: number; H: number; N: number; O: number; S: number };
  exactMass: number;
  massErrorPpm: number;
  degreeOfUnsaturation: number;
}

/** 一般的なESI/APCIアダクトの質量差(neutral = measuredMz - delta) */
export const ADDUCT_MASS_DELTA: Record<string, number> = {
  "[M+H]+": 1.007276,
  "[M+Na]+": 22.989770,
  "[M+K]+": 38.963708,
  "[M+NH4]+": 18.033823,
  "[M-H]-": -1.007276,
  "[M+Cl]-": 34.968853 + 0.000549, // Cl- 相当(電子質量分は簡略化のため無視)
  "[M]+": 0,
  "[M]-": 0,
};

/** 測定m/zとアダクトから、中性分子のexact massを逆算する */
export function neutralMassFromAdduct(
  measuredMz: number,
  ionAdduct: string,
): number | null {
  const delta = ADDUCT_MASS_DELTA[ionAdduct];
  if (delta === undefined) return null;
  return measuredMz - delta;
}

export interface MassTolerance {
  /** ppm指定(HRMS向け)。既定10ppm */
  ppm?: number;
  /**
   * 絶対値(Da)指定(単位質量分解能の低分解能MS向け)。指定時はppmより
   * 優先される。質量が大きいほどppm換算では狭くなるが、絶対値としては
   * 一定のため、低分解能機器の実際の精度に近い挙動になる。
   */
  da?: number;
}

export function generateFormulaCandidates(
  targetMass: number,
  tolerance: MassTolerance | number = { ppm: 10 },
  bounds: FormulaSearchBounds = DEFAULT_FORMULA_SEARCH_BOUNDS,
): FormulaCandidate[] {
  const spec: MassTolerance = typeof tolerance === "number" ? { ppm: tolerance } : tolerance;
  const toleranceDa =
    spec.da != null ? spec.da : Math.max((targetMass * (spec.ppm ?? 10)) / 1e6, 0.003);
  const results: FormulaCandidate[] = [];
  const maxC = Math.min(bounds.maxCarbon, Math.floor(targetMass / MONOISOTOPIC_MASS.C) + 1);

  for (let c = 1; c <= maxC; c++) {
    const massC = c * MONOISOTOPIC_MASS.C;
    if (massC - toleranceDa > targetMass) break;

    for (let n = 0; n <= bounds.maxNitrogen; n++) {
      const massCN = massC + n * MONOISOTOPIC_MASS.N;
      if (massCN - toleranceDa > targetMass) break;

      for (let o = 0; o <= bounds.maxOxygen; o++) {
        const massCNO = massCN + o * MONOISOTOPIC_MASS.O;
        if (massCNO - toleranceDa > targetMass) break;

        for (let s = 0; s <= bounds.maxSulfur; s++) {
          const massWithoutH = massCNO + s * MONOISOTOPIC_MASS.S;
          const remainingForH = targetMass - massWithoutH;
          if (remainingForH < -toleranceDa) break;

          const h = Math.round(remainingForH / MONOISOTOPIC_MASS.H);
          if (h < 0) continue;

          const exactMass = massWithoutH + h * MONOISOTOPIC_MASS.H;
          const massError = exactMass - targetMass;
          if (Math.abs(massError) > toleranceDa) continue;

          const dbe = c - h / 2 + n / 2 + 1;
          if (!Number.isInteger(dbe) || dbe < 0) continue;
          // 極端に大きい/小さいDBEは非現実的な組成として除外
          if (dbe > c + n + 1) continue;

          results.push({
            formula: formatFormula({ C: c, H: h, N: n, O: o, S: s }),
            counts: { C: c, H: h, N: n, O: o, S: s },
            exactMass: Math.round(exactMass * 10000) / 10000,
            massErrorPpm: Math.round((massError / targetMass) * 1e6 * 100) / 100,
            degreeOfUnsaturation: dbe,
          });
        }
      }
    }
  }

  return results.sort(
    (a, b) => Math.abs(a.massErrorPpm) - Math.abs(b.massErrorPpm),
  );
}

function formatFormula(counts: Record<string, number>): string {
  const order = ["C", "H", "N", "O", "S"];
  const parts: string[] = [];
  for (const el of order) {
    const n = counts[el] ?? 0;
    if (n <= 0) continue;
    parts.push(n === 1 ? el : `${el}${n}`);
  }
  return parts.join("");
}
