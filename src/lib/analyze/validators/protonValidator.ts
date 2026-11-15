import {
  expectedProtonRange,
  inRange,
  maxBipartiteMatching,
  shiftConsistencyScore,
  type ShiftRange,
} from "../shiftRanges";
import type { ValidationContext, ValidationDetail, ValidationResult } from "./types";

export function protonValidator(context: ValidationContext): ValidationResult {
  const { input, candidateGraph } = context;
  const peaks = input.peaks.filter((p) => p.nucleus === "1H");
  if (peaks.length === 0) {
    return { method: "1H", status: "not_evaluated", score: 0, details: [] };
  }

  const details: ValidationDetail[] = [];

  // 候補構造の水素を1個ずつ「スロット」として列挙する(どの原子上のHか、
  // そのHが出うるシフト範囲)。
  const slots: ShiftRange[] = [];
  const slotIsHetero: boolean[] = [];
  const slotAtom: number[] = [];
  let carbonBoundH = 0;
  let heteroBoundH = 0;
  for (const atom of candidateGraph.atoms) {
    const range = expectedProtonRange(candidateGraph, atom);
    if (!range || !atom.attachedH) continue;
    for (let k = 0; k < atom.attachedH; k++) {
      slots.push(range);
      slotIsHetero.push(atom.element !== "C");
      slotAtom.push(atom.index);
    }
    if (atom.element === "C") carbonBoundH += atom.attachedH;
    else heteroBoundH += atom.attachedH;
  }
  const totalH = carbonBoundH + heteroBoundH;

  // 1. 積分値の合計 vs 候補の水素数。
  // OH/NHは重水交換やブロードニングで観測されないことが多いため、
  // 「炭素上のH数 〜 全H数」の範囲に入っていれば一致とみなす。
  const totalIntegration = peaks.reduce((sum, p) => sum + (p.integration ?? 0), 0);
  let integrationScore = 0.5;
  if (totalIntegration > 0) {
    const tol = Math.max(1, Math.round(totalIntegration * 0.05));
    const diff =
      totalIntegration < carbonBoundH
        ? carbonBoundH - totalIntegration
        : totalIntegration > totalH
          ? totalIntegration - totalH
          : 0;
    integrationScore = diff <= tol ? 1 : Math.max(0, 1 - (diff - tol) / Math.max(totalH, 1));
    details.push({
      status: diff === 0 ? "match" : diff <= tol ? "partial" : "mismatch",
      summary:
        heteroBoundH > 0
          ? `積分値の合計: 入力${totalIntegration}H / 候補は炭素上${carbonBoundH}H + OH・NH等${heteroBoundH}H(OH・NHは観測されなくてもよいとして判定)`
          : `積分値の合計: 入力${totalIntegration}H / 候補の総水素数${totalH}H`,
    });
  }

  // 2. 化学シフトの整合性。積分値の分だけ「Hの単位」に展開し、範囲内の
  // 水素スロットへ1対1で割り当てる(詳細は shiftRanges.ts)。
  //
  // メチル基(CH3)の3個のHは、C–C結合の速い回転で常に等価なので、必ず同じ
  // 1本のピーク(積分3以上)に現れる。ばらばらのピークへ1個ずつ割り当てることを
  // 許すと、実測に3H以上のピークが無い位置にメチル基を持つ構造まで高得点になる。
  // そこで最初に、メチル基を「3H のかたまり」として、積分の残りが3以上ある
  // ピークへ割り当てる(ピークごとに floor(積分/3) 個まで)。
  const capacity = peaks.map((p) => Math.max(1, Math.round(p.integration ?? 1)));
  const methylAtoms = candidateGraph.atoms
    .filter((a) => a.element === "C" && a.attachedH === 3)
    .map((a) => a.index);
  const methylSlotsOfPeak: number[] = [];
  peaks.forEach((_, pi) => {
    for (let k = 0; k < Math.floor(capacity[pi] / 3); k++) methylSlotsOfPeak.push(pi);
  });
  const methylRange = (atomIdx: number) => slots[slotAtom.indexOf(atomIdx)];
  const methylMatch = maxBipartiteMatching(methylAtoms.length, methylSlotsOfPeak.length, (m, s) =>
    inRange(peaks[methylSlotsOfPeak[s]].shift, methylRange(methylAtoms[m])),
  );
  const placedMethylAtoms = new Set<number>();
  methylMatch.forEach((s, m) => {
    if (s < 0) return;
    capacity[methylSlotsOfPeak[s]] -= 3;
    placedMethylAtoms.add(methylAtoms[m]);
  });
  const unplacedMethyls = methylAtoms.length - placedMethylAtoms.size;

  // 残りの積分を「Hの単位」に展開する
  const units: number[] = [];
  peaks.forEach((p, pi) => {
    for (let k = 0; k < capacity[pi]; k++) units.push(p.shift);
  });
  const methylUnits = 3 * placedMethylAtoms.size;
  // OH/NHのスロットは範囲が広く(δ0.5-16)何にでも合うため、同時に
  // マッチングすると本来炭素上のHに割り当てるべきピークを奪ってしまう。
  // まず炭素上のHだけでマッチングし、残ったピークをOH/NHへ割り当てる。
  // 3Hのかたまりとして置けなかったメチル基のHは、ここで1個ずつの割当を試みる
  // (ただしメチル基が1本のピークに収まらない矛盾として後で減点する)。
  const carbonSlotIdx = slots
    .map((_, j) => j)
    .filter((j) => !slotIsHetero[j] && !placedMethylAtoms.has(slotAtom[j]));
  const heteroSlotIdx = slots.map((_, j) => j).filter((j) => slotIsHetero[j]);
  const matchLeft = maxBipartiteMatching(units.length, carbonSlotIdx.length, (i, k) =>
    inRange(units[i], slots[carbonSlotIdx[k]]),
  ).map((k) => (k >= 0 ? carbonSlotIdx[k] : -1));
  const leftover = matchLeft.map((j, i) => (j < 0 ? i : -1)).filter((i) => i >= 0);
  maxBipartiteMatching(leftover.length, heteroSlotIdx.length, (a, k) =>
    inRange(units[leftover[a]], slots[heteroSlotIdx[k]]),
  ).forEach((k, a) => {
    if (k >= 0) matchLeft[leftover[a]] = heteroSlotIdx[k];
  });
  const unmatchedShifts = Array.from(
    new Set(units.filter((_, i) => matchLeft[i] < 0)),
  ).sort((a, b) => b - a);
  const matchedUnits = methylUnits + matchLeft.filter((j) => j >= 0).length;
  const totalUnits = methylUnits + units.length;

  // 炭素上のHは(OH/NHと違い)必ず¹Hスペクトルに現れ、積分にも含まれる。
  // そのため、どのピークにも割り当てられなかった炭素上のHは、その構造が
  // 実測と合わない証拠として扱う(例: 実測にない芳香族Hを多数持つ候補)。
  // 分母を「入力のH数」と「候補の炭素上H数」の大きい方にすることで、
  // ピーク側・候補側どちらの余りも減点される。
  const matchedSlots = new Set(matchLeft.filter((j) => j >= 0));
  let unmatchedCarbonH = 0;
  const unmatchedCarbonLabels = new Map<string, number>();
  slots.forEach((slot, j) => {
    if (matchedSlots.has(j) || slotIsHetero[j] || placedMethylAtoms.has(slotAtom[j])) return;
    unmatchedCarbonH++;
    unmatchedCarbonLabels.set(slot.label, (unmatchedCarbonLabels.get(slot.label) ?? 0) + 1);
  });
  // 1本のピークに収まらなかったメチル基は、1個につき1H分の不一致として数える
  const denominator = Math.max(totalUnits, matchedUnits + unmatchedCarbonH) + unplacedMethyls;
  const shiftScore =
    denominator > 0 ? shiftConsistencyScore((denominator - matchedUnits) / denominator) : 0;
  const allUnitsMatched = matchedUnits === totalUnits;
  if (unplacedMethyls > 0) {
    details.push({
      status: "mismatch",
      summary: `候補構造のメチル基${methylAtoms.length}個のうち${unplacedMethyls}個は、シフト範囲内に積分3H以上のピークが無く、1本のピークとして説明できません(メチル基の3Hは必ず等価)`,
    });
  }
  details.push({
    status: allUnitsMatched ? "match" : totalUnits - matchedUnits <= 1 ? "partial" : "mismatch",
    summary: allUnitsMatched
      ? `¹H化学シフト: ${totalUnits}H分すべてを、局所構造から見て矛盾のない水素に割り当てられます`
      : `¹H化学シフト: ${totalUnits}H分中${matchedUnits}H分を割り当て可能。割り当て先のないピーク: ${unmatchedShifts
          .slice(0, 6)
          .map((s) => `δ${s}`)
          .join(", ")}${unmatchedShifts.length > 6 ? " ほか" : ""}`,
  });
  if (unmatchedCarbonH > 0) {
    details.push({
      status: unmatchedCarbonH <= 1 ? "partial" : "mismatch",
      summary: `候補構造の炭素上のHのうち${unmatchedCarbonH}個が、どのピークにも対応しません(${Array.from(
        unmatchedCarbonLabels.entries(),
      )
        .map(([label, n]) => `${label}${n}`)
        .join(" / ")})`,
    });
  }

  // 積分合計は同じ分子式の候補同士ではほぼ差が出ないため、構造の違いが
  // 表れる化学シフトの整合性を2倍に重み付けする。
  const score = (integrationScore + 2 * shiftScore) / 3;
  const status = score >= 0.8 ? "match" : score >= 0.4 ? "partial" : "mismatch";

  return { method: "1H", status, score, details };
}
