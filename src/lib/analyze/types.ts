/**
 * Analyzeモード(実測NMR/MSデータから候補構造を探索するモード)の型定義。
 *
 * 既存クイズ(Learn モード)の `lib/types.ts` とは意図的に独立させている。
 * Learn の `HNmrSignal` 等は「シフト文字列」で相互参照する設計で、手作業で
 * 書く25問の出題データには適しているが、Analyze はユーザーが自由入力する
 * データを扱うため、安定した id で相互参照できる形にする必要がある。
 * 両モードの本当の共通基盤は型ではなく `lib/moleculeGraph.ts` のグラフ
 * エンジン(分子式/対称性/スピン系/結合距離の計算)であり、そちらは
 * Analyze からもそのまま再利用する。
 */

export type Nucleus = "1H" | "13C";

export interface SpectralPeak {
  /** 安定した識別子(ユーザーがラベルを編集しても不変)。例: "H1", "C7" */
  id: string;
  nucleus: Nucleus;
  /** 化学シフト (ppm)。スコアリングに使うため数値必須 */
  shift: number;
  /** 表示用ラベル。範囲表記("1.45-1.85")等はこちらに自由記述する */
  shiftLabel?: string;
  /** ¹Hのみ: プロトン数(積分値) */
  integration?: number;
  multiplicity?: string;
  jValues?: number[];
}

export type CorrelationKind = "COSY" | "HSQC" | "HMBC" | "NOESY";

export interface Correlation2D {
  kind: CorrelationKind;
  /** SpectralPeak.id */
  from: string;
  /** SpectralPeak.id */
  to: string;
  /**
   * HMBC用: このピークで許容する結合数(nJCH)。未指定時はバリデータ側の
   * デフォルト([2, 3])を使う。将来、化合物クラスによって典型的な
   * 相関距離が異なる場合(例: 4結合が頻出するヘテロ環等)に、相関ごとに
   * 個別指定できるようにするためのフィールド。ハードコードされた
   * しきい値をここに逃がす目的で用意している。
   */
  allowedBondDistances?: number[];
}

export interface MassSpecData {
  measuredMz?: number;
  /** 例: "[M+H]+", "[M+Na]+", "[M-H]-" */
  ionAdduct?: string;
  molecularWeight?: number;
  exactMass?: number;
  /** 質量許容誤差(ppm)。未指定時はバリデータ側のデフォルトを使う */
  massTolerancePpm?: number;
  /**
   * 質量許容誤差の絶対値(Da)。単位質量分解能の機器等、精密質量(ppm精度)
   * が出せない低分解能MSデータ向け。指定時はmassTolerancePpmより優先される。
   */
  massToleranceDa?: number;
}

export interface AnalysisInput {
  ms?: MassSpecData;
  peaks: SpectralPeak[];
  correlations: Correlation2D[];
}

export interface CandidateStructure {
  id: string;
  /** どのCandidateProviderから来たか。例: "local" */
  source: string;
  smiles: string;
  stereoSmiles?: string;
  molecularFormula: string;
  molecularWeight: number;
  exactMass: number;
  name?: string;
  databaseUrl?: string;
  inchiKey?: string;
}

export type Confidence = "low" | "medium" | "high";

