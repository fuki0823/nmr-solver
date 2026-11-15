import type { AtomInfo, MoleculeGraph } from "../moleculeGraph";

/**
 * 候補構造の各原子について「この局所構造ならシフトはこの範囲に出うる」という
 * 範囲を返し、実測ピークを範囲内の原子へ1対1で割り当てる(2部グラフの最大
 * マッチング)ためのモジュール。シフト予測(DFT/HOSE code等)は行わない。
 *
 * chemicalEnvironment.ts のバケット分類は境界が排他的(例: δ190未満は
 * 「エステル/アミド」)なため、境界をまたぐ典型的な官能基(キノンC=O
 * δ180-190、フェノール/アリールエーテルのC-O δ150-165、アノマーH δ4.5-5.5
 * 等)を持つ正しい構造を不当に減点していた。ここでは範囲の重なりを許し、
 * 「実測ピークをすべて矛盾なく原子に対応付けられるか」で評価する。
 * 範囲は一般的な有機化学の教科書的な値に、余裕を持たせて設定している。
 */

export interface ShiftRange {
  lo: number;
  hi: number;
  /** 表示用の簡単な説明 */
  label: string;
}

const HETERO = new Set(["O", "N", "S", "F", "Cl", "Br", "I", "P"]);
// C-O と同程度に強く脱遮蔽する置換基として扱う元素
const O_LIKE = new Set(["O", "F", "Cl", "Br"]);

interface LocalEnv {
  /** 単結合のO(またはハロゲン)の数 */
  singleO: number;
  /** 単結合のNの数 */
  singleN: number;
  /** 単結合のS/I/Pの数 */
  singleOtherHetero: number;
  doubleToO: boolean;
  doubleToN: boolean;
  doubleToS: boolean;
  doubleToC: boolean;
  aromatic: boolean;
  /** 芳香族結合でN/O/Sと隣接(ピリジン、フラン等の環内ヘテロ原子) */
  aromaticToHetero: boolean;
  triple: boolean;
  tripleToN: boolean;
}

/**
 * 芳香環に属する原子の集合。PubChem等のSMILESはケクレ構造(単結合/二重結合の
 * 交互表記)で、芳香族結合(order 4)を使わないことが多いため、環構造から判定する:
 *  - 6員環: 環内の全原子がC/Nで、各原子が環内の隣接原子と二重結合(または
 *    芳香族結合)を持つ(ベンゼン、ピリジン、縮環系のナフタレン等)
 *  - 5員環: 4原子が環内の二重結合を持ち、残り1原子がO/N/S(フラン、ピロール、
 *    チオフェン、イミダゾール等)
 * キノンや環外C=Oを持つ環は条件を満たさないため、芳香族とみなさない。
 */
const aromaticCache = new WeakMap<MoleculeGraph, Set<number>>();

function findSmallRings(graph: MoleculeGraph): number[][] {
  const rings: number[][] = [];
  const seen = new Set<string>();
  const n = graph.atoms.length;
  for (let start = 0; start < n; start++) {
    const path = [start];
    const onPath = new Set([start]);
    const dfs = (current: number) => {
      for (const [next] of graph.atoms[current].heavyNeighbors) {
        if (next === start && path.length >= 5) {
          const key = [...path].sort((a, b) => a - b).join(",");
          if (!seen.has(key)) {
            seen.add(key);
            rings.push([...path]);
          }
          continue;
        }
        // 開始原子を環内で最小のindexに固定して重複探索を抑える
        if (next <= start || onPath.has(next) || path.length >= 6) continue;
        path.push(next);
        onPath.add(next);
        dfs(next);
        path.pop();
        onPath.delete(next);
      }
    };
    dfs(start);
  }
  return rings;
}

export function findAromaticAtoms(graph: MoleculeGraph): Set<number> {
  const cached = aromaticCache.get(graph);
  if (cached) return cached;
  const aromatic = new Set<number>();
  for (const atom of graph.atoms) {
    if (atom.heavyNeighbors.some(([, order]) => order === 4)) aromatic.add(atom.index);
  }
  for (const ring of findSmallRings(graph)) {
    const inRing = new Set(ring);
    const hasRingPi = (idx: number) =>
      graph.atoms[idx].heavyNeighbors.some(
        ([nbr, order]) => inRing.has(nbr) && (order === 2 || order === 4),
      );
    const withPi = ring.filter(hasRingPi);
    const without = ring.filter((idx) => !hasRingPi(idx));
    const isAromatic =
      ring.length === 6
        ? without.length === 0 && ring.every((idx) => ["C", "N"].includes(graph.atoms[idx].element))
        : withPi.length === 4 &&
          without.length === 1 &&
          ["O", "N", "S"].includes(graph.atoms[without[0]].element);
    if (isAromatic) for (const idx of ring) aromatic.add(idx);
  }
  aromaticCache.set(graph, aromatic);
  return aromatic;
}

function localEnv(graph: MoleculeGraph, atom: AtomInfo): LocalEnv {
  const env: LocalEnv = {
    singleO: 0,
    singleN: 0,
    singleOtherHetero: 0,
    doubleToO: false,
    doubleToN: false,
    doubleToS: false,
    doubleToC: false,
    aromatic: false,
    aromaticToHetero: false,
    triple: false,
    tripleToN: false,
  };
  if (findAromaticAtoms(graph).has(atom.index)) env.aromatic = true;
  for (const [idx, order] of atom.heavyNeighbors) {
    const el = graph.atoms[idx]?.element;
    if (!el) continue;
    if (order === 1) {
      if (O_LIKE.has(el)) env.singleO++;
      else if (el === "N") env.singleN++;
      else if (HETERO.has(el)) env.singleOtherHetero++;
    } else if (order === 2) {
      if (el === "O") env.doubleToO = true;
      else if (el === "N") env.doubleToN = true;
      else if (el === "S") env.doubleToS = true;
      else if (el === "C") env.doubleToC = true;
    } else if (order === 3) {
      env.triple = true;
      if (el === "N") env.tripleToN = true;
    } else if (order === 4) {
      env.aromatic = true;
      if (HETERO.has(el)) env.aromaticToHetero = true;
    }
  }
  return env;
}

/** sp2/sp炭素(芳香族、C=C、C=O、C=N、C≡X)か */
function isUnsaturatedCarbon(graph: MoleculeGraph, idx: number): boolean {
  const atom = graph.atoms[idx];
  if (!atom || atom.element !== "C") return false;
  return atom.heavyNeighbors.some(([, order]) => order >= 2);
}

function hasUnsaturatedCarbonNeighbor(graph: MoleculeGraph, atom: AtomInfo): boolean {
  return atom.heavyNeighbors.some(([idx]) => isUnsaturatedCarbon(graph, idx));
}

export function expectedCarbonRange(graph: MoleculeGraph, atom: AtomInfo): ShiftRange {
  const e = localEnv(graph, atom);
  const singleHetero = e.singleO + e.singleN + e.singleOtherHetero;

  if (e.tripleToN) return { lo: 108, hi: 125, label: "ニトリル" };
  if (e.triple) return { lo: 60, hi: 95, label: "アルキン" };

  if (e.doubleToO || e.doubleToS) {
    if (singleHetero > 0) return { lo: 145, hi: 185, label: "エステル/酸/アミド C=O" };
    if (hasUnsaturatedCarbonNeighbor(graph, atom)) {
      return { lo: 175, hi: 205, label: "共役ケトン/キノン C=O" };
    }
    return { lo: 190, hi: 225, label: "ケトン/アルデヒド C=O" };
  }
  if (e.doubleToN) return { lo: 140, hi: 175, label: "C=N" };

  if (e.aromatic || e.doubleToC) {
    // 炭素の範囲は芳香族とアルケンでほぼ重なるため同じ値を使い、ラベルだけ分ける
    const kind = e.aromatic ? "芳香族" : "アルケン";
    if (e.singleO > 0) return { lo: 135, hi: 172, label: `${kind} C-O` };
    if (e.singleN > 0 || e.aromaticToHetero) {
      return { lo: 110, hi: 170, label: `${kind} C-N` };
    }
    return { lo: 95, hi: 160, label: kind };
  }

  // sp3
  if (e.singleO >= 2) return { lo: 85, hi: 120, label: "アセタール" };
  if (e.singleO === 1) return { lo: 45, hi: 92, label: "sp3 C-O" };
  if (e.singleN > 0) return { lo: 25, hi: 75, label: "sp3 C-N" };
  if (e.singleOtherHetero > 0) return { lo: 5, hi: 60, label: "sp3 C-S等" };
  return { lo: -5, hi: 60, label: "脂肪族" };
}

/** その原子に結合したHの化学シフト範囲。Hを持たない原子はnull */
export function expectedProtonRange(graph: MoleculeGraph, atom: AtomInfo): ShiftRange | null {
  if (!atom.attachedH) return null;
  if (atom.element === "O") return { lo: 0.5, hi: 16, label: "OH" };
  if (atom.element === "N") return { lo: 0.5, hi: 12, label: "NH" };
  if (atom.element === "S") return { lo: 0.5, hi: 5, label: "SH" };
  if (atom.element !== "C") return null;

  const e = localEnv(graph, atom);
  if (e.doubleToO) return { lo: 7.8, hi: 10.8, label: "アルデヒド/ホルミル H" };
  if (e.doubleToN) return { lo: 6.5, hi: 9.5, label: "CH=N" };
  if (e.triple) return { lo: 1.7, hi: 3.4, label: "アルキン H" };
  // 芳香族Hとアルケン Hは範囲が大きく異なる(アルケン Hはδ5前後が多く、
  // 芳香族Hはフェノールのオルト位等でもδ6前後より低磁場)ため分けて扱う。
  if (e.aromatic) return { lo: 5.9, hi: 9.6, label: "芳香族 H" };
  if (e.doubleToC) return { lo: 4.4, hi: 8.0, label: "アルケン H" };

  if (e.singleO >= 2) return { lo: 4.2, hi: 6.4, label: "アセタール H" };
  if (e.singleO === 1) return { lo: 3.0, hi: 5.7, label: "O-CH" };
  if (e.singleN > 0) return { lo: 2.0, hi: 4.6, label: "N-CH" };
  if (e.singleOtherHetero > 0) return { lo: 1.7, hi: 3.6, label: "S-CH等" };
  if (hasUnsaturatedCarbonNeighbor(graph, atom)) {
    return { lo: 1.5, hi: 3.7, label: "ベンジル/アリル/α-カルボニル H" };
  }
  return { lo: -0.5, hi: 2.6, label: "脂肪族 H" };
}

/**
 * 2部グラフの最大マッチング(増加路法)。left[i] を right[j] に割り当てて
 * よいかを canMatch で与える。サイズは高々数百程度なので単純なDFSで十分。
 * 戻り値は left 側の割当先(割り当てられなければ -1)。
 */
export function maxBipartiteMatching(
  leftCount: number,
  rightCount: number,
  canMatch: (left: number, right: number) => boolean,
): number[] {
  const adj: number[][] = [];
  for (let i = 0; i < leftCount; i++) {
    const row: number[] = [];
    for (let j = 0; j < rightCount; j++) if (canMatch(i, j)) row.push(j);
    adj.push(row);
  }
  const matchRight = new Array<number>(rightCount).fill(-1);
  const matchLeft = new Array<number>(leftCount).fill(-1);

  const tryAssign = (i: number, seen: boolean[]): boolean => {
    for (const j of adj[i]) {
      if (seen[j]) continue;
      seen[j] = true;
      if (matchRight[j] < 0 || tryAssign(matchRight[j], seen)) {
        matchRight[j] = i;
        matchLeft[i] = j;
        return true;
      }
    }
    return false;
  };

  for (let i = 0; i < leftCount; i++) {
    tryAssign(i, new Array<boolean>(rightCount).fill(false));
  }
  return matchLeft;
}

export function inRange(shift: number, range: ShiftRange): boolean {
  return shift >= range.lo && shift <= range.hi;
}

/**
 * 割り当てられなかった割合(0〜1)から、化学シフトの整合性スコア(0〜1)を出す。
 * 割り当て不能なピーク/水素は「その構造ではあり得ない」ことの直接の証拠なので、
 * 割合をそのまま引く(例: 15%不一致 → 0.85)と、構造がまるで違う候補でも
 * 高得点になってしまう。そこで不一致の割合の3倍を減点する
 * (5% → 0.85、15% → 0.55、33%以上 → 0)。
 */
export function shiftConsistencyScore(unmatchedFraction: number): number {
  return Math.max(0, 1 - 3 * unmatchedFraction);
}
