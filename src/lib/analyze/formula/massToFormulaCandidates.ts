/**
 * 質量(MS)から分子式候補を生成するモジュール。完全にrule-based(AI不使用)。
 *
 * 手法: C/H と、指定された元素(既定 N/O/S。Cl/Br/F/I/P はユーザーが指定した場合のみ)の
 * 妥当な範囲を総当たりし、
 *  - 目標質量との誤差が許容範囲内
 *  - 不飽和度 DBE = C + 1 + (N + P − H − ハロゲン)/2 が0以上の整数
 *  - 元素比が既知化合物の範囲内(Seven Golden Rules)
 * を満たす組み合わせのみを候補として返す。H の数は残りの質量から決める。
 */

import { checkElementRatios } from "./elementRatios";

const MONOISOTOPIC_MASS: Record<string, number> = {
  H: 1.007825,
  C: 12.0,
  N: 14.003074,
  O: 15.994915,
  S: 31.972071,
  P: 30.973762,
  F: 18.998403,
  Cl: 34.968853,
  Br: 78.918338,
  I: 126.904473,
};

/**
 * 平均原子量(IUPAC標準原子量の慣用値)。カタログやPubChemの
 * "Molecular Weight"(例: ダウノルビシン 527.52)は平均分子量のため、
 * 分子量しか分からない場合はこちらで分子式を探索する。
 */
const AVERAGE_MASS: Record<string, number> = {
  H: 1.008,
  C: 12.011,
  N: 14.007,
  O: 15.999,
  S: 32.06,
  P: 30.974,
  F: 18.998,
  Cl: 35.45,
  Br: 79.904,
  I: 126.904,
};

export type MassKind = "monoisotopic" | "average";

/** H 以外で探索する元素の上限(質量でさらに打ち切る) */
const MAX_COUNT: Record<string, number> = {
  N: 15,
  O: 40,
  S: 4,
  P: 3,
  F: 10,
  Cl: 6,
  Br: 4,
  I: 4,
};

/** 既定で探索する元素(C・H 以外)。ハロゲンとリンは指定があった場合だけ探索する */
export const DEFAULT_ELEMENTS = ["N", "O", "S"] as const;
/** 指定できる追加の元素 */
export const OPTIONAL_ELEMENTS = ["Cl", "Br", "F", "I", "P"] as const;

const HALOGENS = new Set(["F", "Cl", "Br", "I"]);

export interface FormulaSearchBounds {
  /** 炭素数の下限(¹³C のピーク数が分かっていればその数。既定 1) */
  minCarbon?: number;
  /** 炭素数の上限(既定 150。バンコマイシン C66 などの大きな天然物を含める) */
  maxCarbon?: number;
  /** C・H 以外に探索する元素(既定 N, O, S) */
  elements?: readonly string[];
}

export interface FormulaCandidate {
  formula: string;
  /** 元素ごとの個数(含まれない元素は 0 またはキーなし) */
  counts: Record<string, number>;
  exactMass: number;
  massErrorPpm: number;
  degreeOfUnsaturation: number;
}

/** 一般的なESI/APCIアダクトの質量差(neutral = measuredMz - delta) */
/** 電子の質量(Da)。イオンの m/z は、付加・脱離した原子の質量から電子の出入りを補正する */
const ELECTRON_MASS = 0.000549;

/**
 * 一般的なESI/APCIアダクトの質量差(neutral = measuredMz - delta)。
 * 陽イオンは電子を1個失い、陰イオンは1個得るので、原子の質量に ∓電子質量 を補正する
 * (例: Na+ = Na原子 22.989770 − 0.000549)。分子量800付近で約0.7 ppmの差になる。
 */
export const ADDUCT_MASS_DELTA: Record<string, number> = {
  "[M+H]+": 1.007825 - ELECTRON_MASS, // プロトン 1.007276
  "[M+Na]+": 22.98977 - ELECTRON_MASS,
  "[M+K]+": 38.963707 - ELECTRON_MASS,
  "[M+NH4]+": 14.003074 + 4 * 1.007825 - ELECTRON_MASS,
  "[M-H]-": -1.007825 + ELECTRON_MASS,
  "[M+Cl]-": 34.968853 + ELECTRON_MASS,
  "[M+HCOO]-": 12.0 + 1.007825 + 2 * 15.994915 + ELECTRON_MASS,
  "[M]+": -ELECTRON_MASS,
  "[M]-": ELECTRON_MASS,
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
  bounds: FormulaSearchBounds = {},
  massKind: MassKind = "monoisotopic",
): FormulaCandidate[] {
  const MASS = massKind === "average" ? AVERAGE_MASS : MONOISOTOPIC_MASS;
  const spec: MassTolerance = typeof tolerance === "number" ? { ppm: tolerance } : tolerance;
  const toleranceDa =
    spec.da != null ? spec.da : Math.max((targetMass * (spec.ppm ?? 10)) / 1e6, 0.003);
  const elements = [...new Set(bounds.elements ?? DEFAULT_ELEMENTS)].filter((e) => MASS[e] != null && e !== "C" && e !== "H");
  // 重い元素から先に回すと、質量による打ち切りが早く効く
  elements.sort((a, b) => MASS[b] - MASS[a]);
  const minC = Math.max(1, bounds.minCarbon ?? 1);
  const maxC = Math.min(bounds.maxCarbon ?? 150, Math.floor(targetMass / MASS.C) + 1);
  const results: FormulaCandidate[] = [];
  const counts: Record<string, number> = {};

  const finish = (massWithoutH: number) => {
    const remainingForH = targetMass - massWithoutH;
    if (remainingForH < -toleranceDa) return;
    const h = Math.round(remainingForH / MASS.H);
    if (h < 0) return;
    const exactMass = massWithoutH + h * MASS.H;
    const massError = exactMass - targetMass;
    if (Math.abs(massError) > toleranceDa) return;
    const c = counts.C;
    const n = counts.N ?? 0;
    const p = counts.P ?? 0;
    const x = elements.filter((e) => HALOGENS.has(e)).reduce((sum, e) => sum + (counts[e] ?? 0), 0);
    const dbe = c + 1 + (n + p - h - x) / 2;
    if (!Number.isInteger(dbe) || dbe < 0) return;
    // 極端に大きい DBE は非現実的な組成として除外
    if (dbe > c + n + 1) return;
    const full: Record<string, number> = { C: c, H: h };
    for (const e of elements) full[e] = counts[e] ?? 0;
    // 既知化合物にほぼ存在しない元素比(Seven Golden Rules の extended 範囲外)は除外
    if (checkElementRatios(full).level === "implausible") return;
    results.push({
      formula: formatFormula(full),
      counts: full,
      exactMass: Math.round(exactMass * 10000) / 10000,
      massErrorPpm: Math.round((massError / targetMass) * 1e6 * 100) / 100,
      degreeOfUnsaturation: dbe,
    });
  };

  // 元素を1つずつ再帰的に増やす。質量が目標を超えたら打ち切る
  const recurse = (index: number, mass: number) => {
    if (index === elements.length) {
      finish(mass);
      return;
    }
    const el = elements[index];
    for (let k = 0; k <= (MAX_COUNT[el] ?? 0); k++) {
      const m = mass + k * MASS[el];
      if (m - toleranceDa > targetMass) break;
      counts[el] = k;
      recurse(index + 1, m);
    }
    counts[el] = 0;
  };

  for (let c = minC; c <= maxC; c++) {
    const massC = c * MASS.C;
    if (massC - toleranceDa > targetMass) break;
    counts.C = c;
    recurse(0, massC);
  }

  return results.sort(
    (a, b) => Math.abs(a.massErrorPpm) - Math.abs(b.massErrorPpm),
  );
}

/** Hill 記法(C, H の後はアルファベット順。PubChem と同じ) */
function formatFormula(counts: Record<string, number>): string {
  const order = ["C", "H", ...Object.keys(counts).filter((e) => e !== "C" && e !== "H").sort()];
  const parts: string[] = [];
  for (const el of order) {
    const n = counts[el] ?? 0;
    if (n <= 0) continue;
    parts.push(n === 1 ? el : `${el}${n}`);
  }
  return parts.join("");
}
