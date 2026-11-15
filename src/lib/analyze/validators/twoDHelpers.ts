import type { MoleculeGraph } from "../../moleculeGraph";
import { expectedCarbonRange, expectedProtonRange, type ShiftRange } from "../shiftRanges";
import type { AnalysisInput, SpectralPeak } from "../types";

/**
 * 2D NMR(HSQC/HMBC/COSY)の検証で共通に使う、割当に依存しない判定の部品。
 *
 * 以前は assignPeaks(シフト領域ごとに観測ピークと候補原子を「並び順で」
 * 機械的にペアリングする近似)の結果を使っていたが、この仮の割当が外れると
 * 正しい構造でも「第四級炭素とHSQC相関している」等の誤ったハード制約違反に
 * なっていた(例: ビタミンD3、ルテオリン、エリスロマイシンが除外された)。
 * ここでは「そのピークを説明できる原子が候補構造中に存在するか」を
 * shiftRanges の範囲で調べ、特定の割当を仮定しない。
 */

/** ハード制約の判定にだけ使う、範囲の拡張幅。範囲の端の誤差で正解を除外しないため */
const HARD_WIDEN = { C: 8, H: 0.8 };

function widen(range: ShiftRange, by: number): ShiftRange {
  return { ...range, lo: range.lo - by, hi: range.hi + by };
}

function inRange(shift: number, range: ShiftRange | null): boolean {
  return range != null && shift >= range.lo && shift <= range.hi;
}

export interface GraphShiftModel {
  graph: MoleculeGraph;
  carbonRange: (ShiftRange | null)[];
  protonRange: (ShiftRange | null)[];
  /** 全原子間の結合数(到達不能は Infinity) */
  distance: number[][];
}

const modelCache = new WeakMap<MoleculeGraph, GraphShiftModel>();

export function shiftModel(graph: MoleculeGraph): GraphShiftModel {
  const cached = modelCache.get(graph);
  if (cached) return cached;
  const n = graph.atoms.length;
  const distance: number[][] = [];
  for (let s = 0; s < n; s++) {
    const d = new Array<number>(n).fill(Infinity);
    d[s] = 0;
    const queue = [s];
    for (let q = 0; q < queue.length; q++) {
      const cur = queue[q];
      for (const [nbr] of graph.atoms[cur].heavyNeighbors) {
        if (d[nbr] !== Infinity) continue;
        d[nbr] = d[cur] + 1;
        queue.push(nbr);
      }
    }
    distance.push(d);
  }
  const model: GraphShiftModel = {
    graph,
    carbonRange: graph.atoms.map((a) => (a.element === "C" ? expectedCarbonRange(graph, a) : null)),
    protonRange: graph.atoms.map((a) => expectedProtonRange(graph, a)),
    distance,
  };
  modelCache.set(graph, model);
  return model;
}

/** ¹³Cシフトを説明できる炭素原子 */
export function carbonsFor(model: GraphShiftModel, shift: number, opts: { widen?: boolean; protonated?: boolean } = {}): number[] {
  const out: number[] = [];
  model.graph.atoms.forEach((a, i) => {
    const r = model.carbonRange[i];
    if (!r) return;
    if (opts.protonated && !(a.attachedH ?? 0)) return;
    if (inRange(shift, opts.widen ? widen(r, HARD_WIDEN.C) : r)) out.push(i);
  });
  return out;
}

/** ¹Hシフトを説明できる「Hを持つ原子」(炭素・ヘテロ原子) */
export function protonHostsFor(model: GraphShiftModel, shift: number, opts: { widen?: boolean } = {}): number[] {
  const out: number[] = [];
  model.protonRange.forEach((r, i) => {
    if (!r) return;
    if (inRange(shift, opts.widen ? widen(r, HARD_WIDEN.H) : r)) out.push(i);
  });
  return out;
}

/** HSQCで直接結合しているとみなせるか(炭素がHを持ち、両方のシフトが範囲内) */
export function hsqcExplains(model: GraphShiftModel, atom: number, hShift: number, cShift: number, wide = false): boolean {
  const a = model.graph.atoms[atom];
  if (a.element !== "C" || !(a.attachedH ?? 0)) return false;
  const cr = model.carbonRange[atom];
  const hr = model.protonRange[atom];
  if (!cr || !hr) return false;
  return inRange(cShift, wide ? widen(cr, HARD_WIDEN.C) : cr) && inRange(hShift, wide ? widen(hr, HARD_WIDEN.H) : hr);
}

export function peakById(input: AnalysisInput, id: string): SpectralPeak | undefined {
  return input.peaks.find((p) => p.id === id);
}

/** ¹HピークIDに対し、HSQCで相関している¹³Cピークのシフト一覧 */
export function hsqcCarbonShiftsOf(input: AnalysisInput, protonPeakId: string): number[] {
  const out: number[] = [];
  for (const c of input.correlations) {
    if (c.kind !== "HSQC") continue;
    const other = c.from === protonPeakId ? c.to : c.to === protonPeakId ? c.from : null;
    if (!other) continue;
    const p = peakById(input, other);
    if (p?.nucleus === "13C") out.push(p.shift);
  }
  return out;
}

/**
 * ¹Hピークを担いうる原子(Hを持つ原子)。HSQCの相関先があれば、その¹³Cシフトも
 * 説明できる炭素に限定する(HSQCで炭素が分かっているHは、その炭素上のHだから)。
 */
export function protonHostsWithHsqc(model: GraphShiftModel, input: AnalysisInput, protonPeak: SpectralPeak, wide = false): number[] {
  const hosts = protonHostsFor(model, protonPeak.shift, { widen: wide });
  const carbonShifts = hsqcCarbonShiftsOf(input, protonPeak.id);
  if (carbonShifts.length === 0) return hosts;
  return hosts.filter((i) => carbonShifts.some((cs) => hsqcExplains(model, i, protonPeak.shift, cs, wide)));
}

/** H-X…C の nJCH(X=Hを持つ原子)。HがXに付いているので結合数+1 */
export function nJ(model: GraphShiftModel, hostAtom: number, targetAtom: number): number {
  return model.distance[hostAtom][targetAtom] + 1;
}
