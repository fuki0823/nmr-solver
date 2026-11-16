import type { MassSpecData, SpectralPeak } from "../types";
import {
  DEFAULT_ELEMENTS,
  generateFormulaCandidates,
  neutralMassFromAdduct,
  type FormulaSearchBounds,
  type MassKind,
} from "./massToFormulaCandidates";
import { estimateFormulas, type FormulaEstimate } from "./estimateFormula";
import { parseCarbonType } from "../dept";

/**
 * Analyzeの入力(MS+¹H/¹³C)から分子式を推定する。
 *
 * MSの値の扱い:
 *  - 測定m/z+アダクト(またはexactMass) → モノアイソトピック質量として探索
 *  - Molecular Weight(分子量)のみ → 平均分子量として探索
 *
 * exactMassはUIの入力欄を廃止したが、回帰テスト(evaluateCandidateへ直接
 * 入力を渡す)が使うため型と処理は残している。
 */

export interface FormulaSearchResult {
  estimate: FormulaEstimate;
  massKind: MassKind;
  /** 探索に使った質量 */
  targetMass: number;
}

function decimalPlaces(value: number): number {
  const text = String(value);
  const dot = text.indexOf(".");
  return dot < 0 ? 0 : text.length - dot - 1;
}

/** 平均分子量の許容誤差(Da)。入力の桁数から決める */
function averageMassToleranceDa(value: number): number {
  const d = decimalPlaces(value);
  return d >= 2 ? 0.05 : d === 1 ? 0.15 : 0.6;
}

export function estimateFormulasFromInput(
  ms: MassSpecData,
  peaks: SpectralPeak[],
): FormulaSearchResult | null {
  const carbon = peaks.filter((p) => p.nucleus === "13C");
  const nmr = {
    carbonPeakCount: carbon.length,
    carbonShifts: carbon.map((p) => p.shift),
    carbonBoundHydrogenMin: carbon.reduce((sum, p) => {
      const t = parseCarbonType(p.carbonType);
      return sum + (t ? Math.min(...t) : 0);
    }, 0),
    protonIntegralTotal: peaks
      .filter((p) => p.nucleus === "1H")
      .reduce((sum, p) => sum + (p.integration ?? 0), 0),
  };

  // 探索する元素: 既定の N/O/S に、ユーザーが指定した元素(Cl/Br/F/I/P)を加える。
  // 炭素数は ¹³C のピーク数以上(1原子から2本のシグナルは出ない)なので、探索の下限にする。
  const bounds: FormulaSearchBounds = {
    elements: [...DEFAULT_ELEMENTS, ...(ms.elements ?? [])],
    // 個数が指定されていれば(同位体パターンから分かる Cl・Br の数など)、その数に固定する。
    // チェックされていない元素の個数指定は無視する。
    fixedCounts: Object.fromEntries(
      Object.entries(ms.elementCounts ?? {}).filter(
        ([el, n]) => (ms.elements ?? []).includes(el) && Number.isInteger(n) && n >= 0,
      ),
    ),
    minCarbon: carbon.length > 0 ? carbon.length : 1,
  };

  let monoMass: number | null = null;
  if (ms.exactMass != null) monoMass = ms.exactMass;
  else if (ms.measuredMz != null && ms.ionAdduct) {
    monoMass = neutralMassFromAdduct(ms.measuredMz, ms.ionAdduct);
  }

  if (monoMass != null) {
    const tolerance =
      ms.massToleranceDa != null ? { da: ms.massToleranceDa } : { ppm: ms.massTolerancePpm ?? 10 };
    return {
      estimate: estimateFormulas(generateFormulaCandidates(monoMass, tolerance, bounds), nmr),
      massKind: "monoisotopic",
      targetMass: monoMass,
    };
  }

  if (ms.molecularWeight != null) {
    const mw = ms.molecularWeight;
    const generated = generateFormulaCandidates(
      mw,
      { da: ms.massToleranceDa ?? averageMassToleranceDa(mw) },
      bounds,
      "average",
    );
    return { estimate: estimateFormulas(generated, nmr), massKind: "average", targetMass: mw };
  }
  return null;
}
