import { computeEquivalenceClasses, type MoleculeGraph } from "../../moleculeGraph";
import {
  carbonBucketFromShift,
  classifyCarbonBucket,
  protonBucketForCarbonBucket,
  protonBucketFromShift,
  type CarbonBucket,
} from "../chemicalEnvironment";
import type { AnalysisInput } from "../types";

/**
 * 入力ピーク(SpectralPeak)を候補構造の原子に割り当てるモジュール。
 *
 * これはLearn モードの「提出された(間違っているかもしれない)構造の
 * どの原子がH-12なのか」という一般には解けない問題とは異なる。Analyze
 * モードでは候補構造は固定(既知)であり、割り当てるべきなのは曖昧な
 * ラベルを持つ入力ピーク側なので、候補構造の位相的な等価クラス
 * (`computeEquivalenceClasses`)とδ値のバケット分類だけで、決定論的かつ
 * 現実的な精度の割当が可能になる。
 *
 * ただし本質的に推定(近似)であることは変わらないため、各割当には
 * confidence("high"/"low")を付与し、下流のvalidatorはconfidenceが低い
 * 割当に基づく判定を断定的にしないようにする。
 */

export interface PeakAtomAssignment {
  atomIndex: number;
  confidence: "high" | "low";
}

export interface PeakAssignment {
  byPeakId: Map<string, PeakAtomAssignment>;
}

interface CarbonClassInfo {
  rank: number;
  atoms: number[];
  bucket: CarbonBucket;
  attachedH: number;
}

const BUCKET_ORDER: CarbonBucket[] = [
  "carbonyl",
  "carboxylOrAmide",
  "aromaticOrAlkene",
  "oxygenatedSp3",
  "aliphatic",
];

export function assignPeaks(
  input: AnalysisInput,
  candidateGraph: MoleculeGraph,
): PeakAssignment {
  const byPeakId = new Map<string, PeakAtomAssignment>();
  if (candidateGraph.hasUnsupportedElement) return { byPeakId };

  const ranks = computeEquivalenceClasses(candidateGraph);
  const classByRank = new Map<number, CarbonClassInfo>();
  for (const atom of candidateGraph.atoms) {
    if (atom.element !== "C") continue;
    const rank = ranks[atom.index];
    let info = classByRank.get(rank);
    if (!info) {
      info = {
        rank,
        atoms: [],
        bucket: classifyCarbonBucket(candidateGraph, atom),
        attachedH: atom.attachedH ?? 0,
      };
      classByRank.set(rank, info);
    }
    info.atoms.push(atom.index);
  }
  const classInfos = Array.from(classByRank.values());

  // --- 13C peaks を bucket 単位で位置的に割り当てる ---
  const usedRanks = new Set<number>();
  const carbonPeakToClassRank = new Map<string, number>();
  const carbonPeaks = input.peaks
    .filter((p) => p.nucleus === "13C")
    .sort((a, b) => b.shift - a.shift);

  for (const bucket of BUCKET_ORDER) {
    const peaksInBucket = carbonPeaks.filter(
      (p) => carbonBucketFromShift(p.shift) === bucket,
    );
    const classesInBucket = classInfos
      .filter((c) => c.bucket === bucket && !usedRanks.has(c.rank))
      .sort((a, b) => b.attachedH - a.attachedH);
    const exactSizeMatch = peaksInBucket.length === classesInBucket.length;
    const n = Math.min(peaksInBucket.length, classesInBucket.length);
    for (let i = 0; i < n; i++) {
      const peak = peaksInBucket[i];
      const cls = classesInBucket[i];
      usedRanks.add(cls.rank);
      carbonPeakToClassRank.set(peak.id, cls.rank);
      byPeakId.set(peak.id, {
        atomIndex: cls.atoms[0],
        confidence: exactSizeMatch ? "high" : "low",
      });
    }
  }

  // --- 1H peaks: まずHSQCで対になっている13Cの割当を継承する ---
  const hsqcPartnerOf = new Map<string, string>();
  for (const corr of input.correlations) {
    if (corr.kind !== "HSQC") continue;
    const fromPeak = input.peaks.find((p) => p.id === corr.from);
    const toPeak = input.peaks.find((p) => p.id === corr.to);
    const protonPeak =
      fromPeak?.nucleus === "1H" ? fromPeak : toPeak?.nucleus === "1H" ? toPeak : undefined;
    const carbonPeak =
      fromPeak?.nucleus === "13C" ? fromPeak : toPeak?.nucleus === "13C" ? toPeak : undefined;
    if (protonPeak && carbonPeak) hsqcPartnerOf.set(protonPeak.id, carbonPeak.id);
  }

  const protonPeaks = input.peaks.filter((p) => p.nucleus === "1H");
  for (const proton of protonPeaks) {
    const carbonId = hsqcPartnerOf.get(proton.id);
    if (!carbonId) continue;
    const carbonAssignment = byPeakId.get(carbonId);
    if (carbonAssignment) {
      byPeakId.set(proton.id, {
        atomIndex: carbonAssignment.atomIndex,
        confidence: carbonAssignment.confidence,
      });
    }
  }

  // --- HSQCの相手がない1Hは、shiftバケットで空いている炭素へ低信頼度で割当 ---
  const remainingProtons = protonPeaks
    .filter((p) => !byPeakId.has(p.id))
    .sort((a, b) => b.shift - a.shift);
  for (const proton of remainingProtons) {
    const targetBucket = protonBucketFromShift(proton.shift);
    const candidate = classInfos.find(
      (c) => c.attachedH > 0 && protonBucketForCarbonBucket(c.bucket) === targetBucket,
    );
    if (candidate) {
      byPeakId.set(proton.id, { atomIndex: candidate.atoms[0], confidence: "low" });
    }
  }

  return { byPeakId };
}
