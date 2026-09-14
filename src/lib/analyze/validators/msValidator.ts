import { neutralMassFromAdduct } from "../formula/massToFormulaCandidates";
import type { ValidationContext, ValidationResult } from "./types";

const DEFAULT_TOLERANCE_PPM = 10;

export function msValidator(context: ValidationContext): ValidationResult {
  const { input, candidate } = context;
  const ms = input.ms;
  if (!ms) {
    return { method: "MS", status: "not_evaluated", score: 0, details: [] };
  }

  let targetExactMass: number | null = null;
  if (ms.exactMass != null) {
    targetExactMass = ms.exactMass;
  } else if (ms.measuredMz != null && ms.ionAdduct) {
    targetExactMass = neutralMassFromAdduct(ms.measuredMz, ms.ionAdduct);
  }

  if (targetExactMass != null) {
    const tolerancePpm = ms.massTolerancePpm ?? DEFAULT_TOLERANCE_PPM;
    const toleranceDa = Math.max((targetExactMass * tolerancePpm) / 1e6, 0.003);
    const errorDa = candidate.exactMass - targetExactMass;
    const withinTolerance = Math.abs(errorDa) <= toleranceDa;
    const withinLooseTolerance = Math.abs(errorDa) <= toleranceDa * 3;
    const status = withinTolerance ? "match" : withinLooseTolerance ? "partial" : "mismatch";
    return {
      method: "MS",
      status,
      score: withinTolerance ? 1 : withinLooseTolerance ? 0.4 : 0,
      details: [
        {
          status,
          summary: `Exact mass: 候補 ${candidate.exactMass.toFixed(4)} / 目標 ${targetExactMass.toFixed(4)}(誤差 ${errorDa.toFixed(4)} Da)`,
        },
      ],
    };
  }

  if (ms.molecularWeight != null) {
    const errorDa = candidate.molecularWeight - ms.molecularWeight;
    const withinTolerance = Math.abs(errorDa) <= 0.5;
    const status = withinTolerance ? "match" : "mismatch";
    return {
      method: "MS",
      status,
      score: withinTolerance ? 0.8 : 0, // exact massより精度が粗いため満点は与えない
      details: [
        {
          status,
          summary: `分子量: 候補 ${candidate.molecularWeight} / 目標 ${ms.molecularWeight}`,
        },
      ],
    };
  }

  return { method: "MS", status: "not_evaluated", score: 0, details: [] };
}
