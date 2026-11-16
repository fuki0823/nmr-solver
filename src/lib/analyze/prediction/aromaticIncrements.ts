import type { MoleculeGraph } from "../../moleculeGraph";
import { findAromaticAtoms } from "../shiftRanges";

/**
 * 置換ベンゼン環の炭素の ¹³C シフトを、置換基加成則で予測する。
 *
 *   δ(Ck) = 128.5 + Σ 置換基の増分(Ck から見た位置: ipso / ortho / meta / para)
 *
 * 増分は教科書的な値(Pretsch, Bühlmann, Badertscher "Structure Determination of
 * Organic Compounds" の一置換ベンゼンの表に基づく、CDCl3 基準)。精度は ±2〜4 ppm 程度で、
 * 隣り合う置換基どうしの立体・電子的な相互作用(例: カテコールの OH どうし)があると
 * ずれが大きくなる。
 *
 * 縮環しているベンゼン環では、相手の環の原子をそのまま「置換基」とみなす
 * (例: フラボンの A 環では、C4 側をアシル基、環内の O1 をエーテル O とする)。
 * ベンゼン環(6員環で、環内の原子がすべて炭素の芳香環)に属さない炭素は予測しない
 * (null)。ピリジン等の複素芳香環やプリンは対象外。
 */

/** 増分 [ipso, ortho, meta, para] (ppm) */
type Increment = [number, number, number, number];

const INC: Record<string, Increment> = {
  CH3: [9.3, 0.7, -0.1, -2.9],
  CH2R: [15.6, -0.5, 0.0, -2.6],
  CHR2: [20.1, -2.0, 0.0, -2.5],
  CR3: [22.1, -3.4, -0.4, -3.1],
  CH2X: [12.4, -1.2, 0.2, -1.1], // CH2OH, CH2OR, CH2N など
  VINYL: [9.1, -2.4, 0.2, -0.5],
  ARYL: [13.0, -1.1, 0.5, -1.0],
  CHO: [8.2, 1.2, 0.5, 5.8],
  COR: [8.9, 0.1, -0.1, 4.4], // ケトン
  COOH: [2.1, 1.6, -0.1, 5.2],
  COOR: [2.0, 1.2, -0.1, 4.3],
  CONR2: [5.0, -1.2, 0.1, 3.4],
  CN: [-15.7, 3.6, 0.7, 4.3],
  OH: [26.9, -12.8, 1.4, -7.4],
  OR: [31.4, -14.4, 1.0, -7.7],
  OCOR: [22.4, -7.1, -0.4, -3.2],
  NH2: [18.2, -13.4, 0.8, -10.0],
  NR2: [22.5, -15.7, 0.8, -11.8],
  NHCOR: [9.7, -8.1, 0.2, -4.4],
  NO2: [19.9, -4.9, 0.9, 6.1],
  SR: [10.2, -1.9, 0.4, -3.6],
  F: [34.8, -13.0, 1.6, -4.4],
  Cl: [6.4, 0.2, 1.0, -2.0],
  Br: [-5.4, 3.4, 2.2, -1.0],
  I: [-32.2, 9.9, 2.6, -0.4],
};

const BENZENE = 128.5;

/** 6員の全炭素芳香環(ベンゼン環)を列挙する。原子の並びは環をたどる順。 */
function benzeneRings(graph: MoleculeGraph): number[][] {
  const aromatic = findAromaticAtoms(graph);
  const rings: number[][] = [];
  const seen = new Set<string>();
  for (const start of aromatic) {
    if (graph.atoms[start].element !== "C") continue;
    const path = [start];
    const dfs = (cur: number) => {
      if (path.length === 6) {
        if (graph.atoms[cur].heavyNeighbors.some(([n]) => n === start)) {
          const key = [...path].sort((a, b) => a - b).join(",");
          if (!seen.has(key)) {
            seen.add(key);
            rings.push([...path]);
          }
        }
        return;
      }
      for (const [n] of graph.atoms[cur].heavyNeighbors) {
        if (n <= start || path.includes(n) || !aromatic.has(n) || graph.atoms[n].element !== "C") continue;
        path.push(n);
        dfs(n);
        path.pop();
      }
    };
    dfs(start);
  }
  return rings;
}

/** 環の原子 ringAtom に付いた環外の原子 sub(とその先)から、置換基の種類を決める */
function classify(graph: MoleculeGraph, ringAtom: number, sub: number, aromatic: Set<number>): string | null {
  const a = graph.atoms[sub];
  const nbrs = a.heavyNeighbors.filter(([n]) => n !== ringAtom);
  const el = a.element;
  if (el === "F" || el === "Cl" || el === "Br" || el === "I") return el;
  if (el === "S") return "SR";
  if (el === "O") {
    if ((a.attachedH ?? 0) > 0) return "OH";
    const acyl = nbrs.some(([n]) =>
      graph.atoms[n].heavyNeighbors.some(([m, o]) => o === 2 && graph.atoms[m].element === "O"),
    );
    return acyl ? "OCOR" : "OR";
  }
  if (el === "N") {
    const oxygens = nbrs.filter(([n]) => graph.atoms[n].element === "O").length;
    if (oxygens >= 2) return "NO2";
    const amide = nbrs.some(([n]) =>
      graph.atoms[n].heavyNeighbors.some(([m, o]) => o === 2 && graph.atoms[m].element === "O"),
    );
    if (amide) return "NHCOR";
    if ((a.attachedH ?? 0) >= 2) return "NH2";
    if (aromatic.has(sub)) return null; // 縮環した複素芳香環の N は対象外
    return "NR2";
  }
  if (el !== "C") return null;
  // 炭素の置換基
  if (aromatic.has(sub)) return "ARYL";
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
  if (nbrs.some(([n]) => ["O", "N", "S", "F", "Cl", "Br", "I"].includes(graph.atoms[n].element))) return "CH2X";
  const carbonNbrs = nbrs.filter(([n]) => graph.atoms[n].element === "C").length;
  return ["CH3", "CH2R", "CHR2", "CR3"][Math.min(carbonNbrs, 3)];
}

/** 各原子の予測 ¹³C シフト(ベンゼン環の炭素以外は null) */
export function predictAromaticCarbons(graph: MoleculeGraph): (number | null)[] {
  const aromatic = findAromaticAtoms(graph);
  const result: (number | null)[] = graph.atoms.map(() => null);
  for (const ring of benzeneRings(graph)) {
    const inRing = new Set(ring);
    // 環の各位置の置換基(環外の隣接原子)
    const subsAt = ring.map((atom) =>
      graph.atoms[atom].heavyNeighbors
        .filter(([n]) => !inRing.has(n))
        .map(([n]) => classify(graph, atom, n, aromatic)),
    );
    // 分類できない置換基があれば、その環は予測しない(誤った予測で減点しないため)
    if (subsAt.some((subs) => subs.some((s) => s === null))) continue;
    ring.forEach((atom, k) => {
      if (result[atom] != null) return; // 縮環で2つの環に属する場合は最初の環の予測を使う
      let shift = BENZENE;
      ring.forEach((_, j) => {
        const d = Math.min(Math.abs(j - k), 6 - Math.abs(j - k)); // 0=ipso 1=ortho 2=meta 3=para
        for (const s of subsAt[j]) shift += INC[s as string][d];
      });
      result[atom] = Math.round(shift * 10) / 10;
    });
  }
  return result;
}
