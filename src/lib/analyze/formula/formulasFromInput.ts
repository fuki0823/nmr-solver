import type { MassSpecData, SpectralPeak } from "../types";
import {
  generateFormulaCandidates,
  neutralMassFromAdduct,
  type MassKind,
} from "./massToFormulaCandidates";
import { estimateFormulas, type FormulaEstimate } from "./estimateFormula";

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
    protonIntegralTotal: peaks
      .filter((p) => p.nucleus === "1H")
      .reduce((sum, p) => sum + (p.integration ?? 0), 0),
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
      estimate: estimateFormulas(generateFormulaCandidates(monoMass, tolerance), nmr),
      massKind: "monoisotopic",
      targetMass: monoMass,
    };
  }

  if (ms.molecularWeight != null) {
    const mw = ms.molecularWeight;
    const generated = generateFormulaCandidates(
      mw,
      { da: ms.massToleranceDa ?? averageMassToleranceDa(mw) },
      undefined,
      "average",
    );
    return { estimate: estimateFormulas(generated, nmr), massKind: "average", targetMass: mw };
  }
  return null;
}
