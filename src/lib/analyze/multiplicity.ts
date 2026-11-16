import type { MoleculeGraph } from "../moleculeGraph";
import { findAromaticAtoms } from "./shiftRanges";

/**
 * ¹H の多重度(s, d, t, q, dd, m など)と、候補構造の原子上のHの整合性を判定する。
 *
 * 一次の分裂(n+1則)では、多重線の形からカップリング相手のHの数の下限が分かる
 * (d: 1個以上、t: 2個以上、dd: 2個以上、q: 3個以上 …)。s(一重線)は、
 * 隣接する炭素(³J の相手)にHが無いことを意味する。
 *
 * 候補原子X上のHのカップリング相手は次のように数える。
 *  - certain: Xに隣接する炭素上のH(³JHH、必ずカップリングする)
 *  - possible: certain に加え、隣接するOH/NH(DMSO等では分裂する)、
 *    同じCH2の他方のH(ジアステレオトピックなら²J)、芳香環・アルケンでの
 *    ⁴J(メタ位・アリル位、1–3 Hz)
 * 判定:
 *  - s           : メチル基は certain = 0。それ以外は certain ≤ 1(二面角が90°付近だと
 *                  ³J がほぼ0になり、隣接Hが1個あっても一重線に見える。例: キニジンのH9)
 *  - d/t/q/dd …  : possible ≥ 多重線から決まる下限
 *  - m / br s / 記載なし: 判定しない(m は複数のHが重なった領域の記載であることが多く、
 *                  メチル基の一重線が含まれることもあるため)
 * メチル基(CH3)は相手が隣接炭素のHに限られる(ジェミナルは等価、⁴Jは通常
 * 分離しない)ため、s/d/t/q を厳密に判定する(d=隣がCH、t=CH2、q=CH3)。
 * ただしアリル位のメチルは⁴J(約1 Hz)で d に見えることがあるので許す。
 */

export interface ParsedMultiplicity {
  kind: "singlet" | "pattern" | "multiplet" | "unknown";
  /** pattern のとき、多重線から決まるカップリング相手の数の下限 */
  minPartners: number;
  /** メチル基の判定に使う、単純な多重線(d/t/q/quint/sext/sept)の相手の数 */
  simplePartners: number | null;
}

const PARTNERS_BY_LETTER: Record<string, number> = { d: 1, t: 2, q: 3 };
const NAMED: Record<string, number> = { quint: 4, quin: 4, qn: 4, qui: 4, p: 4, pent: 4, sext: 5, sex: 5, sept: 6, hept: 6 };

export function parseMultiplicity(raw: string | undefined): ParsedMultiplicity {
  const unknown: ParsedMultiplicity = { kind: "unknown", minPartners: 0, simplePartners: null };
  if (!raw) return unknown;
  const m = raw.trim().toLowerCase().replace(/\s+/g, " ");
  if (m === "") return unknown;
  // 幅広いシグナルは交換性Hや未分離のカップリングを含みうるため判定しない
  if (m.startsWith("br") || m === "?" || m === ".") return unknown;
  if (m === "s") return { kind: "singlet", minPartners: 0, simplePartners: 0 };
  if (m === "m" || m === "mult" || m === "multiplet") return { kind: "multiplet", minPartners: 1, simplePartners: null };
  if (NAMED[m] != null) return { kind: "pattern", minPartners: NAMED[m], simplePartners: NAMED[m] };
  if (/^[dtq]+$/.test(m)) {
    // dd, dt, ddd, dq … : 文字ごとに異なるカップリング定数の組
    const min = [...m].reduce((sum, ch) => sum + PARTNERS_BY_LETTER[ch], 0);
    return { kind: "pattern", minPartners: min, simplePartners: m.length === 1 ? min : null };
  }
  return unknown;
}

export interface CouplingPartners {
  /** 隣接炭素上のH(³J、必ずカップリングする) */
  certain: number;
  /** certain + 隣接OH/NH + ジェミナル + ⁴J(芳香環・アルケン) */
  possible: number;
  /** ⁴J(メタ位・アリル位)の相手の数 */
  longRange: number;
  isMethyl: boolean;
}

const partnerCache = new WeakMap<MoleculeGraph, CouplingPartners[]>();

export function couplingPartners(graph: MoleculeGraph): CouplingPartners[] {
  const cached = partnerCache.get(graph);
  if (cached) return cached;
  const aromatic = findAromaticAtoms(graph);
  const isSp2 = (i: number) =>
    aromatic.has(i) || graph.atoms[i].heavyNeighbors.some(([, order]) => order === 2 || order === 4);
  const result = graph.atoms.map((atom) => {
    const h = atom.attachedH ?? 0;
    let certain = 0;
    let heteroNeighborH = 0;
    let longRange = 0;
    const neighbors = atom.heavyNeighbors.map(([n]) => n);
    for (const n of neighbors) {
      const nb = graph.atoms[n];
      if (nb.element === "C") certain += nb.attachedH ?? 0;
      else heteroNeighborH += nb.attachedH ?? 0;
    }
    // ⁴J: Xまたは間の原子がsp2(芳香環のメタ位、アリル位)の場合のみ数える
    if (atom.element === "C") {
      for (const n of neighbors) {
        if (!isSp2(atom.index) && !isSp2(n)) continue;
        for (const [m2] of graph.atoms[n].heavyNeighbors) {
          if (m2 === atom.index || neighbors.includes(m2)) continue;
          if (graph.atoms[m2].element === "C") longRange += graph.atoms[m2].attachedH ?? 0;
        }
      }
    }
    // ジェミナル(²J)はCH2の2個のHがジアステレオトピックな場合だけ。メチル基の3個のHは
    // 等価なので互いに分裂を生じない。
    const geminal = h === 2 ? 1 : 0;
    return {
      certain,
      possible: certain + heteroNeighborH + geminal + longRange,
      longRange,
      isMethyl: atom.element === "C" && h === 3,
    };
  });
  partnerCache.set(graph, result);
  return result;
}

/** 観測された多重度が、原子 atomIndex 上のHとして説明できるか */
export function multiplicityCompatible(
  mult: ParsedMultiplicity,
  partners: CouplingPartners,
): boolean {
  switch (mult.kind) {
    case "unknown":
      return true;
    case "singlet":
      return partners.isMethyl ? partners.certain === 0 : partners.certain <= 1;
    case "multiplet":
      return true;
    case "pattern":
      if (partners.isMethyl && mult.simplePartners != null) {
        if (mult.simplePartners === partners.certain) return true;
        // アリル位メチルの⁴J(約1 Hz)による d
        return mult.simplePartners === 1 && partners.certain === 0 && partners.longRange >= 1;
      }
      return partners.possible >= mult.minPartners;
  }
}
