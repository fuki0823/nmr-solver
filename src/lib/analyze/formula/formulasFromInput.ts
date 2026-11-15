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
 *  - Exact Mass、または測定m/z+アダクト → モノアイソトピック質量として探索
 *  - Molecular Weight(分子量)のみ → 平均分子量として探索
 *
 * Exact Mass欄に平均分子量(例: ダウノルビシン 527.52)が入力されることがある。
 * そのままモノアイソトピックとして探索すると、たまたま質量が合う無関係な
 * 分子式(例: C35H65N3 = 527.5179)が選ばれてしまう。そこで、Exact Massが
 * 小数2桁以下(HRMSの値は通常4桁)で、かつNMRと両立する分子式が見つから
 * なかった場合に限り、平均分子量としても探索し、そちらがNMRと両立すれば
 * 採用する(採用したことは結果に明示する)。
 */

export interface FormulaSearchResult {
  estimate: FormulaEstimate;
  massKind: MassKind;
  /** 探索に使った質量 */
  targetMass: number;
  /** Exact Mass欄の値を平均分子量として解釈し直した */
  reinterpretedExactMassAsAverage: boolean;
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

  const searchAverage = (mw: number, reinterpreted: boolean): FormulaSearchResult => {
    const generated = generateFormulaCandidates(
      mw,
      { da: ms.massToleranceDa ?? averageMassToleranceDa(mw) },
      undefined,
      "average",
    );
    return {
      estimate: estimateFormulas(generated, nmr),
      massKind: "average",
      targetMass: mw,
      reinterpretedExactMassAsAverage: reinterpreted,
    };
  };

  let monoMass: number | null = null;
  if (ms.exactMass != null) monoMass = ms.exactMass;
  else if (ms.measuredMz != null && ms.ionAdduct) {
    monoMass = neutralMassFromAdduct(ms.measuredMz, ms.ionAdduct);
  }

  if (monoMass != null) {
    const tolerance =
      ms.massToleranceDa != null ? { da: ms.massToleranceDa } : { ppm: ms.massTolerancePpm ?? 10 };
    const mono: FormulaSearchResult = {
      estimate: estimateFormulas(generateFormulaCandidates(monoMass, tolerance), nmr),
      massKind: "monoisotopic",
      targetMass: monoMass,
      reinterpretedExactMassAsAverage: false,
    };
    if (
      mono.estimate.level !== "strict" &&
      ms.exactMass != null &&
      decimalPlaces(ms.exactMass) <= 2
    ) {
      const asAverage = searchAverage(ms.exactMass, true);
      if (asAverage.estimate.level === "strict") return asAverage;
    }
    return mono;
  }

  if (ms.molecularWeight != null) return searchAverage(ms.molecularWeight, false);
  return null;
}
