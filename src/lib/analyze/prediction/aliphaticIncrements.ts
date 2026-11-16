import type { MoleculeGraph } from "../../moleculeGraph";
import { findAromaticAtoms } from "../shiftRanges";

/**
 * sp3 炭素の ¹³C シフトを、Grant–Paul 型の加成則とヘテロ原子置換基の増分で予測する。
 *
 *   δ(Ck) = −2.3 + Σ 炭素の増分(α +9.1, β +9.4, γ −2.5, δ +0.3)
 *                + Σ 官能基の増分(α / β / γ)+ 枝分かれの補正(Grant–Paul)
 *
 * 官能基の増分は Pretsch らのアルカンの置換基の表に基づく値で、末端(n: Ck の炭素の
 * 隣接が1個以下)と内部(iso)で値を変える。官能基の増分はその先の原子の効果まで含むので、
 * 官能基の原子から先はたどらない(sp3 炭素だけをたどる)。
 *
 * 加成則が成り立たない次の炭素は予測しない(null):
 *  - ヘテロ原子が2つ以上直接付いた炭素(アセタール等。足し合わせると大きく外れる)
 *  - 3〜5員環に含まれる炭素(環のひずみの効果が大きい。シクロペンタンでも約9 ppmずれる)
 *  - α 位・β 位のヘテロ原子が合わせて3個以上ある炭素、ヘテロ原子が直接付いた第四級炭素
 *    (官能基が密集すると増分を足しすぎる。エリスロマイシンの C11 を 99 ppm と予測した。
 *    実際はδ80台)
 * 6員環に含まれる炭素は、シクロヘキサンの実測(27.1)との差の分(−5.1 ppm)を補正する。
 * 精度は ±3〜5 ppm 程度。
 */

/** [α, β, γ] の増分。n = 末端、iso = 内部 */
type Inc = { n: [number, number, number]; iso: [number, number, number] };

const GROUP: Record<string, Inc> = {
  OH: { n: [48, 10, -5], iso: [41, 8, -5] },
  OR: { n: [58, 7, -4], iso: [51, 5, -4] },
  OCOR: { n: [51, 6, -3], iso: [45, 5, -3] },
  NH2: { n: [29, 11, -5], iso: [24, 10, -5] },
  NHR: { n: [37, 8, -4], iso: [31, 6, -4] },
  NR2: { n: [42, 6, -3], iso: [36, 4, -3] },
  NHCOR: { n: [26, 8, -4], iso: [21, 7, -4] },
  NO2: { n: [63, 4, -1], iso: [57, 4, -1] },
  SH: { n: [11, 12, -4], iso: [11, 11, -4] },
  SR: { n: [20, 7, -3], iso: [16, 6, -3] },
  F: { n: [68, 9, -4], iso: [63, 6, -4] },
  Cl: { n: [31, 11, -4], iso: [32, 10, -5] },
  Br: { n: [20, 11, -3], iso: [25, 10, -3] },
  I: { n: [-6, 11, -1], iso: [4, 12, -1] },
  COR: { n: [30, 1, -2], iso: [24, 1, -2] },
  CHO: { n: [31, 0, -2], iso: [25, 0, -2] },
  COOH: { n: [21, 3, -2], iso: [16, 2, -2] },
  COOR: { n: [20, 3, -2], iso: [17, 2, -2] },
  CONR2: { n: [22, 2.5, -0.5], iso: [16, 2.5, -0.5] },
  CN: { n: [3, 2, -3], iso: [1, 2, -3] },
  VINYL: { n: [20, 7, -2], iso: [15, 6, -2] },
  PHENYL: { n: [23, 9, -2], iso: [17, 7, -2] },
};

const CARBON_INC = [9.1, 9.4, -2.5, 0.3]; // α, β, γ, δ
const SIX_RING_CORRECTION = -5.1;

/** Grant–Paul の枝分かれ補正 [観測炭素の次数][隣接炭素の次数](次数 = 炭素の隣接数、1〜4) */
const STERIC: Record<string, number> = {
  "1-3": -1.1,
  "1-4": -3.4,
  "2-3": -2.5,
  "2-4": -7.2,
  "3-2": -3.7,
  "3-3": -9.5,
  "3-4": -15.0,
  "4-1": -1.5,
  "4-2": -8.4,
  "4-3": -15.0,
  "4-4": -25.0,
};

const HETERO = new Set(["O", "N", "S", "F", "Cl", "Br", "I"]);

function isSp3Carbon(graph: MoleculeGraph, i: number, aromatic: Set<number>): boolean {
  const a = graph.atoms[i];
  return a.element === "C" && !aromatic.has(i) && a.heavyNeighbors.every(([, o]) => o === 1);
}

/** 最小の環の大きさ(環に含まれなければ Infinity)。6 まで調べれば十分 */
function smallestRing(graph: MoleculeGraph, start: number, limit = 6): number {
  let best = Infinity;
  const dfs = (cur: number, depth: number, visited: Set<number>) => {
    if (depth >= best || depth > limit) return;
    for (const [n] of graph.atoms[cur].heavyNeighbors) {
      if (n === start && depth >= 3) {
        best = Math.min(best, depth);
        continue;
      }
      if (visited.has(n)) continue;
      visited.add(n);
      dfs(n, depth + 1, visited);
      visited.delete(n);
    }
  };
  dfs(start, 1, new Set([start]));
  return best;
}

/** 官能基の種類(sub は sp3 炭素 from に直接付いた、sp3 炭素以外の原子) */
function groupOf(graph: MoleculeGraph, from: number, sub: number, aromatic: Set<number>): string | null {
  const a = graph.atoms[sub];
  const nbrs = a.heavyNeighbors.filter(([n]) => n !== from);
  const el = a.element;
  if (el === "F" || el === "Cl" || el === "Br" || el === "I") return el;
  if (el === "S") return (a.attachedH ?? 0) > 0 ? "SH" : "SR";
  if (el === "O") {
    if ((a.attachedH ?? 0) > 0) return "OH";
    const acyl = nbrs.some(([n]) => graph.atoms[n].heavyNeighbors.some(([m, o]) => o === 2 && graph.atoms[m].element === "O"));
    return acyl ? "OCOR" : "OR";
  }
  if (el === "N") {
    if (nbrs.filter(([n]) => graph.atoms[n].element === "O").length >= 2) return "NO2";
    const amide = nbrs.some(([n]) => graph.atoms[n].heavyNeighbors.some(([m, o]) => o === 2 && graph.atoms[m].element === "O"));
    if (amide) return "NHCOR";
    const h = a.attachedH ?? 0;
    return h >= 2 ? "NH2" : h === 1 ? "NHR" : "NR2";
  }
  if (el !== "C") return null;
  if (aromatic.has(sub)) return "PHENYL";
  const doubleO = nbrs.some(([n, o]) => o === 2 && graph.atoms[n].element === "O");
  if (doubleO) {
    if ((a.attachedH ?? 0) > 0) return "CHO";
    const singleO = nbrs.find(([n, o]) => o === 1 && graph.atoms[n].element === "O");
    if (singleO) return (graph.atoms[singleO[0]].attachedH ?? 0) > 0 ? "COOH" : "COOR";
    if (nbrs.some(([n, o]) => o === 1 && graph.atoms[n].element === "N")) return "CONR2";
    return "COR";
  }
  if (nbrs.some(([n, o]) => o === 3 && graph.atoms[n].element === "N")) return "CN";
  if (nbrs.some(([, o]) => o === 2 || o === 4)) return "VINYL";
  return null;
}

export function predictAliphaticCarbons(graph: MoleculeGraph): (number | null)[] {
  const aromatic = findAromaticAtoms(graph);
  const carbonDegree = (i: number) => graph.atoms[i].heavyNeighbors.filter(([n]) => graph.atoms[n].element === "C").length;
  return graph.atoms.map((atom, k) => {
    if (!isSp3Carbon(graph, k, aromatic)) return null;
    const heteroCount = atom.heavyNeighbors.filter(([n]) => HETERO.has(graph.atoms[n].element)).length;
    if (heteroCount >= 2) return null;
    // 官能基が密集した炭素(α・β 位のヘテロ原子の合計が3以上、またはヘテロ原子付きの第四級炭素)
    const betaHetero = atom.heavyNeighbors
      .filter(([n]) => graph.atoms[n].element === "C")
      .reduce(
        (sum, [n]) => sum + graph.atoms[n].heavyNeighbors.filter(([m]) => m !== k && HETERO.has(graph.atoms[m].element)).length,
        0,
      );
    if (heteroCount + betaHetero >= 3) return null;
    if (heteroCount >= 1 && (atom.attachedH ?? 0) === 0) return null;
    const ring = smallestRing(graph, k);
    if (ring <= 5) return null;
    const terminal = carbonDegree(k) <= 1;
    let shift = -2.3;
    // sp3 炭素だけをたどる幅優先探索。各経路の先の官能基・炭素に距離に応じた増分を足す
    const dist = new Map<number, number>([[k, 0]]);
    const queue = [k];
    let unsupported = false;
    for (let q = 0; q < queue.length; q++) {
      const cur = queue[q];
      const d = dist.get(cur)!;
      if (d >= 4) continue;
      for (const [n] of graph.atoms[cur].heavyNeighbors) {
        if (dist.has(n)) continue;
        dist.set(n, d + 1);
        if (isSp3Carbon(graph, n, aromatic)) {
          shift += CARBON_INC[d];
          queue.push(n);
          continue;
        }
        if (d >= 3) continue; // 官能基は γ 位まで
        const g = groupOf(graph, cur, n, aromatic);
        if (g == null) {
          unsupported = true;
          continue;
        }
        shift += (terminal ? GROUP[g].n : GROUP[g].iso)[d];
      }
    }
    if (unsupported) return null;
    // 枝分かれの補正(隣接する炭素どうし)
    const degK = Math.max(1, carbonDegree(k));
    for (const [n] of atom.heavyNeighbors) {
      if (graph.atoms[n].element !== "C") continue;
      const key = `${Math.min(degK, 4)}-${Math.min(Math.max(1, carbonDegree(n)), 4)}`;
      shift += STERIC[key] ?? 0;
    }
    // 6員環の補正: Grant–Paul の式は鎖状アルカン向けで、シクロヘキサンを 32.2 と予測する
    // (実測 27.1)。6員環に含まれる炭素はその差だけ下げる。
    if (ring === 6) shift += SIX_RING_CORRECTION;
    return Math.round(shift * 10) / 10;
  });
}
