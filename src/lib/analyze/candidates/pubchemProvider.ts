import type { CandidateStructure } from "../types";
import type { CandidateProvider, CandidateSearchQuery } from "./CandidateProvider";

/**
 * PubChem PUG-REST を使った実際のDB接続CandidateProvider。
 *
 * PubChemのPUG-RESTは `Access-Control-Allow-Origin: *` を返す(実機で確認
 * 済み)ため、サーバー側プロキシなしにブラウザから直接呼び出せる。API
 * キーは不要。
 *
 * 分子式による検索(fastformula)のみに対応する。PubChemには自由な条件での
 * 全件検索に相当するものはなく、分子式のような具体的な絞り込み条件が
 * 必須のため、MS由来の分子式候補が無い場合は検索しない(空配列を返す)。
 *
 * レート制限(目安5 req/秒)に配慮し、複数の分子式候補があっても順番に
 * 問い合わせる(並列にしない)。
 */

const PUBCHEM_BASE = "https://pubchem.ncbi.nlm.nih.gov/rest/pug";
const MAX_FORMULAS_TO_QUERY = 2;
const MAX_CIDS_PER_FORMULA = 15;

interface PubchemPropertyRow {
  CID: number;
  MolecularFormula: string;
  MolecularWeight: string;
  MonoisotopicMass: string;
  ConnectivitySMILES?: string;
  IsomericSMILES?: string;
  IUPACName?: string;
}

async function fetchCidsForFormula(formula: string): Promise<number[]> {
  const res = await fetch(
    `${PUBCHEM_BASE}/compound/fastformula/${encodeURIComponent(formula)}/cids/JSON`,
  );
  if (!res.ok) return [];
  const data = (await res.json()) as { IdentifierList?: { CID?: number[] } };
  return data.IdentifierList?.CID?.slice(0, MAX_CIDS_PER_FORMULA) ?? [];
}

async function fetchPropertiesForCids(
  cids: number[],
): Promise<PubchemPropertyRow[]> {
  if (cids.length === 0) return [];
  const props = [
    "MolecularFormula",
    "MolecularWeight",
    "MonoisotopicMass",
    "ConnectivitySMILES",
    "IsomericSMILES",
    "IUPACName",
  ].join(",");
  const res = await fetch(
    `${PUBCHEM_BASE}/compound/cid/${cids.join(",")}/property/${props}/JSON`,
  );
  if (!res.ok) return [];
  const data = (await res.json()) as {
    PropertyTable?: { Properties?: PubchemPropertyRow[] };
  };
  return data.PropertyTable?.Properties ?? [];
}

export const pubchemCandidateProvider: CandidateProvider = {
  id: "pubchem",
  label: "PubChem",
  async search(query: CandidateSearchQuery): Promise<CandidateStructure[]> {
    const formulas = (query.formulaCandidates ?? []).slice(
      0,
      MAX_FORMULAS_TO_QUERY,
    );
    if (formulas.length === 0) return [];

    const results: CandidateStructure[] = [];
    for (const formula of formulas) {
      try {
        const cids = await fetchCidsForFormula(formula);
        const rows = await fetchPropertiesForCids(cids);
        for (const row of rows) {
          const smiles = row.ConnectivitySMILES;
          if (!smiles) continue;
          results.push({
            id: `pubchem-${row.CID}`,
            source: "pubchem",
            smiles,
            stereoSmiles: row.IsomericSMILES,
            molecularFormula: row.MolecularFormula,
            molecularWeight: parseFloat(row.MolecularWeight),
            exactMass: parseFloat(row.MonoisotopicMass),
            name: row.IUPACName,
            databaseUrl: `https://pubchem.ncbi.nlm.nih.gov/compound/${row.CID}`,
          });
        }
      } catch {
        // 1つの分子式の検索が失敗しても、他の分子式の検索は続行する
        // (PubChemが一時的に落ちていてもアプリ全体は壊さない)。
      }
    }

    if (query.limit != null) return results.slice(0, query.limit);
    return results;
  },
};
