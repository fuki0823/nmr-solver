import { questions } from "@/data/questions";
import { analyzeSmiles } from "../ketcherService";
import type { CandidateStructure } from "../types";
import type { CandidateProvider, CandidateSearchQuery } from "./CandidateProvider";

/**
 * MVPで実装する唯一の実CandidateProvider。
 *
 * 外部DBへの接続は行わず、既存クイズ(Learn モード)の正解構造を候補
 * プールとして流用する。これにより
 *  - 外部DBのライセンス/レート制限を一切気にせずパイプライン全体を検証できる
 *  - 既存クイズの正解構造を解析エンジンの回帰テストとして使う、という
 *    今回のもう一つの目的をそのまま実現できる
 * という2つの利点がある。
 */

let cachedCandidates: Promise<CandidateStructure[]> | null = null;

async function loadCandidatePool(): Promise<CandidateStructure[]> {
  if (!cachedCandidates) {
    cachedCandidates = (async () => {
      const seen = new Map<string, CandidateStructure>();
      for (const q of questions) {
        if (seen.has(q.correctSmiles)) continue;
        try {
          const graph = await analyzeSmiles(q.correctSmiles);
          seen.set(q.correctSmiles, {
            id: `local-${q.id}`,
            source: "local",
            smiles: q.correctSmiles,
            molecularFormula: graph.formula,
            molecularWeight: graph.molecularWeight,
            exactMass: graph.exactMass,
            name: q.compoundName,
          });
        } catch {
          // 個別のSMILES変換失敗は、その1件をスキップするだけにする
          // (候補プール全体を壊さない)。
        }
      }
      return Array.from(seen.values());
    })();
  }
  return cachedCandidates;
}

export const localCandidateProvider: CandidateProvider = {
  id: "local",
  label: "既存クイズ問題(ローカル)",
  async search(query: CandidateSearchQuery): Promise<CandidateStructure[]> {
    const pool = await loadCandidatePool();
    let results = pool;
    if (query.formulaCandidates && query.formulaCandidates.length > 0) {
      const formulaSet = new Set(query.formulaCandidates);
      results = pool.filter((c) => formulaSet.has(c.molecularFormula));
    }
    if (query.limit != null) {
      results = results.slice(0, query.limit);
    }
    return results;
  },
};
