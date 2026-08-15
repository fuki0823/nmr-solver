export type Difficulty = "easy" | "medium" | "hard" | "expert";

/** 問題で使用する解析法。一覧ページのバッジ表示および将来の絞り込みに使う。 */
export type AnalysisMethod =
  | "1H"
  | "13C"
  | "DEPT"
  | "COSY"
  | "HSQC"
  | "HMBC"
  | "NOESY";

export interface HNmrSignal {
  /** 化学シフト (ppm)。例: "7.2" */
  shift: string;
  /** プロトン数(積分値) */
  integration: number;
  /** 多重度。例: "s", "d", "t", "q", "m", "dd", "sept" */
  multiplicity: string;
  /** カップリング定数 (Hz)。複数ある場合はカンマ区切りの文字列。例: "16.0, 7.6" */
  jValue?: string;
}

export interface CNmrSignal {
  /** 化学シフト (ppm) */
  shift: string;
}

export interface DeptData {
  /** DEPT-90: CHのみ観測される炭素の化学シフト一覧 */
  dept90: string[];
  /** DEPT-135でpositiveに観測される炭素(CH・CH3)の化学シフト一覧 */
  positive135: string[];
  /** DEPT-135でnegativeに観測される炭素(CH2)の化学シフト一覧 */
  negative135: string[];
}

export interface CosyData {
  /** ¹H-¹H COSYのクロスピーク一覧。各要素は相関する2つの¹Hシフト(1H NMRのshiftと同じ表記) */
  correlations: [string, string][];
}

export interface HsqcCorrelation {
  /** ¹Hの化学シフト(1H NMRのshiftと同じ表記) */
  h: string;
  /** 直接結合している¹³Cの化学シフト(13C NMRのshiftと同じ表記)。第四級炭素は含めない */
  c: string;
  /** 将来的な帰属ラベル用の予約フィールド(例: "H-2", "C-3")。現時点では未使用 */
  hAssignment?: string;
  cAssignment?: string;
}

export interface HmbcCorrelation {
  /** ¹Hの化学シフト(1H NMRのshiftと同じ表記) */
  h: string;
  /** long-range(主に2JCH/3JCH)で相関する¹³Cの化学シフト一覧(複数可) */
  c: string[];
  /** 将来的な帰属ラベル用の予約フィールド。現時点では未使用 */
  hAssignment?: string;
  cAssignment?: string[];
}

export interface Question {
  id: number;
  difficulty: Difficulty;
  /** 分子式。例: "C9H10O2"(解答判定など内部処理用。分子量が設定されている問題では画面には表示しない) */
  molecularFormula: string;
  /**
   * 分子量。設定されている問題では、画面に分子式の代わりに分子量(・精密質量)を表示する
   * (天然物レベルの問題など、分子式から逆算できてしまうのを避けるため)。
   */
  molecularWeight?: number;
  /** 精密質量(モノアイソトピック質量)。molecularWeightと合わせて表示する。 */
  exactMass?: number;
  /**
   * この問題で使用する解析法の一覧(一覧ページのバッジ表示用)。
   * 省略した場合、一覧ページは各データフィールドの有無から自動推定する。
   */
  methods?: AnalysisMethod[];
  hNmr: HNmrSignal[];
  cNmr?: CNmrSignal[];
  /** DEPT-90 / DEPT-135 データ。存在する場合、問題表示時から展開して表示する */
  dept?: DeptData;
  /** ¹H-¹H COSY データ。存在する場合、問題表示時から展開して表示する */
  cosy?: CosyData;
  /** HSQC(¹J, 直接結合)相関。存在する場合、問題表示時から展開して表示する */
  hsqc?: HsqcCorrelation[];
  /** HMBC(主に2JCH/3JCH)相関。存在する場合、問題表示時から展開して表示する */
  hmbc?: HmbcCorrelation[];
  /** 正解構造のSMILES */
  correctSmiles: string;
  /** 段階式ヒント(3段階) */
  hints: [string, string, string];
  /** 化合物名(正解後に表示) */
  compoundName: string;
  /** 正解後に表示する解説 */
  explanation: string;
}
