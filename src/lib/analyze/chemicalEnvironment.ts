import type { AtomInfo, MoleculeGraph } from "../moleculeGraph";

/**
 * シフト値・原子の局所構造から「おおまかな化学的領域」を分類するモジュール。
 * NMR shift予測(DFT等)は行わない。あくまで粗いバケット分類であり、出題
 * データをこれまで手作業で設計してきた際の判断基準(δ190超はカルボニル、
 * 芳香族は100-150、等)を、コードとして再現したもの。
 *
 * 目的は「候補構造の原子環境の分布」と「入力ピークの分布」を、個々の
 * shift値の予測なしに突き合わせられるようにすること。
 */

export type CarbonBucket =
  | "carbonyl" // >~190: ケトン/アルデヒド
  | "carboxylOrAmide" // ~155-190: エステル/カルボン酸/アミド
  | "aromaticOrAlkene" // ~95-155
  | "oxygenatedSp3" // ~50-95: C-O, C-N sp3
  | "aliphatic"; // ~0-50

export type ProtonBucket =
  | "veryDeshielded" // >~9: アルデヒド, カルボン酸OH等
  | "aromaticOrAlkene" // ~4.5-9
  | "heteroatomAdjacent" // ~2.2-4.5: OCH, NCH, allylic 等
  | "aliphatic"; // ~0-2.2

export function classifyCarbonBucket(
  graph: MoleculeGraph,
  atom: AtomInfo,
): CarbonBucket {
  if (atom.element !== "C") return "aliphatic";

  let hasDoubleBondToHeteroatom = false;
  let hasDoubleBondToCarbon = false;
  let hasAromaticNeighbor = false;
  let hasSingleBondToHeteroatom = false;
  let heteroDoubleBondPartnerIsO = false;
  let singleBondHeteroCount = 0;

  for (const [nbrIdx, order] of atom.heavyNeighbors) {
    const nbr = graph.atoms[nbrIdx];
    if (!nbr) continue;
    const isHetero = nbr.element === "O" || nbr.element === "N" || nbr.element === "S";
    if (order === 2) {
      if (isHetero) {
        hasDoubleBondToHeteroatom = true;
        if (nbr.element === "O") heteroDoubleBondPartnerIsO = true;
      } else if (nbr.element === "C") {
        hasDoubleBondToCarbon = true;
      }
    } else if (order === 4) {
      hasAromaticNeighbor = true;
    } else if (order === 1 && isHetero) {
      hasSingleBondToHeteroatom = true;
      singleBondHeteroCount++;
    }
  }

  // カルボニル(ケトン/アルデヒド): C=O のみで、他に酸素/窒素の単結合を
  // 持たない(エステル/アミド/カルボン酸はC=Oに加えてC-O(H)/C-Nも持つため
  // 区別する)。
  if (hasDoubleBondToHeteroatom && heteroDoubleBondPartnerIsO && !hasSingleBondToHeteroatom) {
    return "carbonyl";
  }
  // エステル/カルボン酸/アミド: C=O + C-O or C-N
  if (hasDoubleBondToHeteroatom && (hasSingleBondToHeteroatom || singleBondHeteroCount > 0)) {
    return "carboxylOrAmide";
  }
  if (hasAromaticNeighbor || hasDoubleBondToCarbon) {
    return "aromaticOrAlkene";
  }
  if (hasSingleBondToHeteroatom) {
    return "oxygenatedSp3";
  }
  return "aliphatic";
}

export function carbonBucketFromShift(shift: number): CarbonBucket {
  if (shift >= 190) return "carbonyl";
  if (shift >= 155) return "carboxylOrAmide";
  if (shift >= 95) return "aromaticOrAlkene";
  if (shift >= 50) return "oxygenatedSp3";
  return "aliphatic";
}

export function protonBucketFromShift(shift: number): ProtonBucket {
  if (shift >= 9) return "veryDeshielded";
  if (shift >= 4.5) return "aromaticOrAlkene";
  if (shift >= 2.2) return "heteroatomAdjacent";
  return "aliphatic";
}

/** 炭素原子(の属する炭素)に結合したHが推定的に属するプロトンバケット */
export function protonBucketForCarbonBucket(bucket: CarbonBucket): ProtonBucket {
  switch (bucket) {
    case "carbonyl":
      return "veryDeshielded"; // アルデヒドH
    case "carboxylOrAmide":
      return "aromaticOrAlkene"; // 目安。実際はO-Hの方が高磁場側寄りだがCH自体はこの範囲寄り
    case "aromaticOrAlkene":
      return "aromaticOrAlkene";
    case "oxygenatedSp3":
      return "heteroatomAdjacent";
    case "aliphatic":
      return "aliphatic";
  }
}

/**
 * 候補構造中に、指定した¹³Cバケットに該当する炭素原子(プロトン化の有無を
 * 問わない)が1つでも存在するか。HMBCの相関先(第四級炭素でもよい)側の
 * 「割当自体が原理的に不可能」判定に使う。
 */
export function hasCarbonInBucket(graph: MoleculeGraph, bucket: CarbonBucket): boolean {
  return graph.atoms.some(
    (a) => a.element === "C" && classifyCarbonBucket(graph, a) === bucket,
  );
}

/**
 * 候補構造中に、指定した¹³Cバケットに該当する「プロトン化された」炭素
 * 原子が1つでも存在するか。HSQCの相関先や、HMBCの起点(プロトンが直接
 * 結合している炭素)側の「割当自体が原理的に不可能」判定に使う。
 */
export function hasProtonatedCarbonInBucket(graph: MoleculeGraph, bucket: CarbonBucket): boolean {
  return graph.atoms.some(
    (a) => a.element === "C" && (a.attachedH ?? 0) > 0 && classifyCarbonBucket(graph, a) === bucket,
  );
}

/**
 * 指定したプロトンバケットに対応しうる¹³Cバケットの一覧
 * (protonBucketForCarbonBucket の逆引き)。
 */
export function carbonBucketsForProtonBucket(target: ProtonBucket): CarbonBucket[] {
  const all: CarbonBucket[] = [
    "carbonyl",
    "carboxylOrAmide",
    "aromaticOrAlkene",
    "oxygenatedSp3",
    "aliphatic",
  ];
  return all.filter((b) => protonBucketForCarbonBucket(b) === target);
}

/**
 * 候補構造中に、指定したプロトンバケットに該当しうる「プロトン化された」
 * 炭素原子が1つでも存在するか。
 */
export function hasProtonatedCarbonForProtonBucket(
  graph: MoleculeGraph,
  target: ProtonBucket,
): boolean {
  return carbonBucketsForProtonBucket(target).some((b) => hasProtonatedCarbonInBucket(graph, b));
}
