import { neutralMassFromAdduct } from "../formula/massToFormulaCandidates";
import { checkElementRatios } from "../formula/elementRatios";
import { parseFormula } from "../formulaUtils";
import type { ValidationContext, ValidationDetail, ValidationResult, ValidationStatus } from "./types";

const DEFAULT_TOLERANCE_PPM = 10;
/** 元素比が一般的な範囲(Seven Golden Rules の common)を外れる分子式に掛ける係数 */
const UNCOMMON_RATIO_FACTOR = 0.6;

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

  let score: number;
  let status: ValidationStatus;
  const details: ValidationDetail[] = [];
  if (targetExactMass != null) {
    const toleranceDa =
      ms.massToleranceDa != null
        ? ms.massToleranceDa
        : Math.max((targetExactMass * (ms.massTolerancePpm ?? DEFAULT_TOLERANCE_PPM)) / 1e6, 0.003);
    const errorDa = candidate.exactMass - targetExactMass;
    const withinTolerance = Math.abs(errorDa) <= toleranceDa;
    const withinLooseTolerance = Math.abs(errorDa) <= toleranceDa * 3;
    status = withinTolerance ? "match" : withinLooseTolerance ? "partial" : "mismatch";
    score = withinTolerance ? 1 : withinLooseTolerance ? 0.4 : 0;
    details.push({
      status,
      summary: `Exact mass: 候補 ${candidate.exactMass.toFixed(4)} / 目標 ${targetExactMass.toFixed(4)}(誤差 ${errorDa.toFixed(4)} Da)`,
    });
  } else if (ms.molecularWeight != null) {
    const errorDa = candidate.molecularWeight - ms.molecularWeight;
    const withinTolerance = Math.abs(errorDa) <= 0.5;
    status = withinTolerance ? "match" : "mismatch";
    score = withinTolerance ? 0.8 : 0; // exact massより精度が粗いため満点は与えない
    details.push({ status, summary: `分子量: 候補 ${candidate.molecularWeight} / 目標 ${ms.molecularWeight}` });
  } else {
    return { method: "MS", status: "not_evaluated", score: 0, details: [] };
  }

  // 分子式の元素比(質量が合っていても、既知化合物にまれな組成は確からしさが低い)
  const ratio = checkElementRatios(parseFormula(candidate.molecularFormula));
  if (ratio.level !== "common") {
    score *= ratio.level === "implausible" ? 0 : UNCOMMON_RATIO_FACTOR;
    if (status === "match") status = "partial";
    details.push({
      status: "partial",
      summary: `分子式 ${candidate.molecularFormula} の元素比が既知の有機化合物では一般的でありません: ${ratio.reasons.join(" / ")}`,
    });
  }

  return { method: "MS", status, score, details };
}
