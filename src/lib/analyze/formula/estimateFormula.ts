import type { FormulaCandidate } from "./massToFormulaCandidates";

/**
 * MSから得た分子式候補を、¹³Cピーク数と¹H積分値の合計で絞り込み・並べ替える。
 * 完全にrule-based。
 *
 * 炭素数: ¹³Cピーク数 nC は炭素数の下限(1原子から2本のシグナルは出ない)。
 *   ただし対称性で等価な炭素があれば実際の炭素数はnCより多くなりうる。
 *   下限だけで判定すると、質量が合う「炭素がずっと多い」分子式
 *   (例: 27本の入力に対しC35)まで残ってしまうため、まず
 *   nC ≤ C ≤ nC + carbonSlack(偶然の重なり程度)に絞る。
 *
 * 水素数: ¹H積分値の合計 nH は対称性の影響を受けない(等価なHは積分に
 *   反映される)ので、炭素よりも信頼できる。ただし OH/NH/SH は重水交換や
 *   ブロードニングで観測されないことがあるため、上側にはヘテロ原子由来の
 *   最大数(O + 2N + S)だけ余裕を持たせる。積分誤差として ±hTolerance も許す。
 *
 * 不飽和度: δ120以上の¹³Cピークはsp2炭素(C=C, C=O, 芳香環等)とみなせる
 *   (sp3炭素がここまで低磁場に出ることはまず無い。アセタール等のδ95-115は
 *   安全側に数えない)。π結合1本が消費するsp2炭素は最大2個なので、
 *   不飽和度 ≥ ceil(sp2ピーク数 / 2) が成り立つ。対称性でピークが減っても
 *   下限としては有効なため、炭素数・水素数と同じ段階で適用する。
 *
 * 上記の条件で1件も残らない場合(対称性の高い分子、積分の入力漏れ等)は、
 * 炭素数の上側の制限を外す → NMR条件を外す、の順に段階的に緩め、
 * どの段階の結果かを `level` で返す。
 */

export interface NmrCountConstraints {
  /** ¹³Cピーク数(0なら未入力) */
  carbonPeakCount: number;
  /** ¹H積分値の合計(0なら未入力) */
  protonIntegralTotal: number;
  /** ¹³Cの化学シフト一覧(不飽和度の下限の見積もりに使う。省略可) */
  carbonShifts?: number[];
  /**
   * DEPT から分かる炭素上の H の数の下限(各ピークの H 数の最小値の合計)。
   * 各ピークは少なくとも1個の炭素に対応するので、炭素上の H の総数はこれ以上になる。
   * 0 なら DEPT 未入力。
   */
  carbonBoundHydrogenMin?: number;
}

/** sp2炭素とみなす¹³Cシフトの下限(ppm) */
const SP2_SHIFT_THRESHOLD = 120;

export function minUnsaturationFromCarbonShifts(shifts: number[]): number {
  const sp2 = shifts.filter((s) => s >= SP2_SHIFT_THRESHOLD).length;
  return Math.ceil(sp2 / 2);
}

export interface FormulaEstimateOptions {
  /** ピークの偶然の重なりとして許す、ピーク数を超える炭素数(既定2) */
  carbonSlack?: number;
}

export interface RankedFormula extends FormulaCandidate {
  /** C − ¹³Cピーク数(¹³C未入力ならnull) */
  carbonExcess: number | null;
  /** H − ¹H積分合計(¹H未入力ならnull) */
  hydrogenDiff: number | null;
}

export type FormulaEstimateLevel =
  /** 炭素数・水素数の両方の条件を満たす(最も信頼できる) */
  | "strict"
  /** 対称性を仮定して炭素数の上側の制限を外した */
  | "symmetry"
  /** NMR条件では1件も残らず、質量のみで選んだ */
  | "massOnly";

export interface FormulaEstimate {
  formulas: RankedFormula[];
  level: FormulaEstimateLevel;
  /**
   * level が strict のとき、炭素数がピーク数+carbonSlack を超えるが他の条件は満たす
   * 分子式(炭素数の差が小さい順)。¹³Cで観測されにくい第四級炭素が複数ある場合
   * (例: カフェインは8炭素中5本しか帰属されていない)に正解がここに入るため、
   * 主候補とは別枠で補助的に検索する。
   */
  extraFormulas: RankedFormula[];
}

function hydrogenTolerance(protonTotal: number): number {
  return Math.max(1, Math.round(protonTotal * 0.05));
}

function hydrogenOk(f: FormulaCandidate, protonTotal: number, deptMin = 0): boolean {
  // DEPT の下限: 炭素上の H だけで deptMin 個以上ある(DEPT の読み違い1個分の余裕を持たせる)
  if (deptMin > 0 && f.counts.H < deptMin - 1) return false;
  if (protonTotal <= 0) return true;
  const tol = hydrogenTolerance(protonTotal);
  const exchangeableMax = f.counts.O + 2 * f.counts.N + f.counts.S;
  return f.counts.H >= protonTotal - tol && f.counts.H <= protonTotal + exchangeableMax + tol;
}

function hydrogenPenalty(f: FormulaCandidate, protonTotal: number, deptMin = 0): number {
  // ¹H 積分が無ければ、DEPT の下限を観測された炭素上の H 数の目安として使う
  if (protonTotal <= 0) return deptMin > 0 ? Math.max(0, f.counts.H - deptMin) * 0.5 : 0;
  const diff = f.counts.H - protonTotal;
  // 観測されない交換性Hの分だけ多いのは自然なので、不足側を重く見る
  return diff < 0 ? -diff * 2 : diff * 0.5;
}

export function estimateFormulas(
  candidates: FormulaCandidate[],
  nmr: NmrCountConstraints,
  options: FormulaEstimateOptions = {},
): FormulaEstimate {
  const slack = options.carbonSlack ?? 2;
  const nC = nmr.carbonPeakCount;
  const nH = nmr.protonIntegralTotal;
  const deptMin = nmr.carbonBoundHydrogenMin ?? 0;
  const minDbe = minUnsaturationFromCarbonShifts(nmr.carbonShifts ?? []);

  const toRanked = (f: FormulaCandidate): RankedFormula => ({
    ...f,
    carbonExcess: nC > 0 ? f.counts.C - nC : null,
    hydrogenDiff: nH > 0 ? f.counts.H - nH : null,
  });

  const sortRanked = (list: FormulaCandidate[]): RankedFormula[] =>
    list
      .map(toRanked)
      .sort(
        (a, b) =>
          (a.carbonExcess ?? 0) - (b.carbonExcess ?? 0) ||
          hydrogenPenalty(a, nH, deptMin) - hydrogenPenalty(b, nH, deptMin) ||
          Math.abs(a.massErrorPpm) - Math.abs(b.massErrorPpm),
      );

  if (nC <= 0 && nH <= 0 && deptMin <= 0) {
    return { formulas: sortRanked(candidates), level: "massOnly", extraFormulas: [] };
  }

  const carbonLowerOk = (f: FormulaCandidate) => nC <= 0 || f.counts.C >= nC;
  const carbonUpperOk = (f: FormulaCandidate) => nC <= 0 || f.counts.C <= nC + slack;
  const dbeOk = (f: FormulaCandidate) => f.degreeOfUnsaturation >= minDbe;

  const strict = candidates.filter((f) => carbonLowerOk(f) && carbonUpperOk(f) && hydrogenOk(f, nH, deptMin) && dbeOk(f));
  const symmetry = candidates.filter((f) => carbonLowerOk(f) && hydrogenOk(f, nH, deptMin) && dbeOk(f));
  if (strict.length > 0) {
    const beyondSlack = symmetry.filter((f) => !carbonUpperOk(f));
    return { formulas: sortRanked(strict), level: "strict", extraFormulas: sortRanked(beyondSlack) };
  }
  if (symmetry.length > 0) return { formulas: sortRanked(symmetry), level: "symmetry", extraFormulas: [] };

  // 炭素数の下限は物理的な制約なので、最後の段階でも維持する
  // (満たす分子式が無ければ、それも外して質量のみで返す)。
  const lowerOnly = candidates.filter(carbonLowerOk);
  return {
    formulas: sortRanked(lowerOnly.length > 0 ? lowerOnly : candidates),
    level: "massOnly",
    extraFormulas: [],
  };
}
