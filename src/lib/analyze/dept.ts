/**
 * DEPT(¹³C の多重度: C / CH / CH2 / CH3)の表記を、「その炭素に付いている H の数として
 * ありうる値の集合」に変換する。
 *
 * DEPT の測定の組み合わせによって分かる範囲が違うため、集合で表す。
 *  - DEPT-90 に出る                       → CH       {1}
 *  - DEPT-135 で負                         → CH2      {2}
 *  - DEPT-135 で正、DEPT-90 に出ない        → CH3      {3}
 *  - DEPT-135 で正のみ(DEPT-90 なし)       → CH/CH3   {1,3}
 *  - DEPT-135 に出るが符号不明・DEPT-90 に出ない → CH2/CH3 {2,3}
 *  - DEPT-135 に出ない                     → C        {0}
 * オフレゾナンスデカップリングの表記(s = C, d = CH, t = CH2, q = CH3)も受け付ける。
 */

export type HydrogenCountSet = number[];

const TABLE: Record<string, HydrogenCountSet> = {
  c: [0],
  cq: [0],
  qc: [0],
  "c(q)": [0],
  s: [0],
  ch: [1],
  d: [1],
  ch2: [2],
  t: [2],
  ch3: [3],
  q: [3],
  "ch/ch3": [1, 3],
  "ch3/ch": [1, 3],
  "+": [1, 3],
  "ch2/ch3": [2, 3],
  "ch3/ch2": [2, 3],
  "-": [2],
  "ch/ch2/ch3": [1, 2, 3],
  "ch_n": [1, 2, 3],
};

/** DEPT の表記を解釈する。解釈できない・空なら null(判定に使わない) */
export function parseCarbonType(raw: string | undefined): HydrogenCountSet | null {
  if (!raw) return null;
  const key = raw
    .trim()
    .toLowerCase()
    .replace(/₀/g, "0")
    .replace(/₁/g, "1")
    .replace(/₂/g, "2")
    .replace(/₃/g, "3")
    .replace(/\s+/g, "")
    .replace(/[,、]/g, "/")
    .replace(/^\(|\)$/g, "");
  return TABLE[key] ?? null;
}

/** 表示用の表記(例: [1,3] → "CH/CH3") */
export function formatCarbonType(set: HydrogenCountSet): string {
  const names = ["C", "CH", "CH2", "CH3"];
  return set.map((n) => names[n]).join("/");
}

/** 同じ表記の候補を選択肢として出すための一覧(UI 用) */
export const CARBON_TYPE_OPTIONS = ["C", "CH", "CH2", "CH3", "CH/CH3", "CH2/CH3"] as const;
