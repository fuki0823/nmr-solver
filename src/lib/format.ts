import type { AnalysisMethod, Difficulty, HNmrSignal, Question } from "./types";

export function formatHNmrSignal(signal: HNmrSignal): string {
  const parts = [`${signal.integration}H`, signal.multiplicity];
  if (signal.jValue) {
    parts.push(`J = ${signal.jValue} Hz`);
  }
  return `δ ${signal.shift} (${parts.join(", ")})`;
}

export function difficultyLabel(difficulty: Difficulty): string {
  switch (difficulty) {
    case "easy":
      return "やさしい";
    case "medium":
      return "ふつう";
    case "hard":
      return "むずかしい";
    case "expert":
      return "エキスパート(天然物)";
  }
}

/** 分子量・精密質量の表示用フォーマット。例: "290.5", "290.2610" */
export function formatMass(value: number, digits: number): string {
  return value.toFixed(digits);
}

const METHOD_ORDER: AnalysisMethod[] = [
  "1H",
  "13C",
  "DEPT",
  "COSY",
  "HSQC",
  "HMBC",
  "NOESY",
];

/**
 * 問題で使用されている解析法を返す。`methods`が明示されていればそれを使い、
 * 省略されている場合は各データフィールドの有無から推定する
 * (既存問題にmethodsフィールドを後から追加しなくても一覧表示できるようにするため)。
 */
export function getQuestionMethods(question: Question): AnalysisMethod[] {
  if (question.methods) return question.methods;
  const inferred: AnalysisMethod[] = ["1H"];
  if (question.cNmr && question.cNmr.length > 0) inferred.push("13C");
  if (question.dept) inferred.push("DEPT");
  if (question.cosy) inferred.push("COSY");
  if (question.hsqc && question.hsqc.length > 0) inferred.push("HSQC");
  if (question.hmbc && question.hmbc.length > 0) inferred.push("HMBC");
  return METHOD_ORDER.filter((m) => inferred.includes(m));
}
