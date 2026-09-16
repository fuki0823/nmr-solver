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
  /**
   * true の場合、この detail は「明らかに矛盾する」ハード制約違反を表す
   * (例: 観測¹³Cシグナル数が候補の炭素原子数を超える、HSQC相関に対応する
   * プロトン化炭素が候補中に存在しない等)。status が "mismatch" かつ
   * hardConstraint が true の detail が1つでもあれば、その候補は
   * rankCandidates 側で除外(excluded)候補としてマークされる。
   * 「期待される相関が観測されなかった」ような不確実性由来の不一致は
   * 決して true にしない(除外は物理的に説明不能な矛盾のみに限定する)。
   */
  hardConstraint?: boolean;
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
