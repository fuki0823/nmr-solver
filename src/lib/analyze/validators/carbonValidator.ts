import { countDistinctCarbonEnvironments } from "../../moleculeGraph";
import { expectedCarbonRange, inRange, maxBipartiteMatching } from "../shiftRanges";
import type { ValidationContext, ValidationDetail, ValidationResult } from "./types";

export function carbonValidator(context: ValidationContext): ValidationResult {
  const { input, candidateGraph } = context;
  const peaks = input.peaks.filter((p) => p.nucleus === "13C");
  if (peaks.length === 0) {
    return { method: "13C", status: "not_evaluated", score: 0, details: [] };
  }

  const details: ValidationDetail[] = [];
  let hardReject = false;

  // 1. 炭素原子数のハード制約。
  //
  // 観測される¹³Cシグナルの本数は、対称性(等価な炭素環境の重なり)や
  // シグナルの偶然の重なりによって、候補の炭素原子数より「少なく」
  // なることは常にあり得る(例: 無水マレイン酸 C4、対称性によりシグナル
  // 2本)。逆に、候補の炭素原子数より「多い」シグナル数が観測されることは
  // 物理的にあり得ない(1個の炭素原子が複数のシグナルを生むことはない)。
  // そのため、非対称に扱う: 超過のみをハード制約違反とする。
  const totalCarbonAtoms = candidateGraph.atoms.filter((a) => a.element === "C").length;
  const uniqueEnvironments = countDistinctCarbonEnvironments(candidateGraph);
  let countScore = 0.5;

  if (peaks.length > totalCarbonAtoms) {
    hardReject = true;
    countScore = 0;
    details.push({
      status: "mismatch",
      hardConstraint: true,
      summary: `¹³Cシグナル数(${peaks.length}本)が候補構造の炭素原子数(${totalCarbonAtoms}個)を超えています。1個の炭素原子から複数のシグナルが生じることはないため、対称性を考慮してもこの候補ではあり得ません。`,
    });
  } else if (uniqueEnvironments != null) {
    if (peaks.length >= uniqueEnvironments) {
      // uniqueEnvironments <= 観測本数 <= 全炭素数: 対称性や偶然の重なりで
      // 矛盾なく説明できる範囲。ハード制約としては通過させる。
      countScore = 1;
      details.push({
        status: "match",
        summary:
          peaks.length === totalCarbonAtoms
            ? `¹³Cシグナル数(${peaks.length}本)は候補構造の炭素原子数(${totalCarbonAtoms}個)と一致します`
            : `¹³Cシグナル数(${peaks.length}本)は候補構造の炭素原子数(${totalCarbonAtoms}個、対称性を考慮した最少${uniqueEnvironments}種類の環境)の範囲内で矛盾しません(対称性やシグナルの重なりで説明可能)`,
      });
    } else {
      // 観測本数がこちらの対称性モデルが見積もる最少環境数より少ない。
      // 判定モデルの粗さやシグナルの偶然の重なりの可能性もあるため、
      // ハード制約にはせず、差が大きいほどソフトスコアを下げるに留める。
      const diff = uniqueEnvironments - peaks.length;
      countScore = Math.max(0, 1 - diff / Math.max(uniqueEnvironments, 1));
      details.push({
        status: diff <= 1 ? "partial" : "mismatch",
        summary: `¹³Cシグナル数(${peaks.length}本)が、候補構造で対称性を考慮しても見積もられる最少種類数(${uniqueEnvironments}種類)より少ないです。シグナルの偶然の重なりの可能性はありますが、差が大きいほど整合性は低くなります。`,
      });
    }
  }

  // 2. 化学シフトの整合性。各ピークを「その局所構造なら出うる範囲」に
  // 入る炭素原子へ1対1で割り当て(最大マッチング)、割り当てられた割合で
  // 評価する。範囲は重なりを許しているため、キノンC=O(δ186)やフェノール
  // C-O(δ155-160)のような境界付近の官能基も正しく扱える(詳細は
  // shiftRanges.ts)。
  const carbons = candidateGraph.atoms.filter((a) => a.element === "C");
  const ranges = carbons.map((a) => expectedCarbonRange(candidateGraph, a));
  const sortedPeaks = [...peaks].sort((a, b) => b.shift - a.shift);
  const matchLeft = maxBipartiteMatching(sortedPeaks.length, carbons.length, (i, j) =>
    inRange(sortedPeaks[i].shift, ranges[j]),
  );
  const unmatched = sortedPeaks.filter((_, i) => matchLeft[i] < 0);
  const matchedCount = sortedPeaks.length - unmatched.length;
  const shiftScore = sortedPeaks.length > 0 ? matchedCount / sortedPeaks.length : 0;
  details.push({
    status: unmatched.length === 0 ? "match" : unmatched.length <= 1 ? "partial" : "mismatch",
    summary:
      unmatched.length === 0
        ? `¹³C化学シフト: ${sortedPeaks.length}本すべてを、局所構造から見て矛盾のない炭素に割り当てられます`
        : `¹³C化学シフト: ${sortedPeaks.length}本中${matchedCount}本を割り当て可能。割り当て先のないピーク: ${unmatched
            .slice(0, 6)
            .map((p) => `δ${p.shift}`)
            .join(", ")}${unmatched.length > 6 ? " ほか" : ""}`,
  });

  // 範囲ごとの内訳(参考表示)。候補構造の炭素がどの種類に何個あるか。
  const labelCounts = new Map<string, number>();
  for (const r of ranges) labelCounts.set(r.label, (labelCounts.get(r.label) ?? 0) + 1);
  details.push({
    status: "match",
    summary: `候補構造の炭素の内訳: ${Array.from(labelCounts.entries())
      .map(([label, n]) => `${label}${n}`)
      .join(" / ")}`,
  });

  const score = hardReject ? 0 : (countScore + shiftScore) / 2;
  const status = hardReject ? "mismatch" : score >= 0.8 ? "match" : score >= 0.4 ? "partial" : "mismatch";

  return { method: "13C", status, score, details };
}
