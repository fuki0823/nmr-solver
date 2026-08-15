import { parseMolfileV2000, type MolfileBondOrder } from "./molfile";

/**
 * 提出構造(molfile)から、矛盾検出に必要な情報を決定論的に計算するモジュール。
 * 化学的に正しく判定できない情報(立体化学・ジアステレオトピック水素の区別など)は
 * 一切推測せず、位相(トポロジー)だけから導ける事実に限定する。
 */

// 一般的な有機化合物の問題で登場する元素のみ対応。未対応元素が出てきた場合は
// 「判定不能」として上位でチェックをスキップさせる(誤った断定をしないため)。
const STANDARD_VALENCE: Record<string, number> = {
  H: 1,
  C: 4,
  N: 3,
  O: 2,
  F: 1,
  Cl: 1,
  Br: 1,
  I: 1,
  S: 2,
  P: 3,
};

const ATOMIC_WEIGHT: Record<string, number> = {
  H: 1.008,
  C: 12.011,
  N: 14.007,
  O: 15.999,
  F: 18.998,
  Cl: 35.45,
  Br: 79.904,
  I: 126.904,
  S: 32.06,
  P: 30.974,
};

// 芳香族結合(V2000 type 4)は価電子の勘定上 1.5 として扱う(ベンゼン環のCHで
// 1.5+1.5=3、価数4-3=1Hとなり実際と一致することを確認済み)。
function bondOrderValue(order: MolfileBondOrder): number {
  if (order === 4) return 1.5;
  return order;
}

export interface AtomInfo {
  index: number;
  element: string;
  /** 結合している水素の数(暗示的+明示的Hの合計)。未対応元素の場合はnull */
  attachedH: number | null;
  /** [相手の原子index, 結合次数] の配列。Hは除く */
  heavyNeighbors: Array<[number, MolfileBondOrder]>;
}

export interface MoleculeGraph {
  atoms: AtomInfo[];
  formula: string;
  molecularWeight: number;
  /** 対応不能な元素が含まれていた場合 true。この場合、原子数に依存するチェックは信頼できない */
  hasUnsupportedElement: boolean;
}

export function buildMoleculeGraph(molfile: string): MoleculeGraph {
  const parsed = parseMolfileV2000(molfile);

  const elementCounts: Record<string, number> = {};
  let hasUnsupportedElement = false;

  // 明示的に描かれたH原子(通常のKetcher出力では稀だが、対応しておく)
  const explicitHNeighborCount = new Array(parsed.atoms.length).fill(0);
  const heavyNeighbors: Array<Array<[number, MolfileBondOrder]>> = parsed.atoms.map(
    () => [],
  );
  for (const bond of parsed.bonds) {
    const a = parsed.atoms[bond.begin];
    const b = parsed.atoms[bond.end];
    if (!a || !b) continue;
    if (a.element === "H") explicitHNeighborCount[bond.end]++;
    else if (b.element === "H") explicitHNeighborCount[bond.begin]++;
    else {
      heavyNeighbors[bond.begin].push([bond.end, bond.order]);
      heavyNeighbors[bond.end].push([bond.begin, bond.order]);
    }
  }

  const atoms: AtomInfo[] = parsed.atoms.map((atom, index) => {
    elementCounts[atom.element] = (elementCounts[atom.element] ?? 0) + 1;

    if (atom.element === "H") {
      return { index, element: "H", attachedH: 0, heavyNeighbors: [] };
    }

    const standardValence = STANDARD_VALENCE[atom.element];
    if (standardValence === undefined) {
      hasUnsupportedElement = true;
      return { index, element: atom.element, attachedH: null, heavyNeighbors: heavyNeighbors[index] };
    }

    const bondValenceSum = heavyNeighbors[index].reduce(
      (sum, [, order]) => sum + bondOrderValue(order),
      0,
    );
    const implicitH = Math.max(
      0,
      Math.round(standardValence - bondValenceSum),
    );
    const attachedH = implicitH + explicitHNeighborCount[index];

    return { index, element: atom.element, attachedH, heavyNeighbors: heavyNeighbors[index] };
  });

  const totalH =
    (elementCounts.H ?? 0) +
    atoms.reduce((sum, a) => sum + (a.element !== "H" ? (a.attachedH ?? 0) : 0), 0);

  const formulaCounts: Record<string, number> = { ...elementCounts, H: totalH };
  delete formulaCounts.__proto__;

  let molecularWeight = 0;
  for (const [element, count] of Object.entries(formulaCounts)) {
    const weight = ATOMIC_WEIGHT[element];
    if (weight === undefined) {
      hasUnsupportedElement = true;
      continue;
    }
    molecularWeight += weight * count;
  }

  return {
    atoms,
    formula: formatFormula(formulaCounts),
    molecularWeight: Math.round(molecularWeight * 10) / 10,
    hasUnsupportedElement,
  };
}

function formatFormula(counts: Record<string, number>): string {
  const order = ["C", "H"];
  const rest = Object.keys(counts)
    .filter((el) => !order.includes(el) && counts[el] > 0)
    .sort();
  const parts: string[] = [];
  for (const el of [...order, ...rest]) {
    const n = counts[el] ?? 0;
    if (n <= 0) continue;
    parts.push(n === 1 ? el : `${el}${n}`);
  }
  return parts.join("");
}

/**
 * 位相的な等価クラス(対称性)を、隣接原子の色によるイテレーティブな精緻化
 * (Morgan算法系)で計算する。同じクラス番号を持つ原子は構造上区別できない
 * (=同一シグナルとして観測されうる)ことを意味する。
 *
 * 制限: 立体中心近傍のジアステレオトピックな水素(位相的には等価だが実際の
 * NMRでは異なるシグナルになりうる)は区別できない。この関数は「純粋なグラフ
 * としての対称性」のみを返す。
 */
export function computeEquivalenceClasses(graph: MoleculeGraph): number[] {
  const n = graph.atoms.length;
  const key = (a: AtomInfo) => `${a.element}:${a.attachedH ?? "?"}`;

  let ranks = internStrings(graph.atoms.map(key));

  for (let iter = 0; iter < n; iter++) {
    const nextKeys = graph.atoms.map((atom) => {
      const neighborSignature = atom.heavyNeighbors
        .map(([nbrIdx, order]) => `${order}:${ranks[nbrIdx]}`)
        .sort()
        .join(",");
      return `${ranks[atom.index]}|${neighborSignature}`;
    });
    const nextRanks = internStrings(nextKeys);
    if (nextRanks.every((r, i) => r === ranks[i])) {
      ranks = nextRanks;
      break;
    }
    ranks = nextRanks;
  }

  return ranks;
}

function internStrings(values: string[]): number[] {
  const map = new Map<string, number>();
  return values.map((v) => {
    let id = map.get(v);
    if (id === undefined) {
      id = map.size;
      map.set(v, id);
    }
    return id;
  });
}

export interface CarbonTypeCounts {
  /** 位相的に異なるCH3環境の数 */
  ch3: number;
  /** 位相的に異なるCH2環境の数 */
  ch2: number;
  /** 位相的に異なるCH環境の数(芳香族・アルケンのCHも含む) */
  ch: number;
  /** 位相的に異なるCq(H非結合炭素)環境の数 */
  cq: number;
}

export function countCarbonTypesByEquivalence(
  graph: MoleculeGraph,
): CarbonTypeCounts | null {
  if (graph.hasUnsupportedElement) return null;
  const ranks = computeEquivalenceClasses(graph);
  const byBucket: Record<"ch3" | "ch2" | "ch" | "cq", Set<number>> = {
    ch3: new Set(),
    ch2: new Set(),
    ch: new Set(),
    cq: new Set(),
  };
  for (const atom of graph.atoms) {
    if (atom.element !== "C" || atom.attachedH === null) continue;
    const rank = ranks[atom.index];
    if (atom.attachedH === 3) byBucket.ch3.add(rank);
    else if (atom.attachedH === 2) byBucket.ch2.add(rank);
    else if (atom.attachedH === 1) byBucket.ch.add(rank);
    else if (atom.attachedH === 0) byBucket.cq.add(rank);
  }
  return {
    ch3: byBucket.ch3.size,
    ch2: byBucket.ch2.size,
    ch: byBucket.ch.size,
    cq: byBucket.cq.size,
  };
}

/** 位相的に異なる炭素環境の総数(¹³C NMRの本数と比較するための値) */
export function countDistinctCarbonEnvironments(
  graph: MoleculeGraph,
): number | null {
  const counts = countCarbonTypesByEquivalence(graph);
  if (!counts) return null;
  return counts.ch3 + counts.ch2 + counts.ch + counts.cq;
}

/**
 * COSYのスピン系(島)の構成を計算する。
 * 「Hを持つ炭素同士が結合している」グラフの連結成分を取り、各成分に属する
 * 炭素の水素数の合計を、その島のサイズとする(3JHH vicinal coupling の
 * 連鎖に相当。ヘテロ原子上のH(OH/NH/COOHなど)や第四級炭素で経路が
 * 切れる点は、これまでの全問題の設計方針と一致する)。
 */
export function computeSpinSystemIslands(graph: MoleculeGraph): number[] | null {
  if (graph.hasUnsupportedElement) return null;
  const protonated = graph.atoms.filter(
    (a) => a.element === "C" && (a.attachedH ?? 0) > 0,
  );
  const protonatedIds = new Set(protonated.map((a) => a.index));
  const visited = new Set<number>();
  const islands: number[] = [];

  for (const atom of protonated) {
    if (visited.has(atom.index)) continue;
    let totalH = 0;
    const stack = [atom.index];
    visited.add(atom.index);
    while (stack.length > 0) {
      const cur = stack.pop();
      if (cur === undefined) break;
      const curAtom = graph.atoms[cur];
      totalH += curAtom.attachedH ?? 0;
      for (const [nbrIdx] of curAtom.heavyNeighbors) {
        if (!protonatedIds.has(nbrIdx) || visited.has(nbrIdx)) continue;
        visited.add(nbrIdx);
        stack.push(nbrIdx);
      }
    }
    islands.push(totalH);
  }

  return islands.sort((a, b) => b - a);
}
