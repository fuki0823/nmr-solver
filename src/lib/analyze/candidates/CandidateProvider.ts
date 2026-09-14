import type { CandidateStructure } from "../types";

export interface CandidateSearchQuery {
  /** MS由来の分子式候補(massToFormulaCandidatesの出力)。空の場合は全件検索 */
  formulaCandidates?: string[];
  limit?: number;
}

/**
 * 候補化合物の検索を抽象化するインターフェース。
 * 将来PubChem/COCONUT/LOTUS/NPAtlas等を追加する際は、このインターフェースを
 * 実装したプロバイダを追加するだけでよい設計にしている(今回は接続しない)。
 */
export interface CandidateProvider {
  id: string;
  label: string;
  search(query: CandidateSearchQuery): Promise<CandidateStructure[]>;
}
