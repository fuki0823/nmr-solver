import type { CandidateEvaluation } from "../scoring/rankCandidates";

/**
 * 候補の評価結果を自然文で説明する層。
 *
 * 今回はAIを使わず、validatorが作った構造化結果(ValidationResult)から
 * テンプレートで文章を組み立てる。将来AIによる説明を追加する場合も、
 * 「AIには構造化結果だけを渡し、生のNMRデータやランキング判定そのものは
 * 渡さない/任せない」という方針を保つため、Explainer インターフェースを
 * 差し替えるだけで済む設計にしている。
 */
export interface Explainer {
  explain(evaluation: CandidateEvaluation): Promise<string>;
}

const STATUS_LABEL: Record<string, string> = {
  match: "一致",
  partial: "部分的に一致",
  mismatch: "不一致",
  not_evaluated: "未評価",
};

export const templateExplainer: Explainer = {
  async explain(evaluation: CandidateEvaluation): Promise<string> {
    const lines: string[] = [];
    for (const result of evaluation.results) {
      if (result.status === "not_evaluated" && result.details.length === 0) continue;
      lines.push(`${result.method}: ${STATUS_LABEL[result.status]}`);
    }
    const mismatchDetails = evaluation.results
      .flatMap((r) => r.details)
      .filter((d) => d.status === "mismatch");
    if (mismatchDetails.length > 0) {
      lines.push("", "特に不一致だった点:");
      for (const d of mismatchDetails.slice(0, 5)) {
        lines.push(`- ${d.summary}`);
      }
    }
    return lines.join("\n");
  },
};

export async function explainCandidate(
  evaluation: CandidateEvaluation,
  explainer: Explainer = templateExplainer,
): Promise<string> {
  return explainer.explain(evaluation);
}
