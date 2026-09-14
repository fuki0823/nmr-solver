import type { MoleculeGraph } from "../../moleculeGraph";
import type { AnalysisInput, CandidateStructure } from "../types";
import type { PeakAssignment } from "../assignment/assignPeaks";

export type ValidationMethod =
  | "MS"
  | "1H"
  | "13C"
  | "COSY"
  | "HSQC"
  | "HMBC"
  | "NOESY";

export type ValidationStatus = "match" | "partial" | "mismatch" | "not_evaluated";

export interface ValidationDetail {
  summary: string;
  status: ValidationStatus;
}

export interface ValidationResult {
  method: ValidationMethod;
  status: ValidationStatus;
  /** 0-1。この手法単体での一致度合い(確率ではない) */
  score: number;
  details: ValidationDetail[];
}

/** Validatorに渡す文脈情報。候補のグラフ・原子割当は複数validatorで共有する */
export interface ValidationContext {
  input: AnalysisInput;
  candidate: CandidateStructure;
  candidateGraph: MoleculeGraph;
  /** COSY/HSQC/HMBC/NOESY validatorが使う、ピークID→候補原子indexの割当 */
  assignment: PeakAssignment;
}

export type Validator = (context: ValidationContext) => ValidationResult;
