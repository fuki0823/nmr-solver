import { bondDistance } from "../../moleculeGraph";
import type { ValidationContext, ValidationDetail, ValidationResult } from "./types";

/**
 * NOESY(空間的近接)の検証について、正直な設計方針。
 *
 * NOESYはscalar couplingではなく空間的近接の情報であり、それを判定する
 * には3次元構造(立体配座・立体化学)が必要になる。このアプリのグラフ
 * エンジン(`moleculeGraph.ts`)は結合トポロジーのみを扱い、3次元座標や
 * 立体化学は一切モデル化していない。
 *
 * そのため、このvalidatorは「できないことをできるふりをしない」という
 * 本プロジェクト一貫の方針に従い、
 *  - 割り当てた2原子が直接結合(1結合)している場合のみ、「結合していれば
 *    空間的にも必ず近い」という自明な事実に基づき match とする
 *  - それ以外は常に not_evaluated とし、理由を明記する
 * という、控えめだが誠実な判定に留める。将来的に立体化学(stereo SMILES
 * の3次元embedding等)を扱えるようになった場合に、このvalidatorだけを
 * 差し替えれば済むように、インターフェースはCOSY/HMBCと共通にしている。
 */
export function noesyValidator(context: ValidationContext): ValidationResult {
  const { input, candidateGraph, assignment } = context;
  const noesyCorrelations = input.correlations.filter((c) => c.kind === "NOESY");
  if (noesyCorrelations.length === 0) {
    return { method: "NOESY", status: "not_evaluated", score: 0, details: [] };
  }

  const details: ValidationDetail[] = [];

  for (const corr of noesyCorrelations) {
    const a = assignment.byPeakId.get(corr.from);
    const b = assignment.byPeakId.get(corr.to);
    if (!a || !b) {
      details.push({
        status: "not_evaluated",
        summary: `${corr.from} ↔ ${corr.to}: 候補構造への割当ができず評価できません`,
      });
      continue;
    }
    const distance = bondDistance(candidateGraph, a.atomIndex, b.atomIndex);
    if (distance !== null && distance <= 1) {
      details.push({
        status: "match",
        summary: `${corr.from} ↔ ${corr.to}: 直接結合しており、空間的にも近いことは自明です`,
      });
    } else {
      details.push({
        status: "not_evaluated",
        summary: `${corr.from} ↔ ${corr.to}: 立体配座・立体化学の情報を持たないため、空間的な近接は判定できません`,
      });
    }
  }

  // NOESYはランキングに寄与させない(0点・not_evaluated固定)。
  // 立体化学を伴わない結合トポロジーだけでは、本質的に判定できないため。
  return { method: "NOESY", status: "not_evaluated", score: 0, details };
}
