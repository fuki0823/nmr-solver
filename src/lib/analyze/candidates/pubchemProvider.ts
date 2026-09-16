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
 *
 * MAX_FORMULAS_TO_QUERYについて: massToFormulaCandidates は既定10ppmという
 * 厳しい許容誤差で探索するため、入力されたExact Massの精度が低い(例:
 * 小数点以下2桁までしか入力されていない)場合、本来の分子式が質量誤差の
 * 順位で上位に来ないことがある(例: クエルセチン C15H10O7の精密質量
 * 302.0426に対し302.04とだけ入力すると、他のC/H/N/O/S組み合わせによる
 * 偶然の近い質量に埋もれ、10位前後まで下がりうることを実測で確認した)。
 * そのため、ここでのみ順位を絞りすぎず、ある程度の候補を実際に
 * PubChemへ問い合わせることで、入力精度の粗さに対する耐性を持たせている。
 * 低分解能MS(massToleranceDa指定)では該当する分子式が数百件規模になり
 * うるが、そちら側は呼び出し元(AnalyzeView)で¹³C観測本数による事前絞り
 * 込みを行っているため、ここでは現実的な範囲(25件)まで引き上げている。
 */

const PUBCHEM_BASE = "https://pubchem.ncbi.nlm.nih.gov/rest/pug";
const MAX_FORMULAS_TO_QUERY = 25;
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

async function fetchCidsForFormula(formula: string, cap: number): Promise<number[]> {
  const res = await fetch(
    `${PUBCHEM_BASE}/compound/fastformula/${encodeURIComponent(formula)}/cids/JSON`,
  );
  if (!res.ok) return [];
  const data = (await res.json()) as { IdentifierList?: { CID?: number[] } };
  return data.IdentifierList?.CID?.slice(0, cap) ?? [];
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

    // 全体の候補数上限(query.limit)を分子式ごとに均等割りする。単純に
    // 質量誤差が小さい順から先頭を詰めていくと、最初の(=質量誤差最小の、
    // ただし化学的に妥当とは限らない)分子式だけで上限を使い切ってしまい、
    // 入力精度の粗さで順位の下がった本来の分子式(例: クエルセチン)が
    // 候補に一切現れなくなる。そのため各分子式に最低限の枠を保証する。
    const totalLimit = query.limit ?? MAX_CIDS_PER_FORMULA * formulas.length;
    const perFormulaCap = Math.max(
      3,
      Math.min(MAX_CIDS_PER_FORMULA, Math.ceil(totalLimit / formulas.length)),
    );

    const results: CandidateStructure[] = [];
    for (const formula of formulas) {
      try {
        const cids = await fetchCidsForFormula(formula, perFormulaCap);
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
